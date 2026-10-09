# 苹果岛 · 云同步后端

零依赖 Node.js 服务，仅使用内置模块（`http` / `crypto` / `fs` / `path`），**无需 `npm install`**。

## 运行

```bash
node server.js
# 或自定义
PORT=8080 JWT_SECRET=你的密钥 node server.js
```

默认监听 `http://localhost:3000`。

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/status` | 否 | 健康检查 |
| POST | `/api/register` | 否 | `{username,password}` → `{token,username}` |
| POST | `/api/login` | 否 | `{username,password}` → `{token,username}` |
| GET | `/api/data` | Bearer | 返回 `{db, updatedAt}` |
| PUT | `/api/data` | Bearer | `{db, updatedAt}` 写入（last-write-wins） |

## 安全要点

- 密码：`crypto.scryptSync` 加盐哈希，校验用 `timingSafeEqual`。
- Token：自实现 HS256 JWT（HMAC-SHA256），有效期 30 天。
- **生产环境务必设置 `JWT_SECRET` 环境变量**，并把服务放在 HTTPS 之后。
- 数据以 JSON 文件存于 `./data/`，生产建议替换为数据库。
- CORS 默认 `Access-Control-Allow-Origin: *`，便于 `file://`（WebView）源调用；生产可按域名收紧。
