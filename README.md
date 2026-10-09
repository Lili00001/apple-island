# 苹果岛（Apple Island）安卓 App

把附件中的"苹果岛"网页 App 打包为安卓 APK，并新增**账号登录**与**云同步**能力。

- 原 App：日常/岛主（兔子"苹果"）成长记录、月历、习惯打卡、照片日记，原本用浏览器 `localStorage` 存储。
- 本次改造：在保留全部原有功能与离线能力的基础上，增加**账号登录 / 注册**、**云端备份与同步**（登录拉取、改动即推、恢复 / 手动同步），离线优先。
- 打包方式：原生 **WebView** 外壳加载网页资源，零第三方运行时依赖，可直接用 Android Studio 出包。

---

## 目录结构

```
apple-island/
├── www/                      # 网页 App 源码（也是安卓 WebView 加载的内容）
│   ├── index.html            # 主页面：原 App 全部 UI + 登录界面 + 同步状态指示
│   └── sync.js               # 账号登录 + 云同步模块（JWT 会话、自动推送/拉取）
├── android/                  # 安卓工程（Android Studio / Gradle 直接打开）
│   └── app/src/main/
│       ├── assets/www/       # 打包进 APK 的网页资源（由 www/ 同步而来）
│       ├── java/.../MainActivity.java   # WebView 外壳 + 照片选择
│       ├── res/              # 图标、主题、布局、网络配置
│       └── AndroidManifest.xml
└── server/                   # 云同步后端（零依赖 Node.js，无需 npm install）
    ├── server.js
    └── package.json
```

---

## 一、运行云同步后端

后端只用 Node.js 内置模块，**不需要 `npm install`**。

```bash
cd server
node server.js                 # 默认监听 http://localhost:3000
# 自定义： PORT=8080 JWT_SECRET=你的密钥 node server.js
```

接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/status` | 健康检查 |
| POST | `/api/register` | 注册 `{username,password}` → `{token,username}` |
| POST | `/api/login` | 登录 → `{token,username}` |
| GET | `/api/data` | 拉取当前用户数据（需 `Authorization: Bearer <token>`） |
| PUT | `/api/data` | 上传数据 `{db,updatedAt}`（需登录，last-write-wins） |

> 密码用 `scrypt` 加盐哈希，Token 为自实现 HS256 JWT。数据以 JSON 文件存于 `server/data/`。
> 这是**演示/自托管**级别的实现：生产环境请改 HTTPS、设置 `JWT_SECRET`、并替换为真正的数据库。

---

## 二、构建安卓 APK

> 本沙箱环境无 Android SDK 且无外网，无法在此直接编译 `.apk`。
> 你有两种出包方式：
> - **方式 C（推荐小白，不用装任何软件）**：用 GitHub 的免费在线服务器帮你编译，点一下就出 APK。
> - **方式 A / B**：在你自己的电脑上用 Android Studio 或命令行出包。

### 方式 C：GitHub 在线自动构建（无需 Android Studio，推荐小白）

本仓库已内置自动化脚本 `.github/workflows/build-apk.yml`，只要把代码传到 GitHub，它的免费服务器就会自动帮你编译出 APK。**全程不需要安装 Android Studio**。

**步骤（第一次约 5 分钟）：**

1. 注册 GitHub 账号（免费）：https://github.com/
2. 新建仓库：`New repository` → 名字随便（如 `apple-island`）→ 选 Public 或 Private 都行 → **不要**勾 "Add a README" → `Create repository`。
3. 下载我给你的 **`apple-island.zip`**（整个工程打包），解压到电脑任意位置。
4. 进入你刚建的仓库 → 点 `Add file` → `Upload files` → 把解压出的 `apple-island` 文件夹**整个拖进去**（文件夹结构会保留）→ 拉到底部写个标题（如 `init`）→ `Commit changes`。
5. 点仓库顶部的 **`Actions`** 标签 → 左侧看到 **`Build APK`** → 右侧 `Run workflow` → 再点一次 `Run workflow`（分支选 `main` 或 `master`）。
6. 等 3–6 分钟，出现绿色 ✓ → 点进去 → 在 `Artifacts` 区域下载 **`apple-island-apk`**（这就是 `.apk` 文件）。
7. 把 APK 传到手机安装（安卓需允许"未知来源"安装）。

> 之后只要代码没变，APK 一直在 Actions 的 Artifacts 里可重复下载；改了代码重新 `Run workflow` 即可重新编译。

### 方式 A：Android Studio（你电脑已装时最省事）
1. 打开 Android Studio → `Open` → 选择本目录下的 `android/` 文件夹。
2. 等待 Gradle 同步完成（首次会自动下载 Gradle 与 Android Gradle Plugin）。
3. `Build` → `Build Bundle(s) / APK(s)` → `Build APK(s)`。
4. 编译完成后，APK 位于：
   ```
   android/app/build/outputs/apk/debug/app-debug.apk
   ```
   直接安装到手机即可（debug 包已自带签名）。

### 方式 B：命令行（Gradle）
```bash
cd android
gradle wrapper --gradle-version 8.9   # 首次生成 gradle-wrapper.jar（需本机已装 Gradle）
./gradlew assembleDebug              # 或已存在 wrapper 时直接运行
# 产物： android/app/build/outputs/apk/debug/app-debug.apk
```
> 若 `android/gradle/wrapper/gradle-wrapper.jar` 不存在，用 Android Studio 打开一次即可自动补齐，或执行上面的 `gradle wrapper` 命令。

### 改成正式发布包（可选）
- `Build` → `Generate Signed Bundle / APK`，按提示创建/选择签名密钥。
- 或在 `app/build.gradle` 的 `release` 中配置 `signingConfigs`。

---

## 三、把 App 连到你的服务器

App 采用**离线优先**：不登录也能在本地正常使用；登录后才进行云同步。

- **最简单**：打开 App → 顶部"未登录"胶囊 / 设置页"云同步账号" → 在登录框的**服务器地址**里填你的后端地址（如 `https://sync.example.com` 或局域网 `http://192.168.x.x:3000`），再登录或注册。
- **改默认值（免每次输入）**：编辑 `www/sync.js` 顶部的 `CONFIG.DEFAULT_SERVER`，然后重新把 `www/` 同步进 `android/app/src/main/assets/www/`（即再执行一次 `cp -r www/* android/app/src/main/assets/www/`）并重新构建。
  - 安卓模拟器连接电脑后端填：`http://10.0.2.2:3000`
  - 真机连同一局域网电脑填：`http://<电脑局域网IP>:3000`

