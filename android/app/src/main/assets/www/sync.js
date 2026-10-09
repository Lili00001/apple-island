'use strict';
/* =========================================================================
 * 苹果岛 · 云同步模块（账号登录 + 云端备份）
 * 依赖 index.html 中原 App 暴露的全局：db / save / normalize / render / notify / esc
 * 设计原则：离线优先。未登录时完全本地使用；登录后每次保存自动推送，
 *          并在登录 / 恢复 / 手动同步时从云端拉取（last-write-wins）。
 * ========================================================================= */

const CONFIG = {
  // 默认服务器地址。空字符串表示首次使用需在登录框中填写。
  // 本地（Android 模拟器连接电脑后端）可填 http://10.0.2.2:3000
  // 真实设备连接同一局域网电脑后端可填 http://<电脑局域网IP>:3000
  // 生产环境请填你部署的后端 HTTPS 地址。
  DEFAULT_SERVER: ''
};

const AUTH_KEY = 'apple-island-auth';   // {server, token, username, skip}
const SYNC_KEY = 'apple-island-sync';   // {localUpdatedAt, lastSyncAt}

/* ---------- 持久化 ---------- */
function loadAuth(){ try{ return JSON.parse(localStorage.getItem(AUTH_KEY)) || {}; }catch{ return {}; } }
function saveAuth(a){ try{ localStorage.setItem(AUTH_KEY, JSON.stringify(a)); }catch{} }
function loadSyncMeta(){ try{ return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; }catch{ return {}; } }
function saveSyncMeta(m){ try{ localStorage.setItem(SYNC_KEY, JSON.stringify(m)); }catch{} }

let auth = loadAuth();
let status = 'unauth';          // idle | syncing | offline | error | unauth
let currentAuthMode = 'login';  // login | register
let pushTimer = null;
let suppressPush = false;       // 云端拉取覆盖本地时避免回推

const isAuthed = () => !!(auth && auth.token);
const serverUrl = () => (auth.server || CONFIG.DEFAULT_SERVER || '').replace(/\/+$/, '');

/* ---------- 与原 App 的保存钩子对接 ---------- */
window.__onSaved = function(){
  if(suppressPush) return;
  schedulePush();
};

/* ---------- 网络请求 ---------- */
async function api(path, opts = {}){
  const base = serverUrl();
  if(!base) throw Object.assign(new Error('请先在登录框填写服务器地址'), {status:0});
  const headers = { 'Content-Type': 'application/json' };
  if(auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = null; try{ data = await res.json(); }catch{}
  if(!res.ok){
    const err = new Error((data && data.error) || ('请求失败 (' + res.status + ')'));
    err.status = res.status; throw err;
  }
  return data;
}
async function register(username, password){
  const res = await fetch(serverUrl() + '/api/register', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username, password })
  });
  let data=null; try{ data = await res.json(); }catch{}
  if(!res.ok) throw Object.assign(new Error((data&&data.error)||'注册失败'), {status:res.status});
  return data; // {token, username}
}
async function login(username, password){
  const res = await fetch(serverUrl() + '/api/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username, password })
  });
  let data=null; try{ data = await res.json(); }catch{}
  if(!res.ok) throw Object.assign(new Error((data&&data.error)||'登录失败'), {status:res.status});
  return data; // {token, username}
}

/* ---------- 云同步核心 ---------- */
function schedulePush(){
  if(!isAuthed()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushNow().catch(()=>{}); }, 800);
}
async function pushNow(){
  if(!isAuthed()) return;
  setStatus('syncing');
  try{
    const updatedAt = Date.now();
    const m = loadSyncMeta(); m.localUpdatedAt = updatedAt; saveSyncMeta(m);
    await api('/api/data', { method:'PUT', body:{ db, updatedAt } });
    const mm = loadSyncMeta(); mm.lastSyncAt = updatedAt; saveSyncMeta(mm);
    setStatus('idle');
  }catch(e){
    setStatus((e && e.status === 401) ? 'error' : 'offline');
    if(e && e.status === 401){ // token 失效，提示重新登录
      auth.token = ''; saveAuth(auth); notify('登录已失效，请重新登录。');
    }
  }
}
async function pullNow(){
  if(!isAuthed()) return;
  setStatus('syncing');
  try{
    const { db: cloudDb, updatedAt: cloudTs } = await api('/api/data');
    const localTs = (loadSyncMeta().localUpdatedAt) || 0;
    if(cloudDb && cloudTs > localTs){
      suppressPush = true;
      try{ save(normalize(cloudDb), true); } finally { suppressPush = false; }
      render();
      const m = loadSyncMeta(); m.localUpdatedAt = cloudTs; m.lastSyncAt = Date.now(); saveSyncMeta(m);
    } else if(!cloudDb && dbHasData()){
      // 云端为空但本地有数据：把本地推上去
      await pushNow();
      return;
    } else {
      const m = loadSyncMeta(); m.lastSyncAt = Date.now(); saveSyncMeta(m);
    }
    setStatus('idle');
  }catch(e){
    setStatus((e && e.status === 401) ? 'error' : 'offline');
  }
}
function dbHasData(){
  return !!(db && (db.entries && db.entries.length) || (db.checks && Object.keys(db.checks).length));
}
async function syncNow(){
  if(!isAuthed()){ openAuth(); return; }
  notify('正在同步…');
  await pullNow().catch(()=>{});
  await pushNow().catch(()=>{});
}

/* ---------- 状态指示（头部胶囊） ---------- */
function setStatus(s){
  status = s;
  const pill = document.getElementById('syncPill');
  const text = document.getElementById('syncPillText');
  if(!pill) return;
  pill.className = 'sync-pill ' + (isAuthed() ? s : 'unauth');
  if(!isAuthed()){ text.textContent = '未登录'; return; }
  const map = { idle:'已同步', syncing:'同步中…', offline:'离线', error:'同步失败' };
  text.textContent = map[s] || '已同步';
}

