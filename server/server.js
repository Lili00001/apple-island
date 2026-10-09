'use strict';
/*
 * 苹果岛 · 云同步后端（零依赖，仅使用 Node.js 内置模块）
 * 运行： node server.js   （无需 npm install）
 * 环境变量：
 *   PORT      监听端口，默认 3000
 *   JWT_SECRET 签名密钥，生产环境务必设置
 *   DATA_DIR  数据目录，默认 ./data
 *
 * 接口：
 *   GET  /api/status            健康检查
 *   POST /api/register          {username, password} -> {token, username}
 *   POST /api/login             {username, password} -> {token, username}
 *   GET  /api/data  (Bearer)    -> {db, updatedAt}
 *   PUT  /api/data  (Bearer)    {db, updatedAt}  -> {ok, updatedAt}
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.JWT_SECRET || 'apple-island-dev-secret-change-me';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const userDataPath = (id) => path.join(DATA_DIR, `user-${id}.json`);

/* ---------- 存储 ---------- */
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}
function saveUsers(list) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2));
}

/* ---------- 密码（scrypt） ---------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const { hash: h } = hashPassword(password, salt);
  const a = Buffer.from(h, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- JWT (HS256, 自实现) ---------- */
function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${body}.${sig}`;
}
function verifyJwt(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [h, b, s] = parts;
    const expected = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (s !== expected) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch { return null; }
}

/* ---------- 响应与请求辅助 ---------- */
function send(res, code, obj, extra = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    ...extra
  });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 50 * 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}
function authUser(req) {
  const header = req.headers['authorization'] || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const payload = verifyJwt(m[1]);
  if (!payload) return null;
  const users = loadUsers();
  return users.find((u) => u.id === payload.sub) || null;
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') return send(res, 204, {});

  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { error: '无效请求' }); }
  const pathname = url.pathname;

  try {
    if (pathname === '/api/status') return send(res, 200, { ok: true, name: 'apple-island-sync' });

    if (pathname === '/api/register' && req.method === 'POST') {
      const { username, password } = await readBody(req);
      if (!username || !password || username.length < 2 || password.length < 6)
        return send(res, 400, { error: '账号至少 2 位、密码至少 6 位' });
      const users = loadUsers();
      if (users.some((u) => u.username === username))
        return send(res, 409, { error: '该账号已存在' });
      const id = crypto.randomUUID();
      const { salt, hash } = hashPassword(password);
      users.push({ id, username, salt, hash, createdAt: Date.now() });
      saveUsers(users);
      const token = signJwt({ sub: id, username, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 });
      return send(res, 200, { token, username });
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      const { username, password } = await readBody(req);
      const users = loadUsers();
      const u = users.find((x) => x.username === username);
      if (!u || !verifyPassword(password, u.salt, u.hash))
        return send(res, 401, { error: '账号或密码错误' });
      const token = signJwt({ sub: u.id, username, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 });
      return send(res, 200, { token, username });
    }

    if (pathname === '/api/data' && req.method === 'GET') {
      const u = authUser(req);
      if (!u) return send(res, 401, { error: '未登录' });
      let data = {};
      try { data = JSON.parse(fs.readFileSync(userDataPath(u.id), 'utf8')); } catch {}
      return send(res, 200, { db: data.db || null, updatedAt: data.updatedAt || 0 });
    }

    if (pathname === '/api/data' && req.method === 'PUT') {
      const u = authUser(req);
      if (!u) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return send(res, 400, { error: '数据格式错误' });
      const updatedAt = Number(body.updatedAt) || Date.now();
      const file = userDataPath(u.id);
      let existing = {};
      try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      // last-write-wins：仅在云端较旧或不存在时覆盖
      if (existing.updatedAt && updatedAt < existing.updatedAt)
        return send(res, 409, { error: '本地数据较旧，请先同步', updatedAt: existing.updatedAt });
      fs.writeFileSync(file, JSON.stringify({ db: body.db, updatedAt }));
      return send(res, 200, { ok: true, updatedAt });
    }

    return send(res, 404, { error: '接口不存在' });
  } catch (e) {
    return send(res, 400, { error: e.message || '请求错误' });
  }
});

server.listen(PORT, () => {
  console.log(`苹果岛云同步服务已启动: http://localhost:${PORT}`);
  if (SECRET === 'apple-island-dev-secret-change-me')
    console.log('提示：生产环境请设置环境变量 JWT_SECRET 以增强安全。');
});