同步行为：
- 登录成功后自动从云端**拉取**该账号数据；
- 之后任何本地改动（新增/编辑/删除记录、打卡）会在 0.8 秒后**自动推送**到云端；
- 切回 App（可见性变化）时自动做一次"拉取 + 推送"；
- 设置页可查看"上次同步"时间、手动"立即同步"、退出登录。
- 冲突策略为 **last-write-wins**（按时间戳），适合单主力设备日常使用。

---

## 四、已验证

- 后端全链路（沙箱内 localhost 实测）：注册 → 登录（含错误密码 401）→ 上传数据 → 拉取数据 → 过期/旧数据 409 → 无 Token 401 → 重复注册 409，均符合预期。
- 前端脚本（`index.html` 内联逻辑、`sync.js`）通过 `node --check` 语法校验。
- 安卓工程为标准 Android Gradle 工程，文件结构完整。

## 五、说明 / 局限

- 由于环境限制，**APK 二进制需在你本地（有 Android SDK 的机器）按上文一步构建**；本仓库交付的是完整、可直接出包的源码工程。
- 演示后端用文件存储 + 开发密钥，仅适合自托管/验证；上生产请接 HTTPS 与数据库。
- 云同步为单账号整库 last-write-wins，多设备同时离线编辑可能产生覆盖；如需多端协作可后续引入按记录级合并。

---

## 六、数据下载 / 备份

- **导出到本机**：打开 App → 右上角齿轮（设置与备份）→「导出完整备份」→ 会下载一个 `苹果岛备份-日期.json` 文件。
  - 浏览器里直接下载；**安卓 APK 里会自动保存到手机「下载」目录**（已内置 `DownloadListener` 写入 MediaStore）。
- **恢复备份**：设置页「恢复备份」选择之前导出的 JSON，会替换当前全部数据（建议先导出再恢复）。
- **云同步拉取**：登录账号后会自动从云端下载该账号数据；设置页「立即同步」也可手动触发。

## 七、如何迭代（改功能后重新出包）

网页逻辑都在 `www/` 里，改起来很容易，**不需要像原生 App 那样每次大改重编**：

1. 改功能：编辑 `www/index.html`（界面/逻辑）或 `www/sync.js`（账号/云同步）。
2. 同步进安卓工程：
   ```bash
   cp -r www/* android/app/src/main/assets/www/
   ```
3. 重新出包前，把安卓工程的版本号加一（这样手机上才会"覆盖更新"而不是要求先卸载）：
   - 编辑 `android/app/build.gradle`，把 `versionCode` 加 1（如 `1` → `2`），`versionName` 也跟着升（如 `'1.0.0'` → `'1.1.0'`）。
4. 重新出包：
   - **GitHub 自动构建（推荐）**：把更新后的文件推回 GitHub（或在网页上传），回到 `Actions` → `Build APK` → `Run workflow`，几分钟后下载新 APK。
   - 本地 Android Studio：打开 `android/` → `Build APK(s)`。
5. 后端若要改（`server/server.js`）：改完重新 `node server.js` 即可，无需重新打包 App。

> **在手机上更新（覆盖安装）**：直接把新 APK 下载到手机、点安装即可。
> 工程已配置**固定签名**（`android/app/debug.keystore`），所以每次构建出的 APK 签名一致——
> 装新版本会**直接覆盖旧版本**，你本地的日记/照片数据（存在 App 内部）**不会丢**。
> 若安装时提示"与已安装应用签名不一致"或装不上，说明版本号没递增或签名变了，把 `versionCode` 调高再构建即可。

> 小技巧：先在电脑浏览器双击 `apple-island.html` 验证改动效果，确认没问题再同步进安卓工程出包，省时间。