/* ---------- 登录界面 ---------- */
function openAuth(){
  const screen = document.getElementById('authScreen');
  if(screen) screen.hidden = false;
  const srv = document.getElementById('authServer');
  if(srv && !srv.value) srv.value = auth.server || CONFIG.DEFAULT_SERVER || '';
  setAuthMode('login');
  const msg = document.getElementById('authMsg'); if(msg){ msg.textContent=''; msg.className='auth-msg'; }
}
function closeAuth(){ const s=document.getElementById('authScreen'); if(s) s.hidden = true; }
function setAuthMode(mode){
  currentAuthMode = mode;
  document.querySelectorAll('[data-auth-mode]').forEach(btn=>{
    const on = btn.dataset.authMode === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const submit = document.getElementById('authSubmit');
  if(submit) submit.textContent = (mode === 'register') ? '注册并登录' : '登录';
}
function authMsg(text, kind){
  const el = document.getElementById('authMsg');
  if(!el) return;
  el.textContent = text; el.className = 'auth-msg ' + (kind || '');
}
async function submitAuth(){
  const server = (document.getElementById('authServer').value || '').trim();
  const user = (document.getElementById('authUser').value || '').trim();
  const pass = document.getElementById('authPass').value || '';
  if(server){ auth.server = server; saveAuth(auth); }
  if(!user || !pass){ return authMsg('请输入账号和密码', 'err'); }
  if(!serverUrl()){ return authMsg('请先填写服务器地址', 'err'); }
  authMsg(currentAuthMode === 'register' ? '注册中…' : '登录中…', '');
  try{
    const data = currentAuthMode === 'register'
      ? await register(user, pass)
      : await login(user, pass);
    auth.token = data.token; auth.username = data.username; auth.skip = false;
    saveAuth(auth);
    closeAuth(); setStatus('idle');
    notify(currentAuthMode === 'register' ? '注册成功，已登录' : '登录成功');
    await pullNow().catch(()=>{});
    render();
  }catch(err){
    authMsg(err.message || '操作失败，请检查服务器地址或账号', 'err');
  }
}
function doLogout(){
  auth.token = ''; saveAuth(auth); setStatus('unauth');
  notify('已退出登录，数据仍保留在本机。');
  // 刷新设置面板中的账号区块
  if(document.getElementById('overlay') && !document.getElementById('overlay').hidden){
    const body = document.getElementById('modalBody');
    if(body) body.insertAdjacentHTML('beforeend', ''); // 触发重渲染由 settings 负责
    if(typeof settings === 'function') settings();
  }
}

/* ---------- 设置面板：追加账号区块 ---------- */
function accountSection(){
  if(isAuthed()){
    const m = loadSyncMeta();
    const last = m.lastSyncAt ? new Date(m.lastSyncAt).toLocaleString('zh-CN', { hour12:false }) : '尚未同步';
    return `<div class="account-box">
      <div class="row"><strong>已登录：${esc(auth.username || '')}</strong><button class="link" data-auth-action="logout">退出登录</button></div>
      <div class="row"><span>上次同步</span><span>${esc(last)}</span></div>
      <div class="row"><span>服务器</span><span>${esc(auth.server || CONFIG.DEFAULT_SERVER || '（未设置）')}</span></div>
      <button class="primary" data-auth-action="sync">立即同步</button>
    </div>`;
  }
  return `<div class="account-box">
    <div class="row"><strong>云同步账号</strong><button class="link" data-auth-action="open">登录 / 注册</button></div>
    <div class="server-line">登录后，记录会备份到你的账号，换设备也能恢复。当前服务器：${esc(auth.server || CONFIG.DEFAULT_SERVER || '（未设置）')}</div>
  </div>`;
}
(function patchSettings(){
  const _orig = settings;
  settings = function(){
    _orig();
    const body = document.getElementById('modalBody');
    if(body) body.insertAdjacentHTML('beforeend', accountSection());
  };
})();

/* ---------- 事件绑定 ---------- */
document.addEventListener('click', e=>{
  const b = e.target.closest('button'); if(!b) return;
  if(b.dataset.action === 'sync-panel'){
    if(isAuthed()) syncNow(); else openAuth();
    return;
  }
  const act = b.dataset.authAction;
  if(act === 'open'){ openAuth(); }
  else if(act === 'logout'){ doLogout(); }
  else if(act === 'sync'){ syncNow(); }
  if(b.id === 'authSkip'){ skipAuth(); return; }
  const mode = b.dataset.authMode;
  if(mode){ setAuthMode(mode); }
});

function skipAuth(){
  closeAuth(); setStatus('unauth');           // 先关闭登录遮罩，确保主界面一定露出
  try{ auth.skip = true; saveAuth(auth); }catch(e){}
  notify('已切换为本地模式，可稍后在「设置 → 云同步账号」中登录。');
}
document.addEventListener('submit', e=>{
  if(e.target && e.target.id === 'authForm'){ e.preventDefault(); submitAuth(); }
});
document.addEventListener('visibilitychange', ()=>{
  if(!document.hidden && isAuthed() && document.getElementById('overlay').hidden){
    pullNow().catch(()=>{});
    pushNow().catch(()=>{});
  }
});

/* ---------- 启动 ---------- */
(function init(){
  if(isAuthed()){
    setStatus('idle');
    pullNow().catch(()=>{});
  } else if(!auth.skip){
    openAuth();
  } else {
    setStatus('unauth');
  }
})();
