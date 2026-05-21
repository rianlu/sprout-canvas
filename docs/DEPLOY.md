# 部署与配置指南

适用于「芽绘台 / SproutCanvas」(`sprout-canvas`), 涵盖本地配置、本地运行、生产部署、Nginx 反代、日常排查.

## 1. 安全前提
- **禁止在网页中填写或展示 API Key**, 所有 Key 由服务端持有.
- 浏览器只请求同源 `/api/*`, 不直接访问上游模型接口.
- 服务端通过 `config/local.config.json` 或环境变量加载 Key, 该文件已在 `.gitignore` 中, 不要提交到任何公开仓库.
- 纯前端无法真正隐藏 Key — 因为请求最终必须从浏览器发出. 当前方案通过服务端代理隐藏 Key, 浏览器只能看到 `/api/config` 返回的脱敏配置.
- 不做用户隔离时, 多人会共享同一套 Key 和生成额度, 公网部署必须额外加访问控制.

## 2. 本地配置

### 2.1 复制配置模板
```bash
cp config/local.config.example.json config/local.config.json
```

### 2.2 关键字段
编辑 `config/local.config.json`:

| 字段 | 必填 | 说明 |
|---|---|---|
| `textProviders[]` | 是 | 文本服务商列表 (用于提示词优化), 按数组顺序自动主备切换 |
| `imageProviders[]` | 是 | 生图服务商列表, 每项至少填 `id / name / baseUrl / apiKey / imageModel / generationMode` |
| `defaultImageProvider` | 是 | 默认生图服务商 `id`, 必须能在 `imageProviders` 中匹配到 |
| `accessPassword` | 是 (生产) | 网页登录密码, **必须改掉默认值** |
| `imageConcurrency` | 否 | 同时进行的生图任务数, 建议 `3`-`4` |
| `host` | 否 | 监听地址; 用 Nginx 反代时保持 `127.0.0.1`, 直接暴露端口才改 `0.0.0.0` |
| `port` | 否 | 监听端口, 默认 `8787` |
| `secureCookies` | 否 | HTTPS 部署下改为 `true` |
| `authSessionDays` | 否 | 登录会话有效期, 默认 7 天 |
| `logFile` | 否 | 应用日志路径, 默认 `logs/server.log` |

### 2.3 环境变量优先级 (可覆盖配置文件)
| 环境变量 | 作用 |
|---|---|
| `TEXT_BASE_URL` / `TEXT_API_KEY` / `TEXT_MODEL` | 覆盖主文本服务商对应字段 |
| `OPENAI_BASE_URL` / `ANYROUTER_BASE_URL` | 兼容旧单服务商 `baseUrl` |
| `OPENAI_API_KEY` / `ANYROUTER_API_KEY` | 兼容旧单服务商 `apiKey` |
| `IMAGE_MODEL` | 兼容旧单服务商 `imageModel` |
| `GENERATION_MODE` | 兼容旧单服务商 `generationMode` (`images` 或 `responses`) |
| `DEFAULT_IMAGE_PROVIDER` | 覆盖默认生图服务商 `id` |
| `PORT` | 覆盖监听端口 |

## 3. 本地运行验证

```bash
# 安装依赖 (本项目零运行时依赖, 仅 Node 22+)
node --version   # >= 22

# 启动
npm start

# 健康检查
curl http://127.0.0.1:8787/health   # 进程存活
curl http://127.0.0.1:8787/ready    # 配置就绪

# 跑参数冒烟测试
npm test
```

打开 `http://127.0.0.1:8787`, 用 `accessPassword` 登录, 测试提示词优化和生图.

## 4. 生产部署

### 4.1 准备
- 安装 Node.js 22+.
- 上传项目目录到服务器, **不要包含** `config/local.config.json` (上传后单独创建并填值).
- 在服务器项目目录确认: `accessPassword` 不是默认值, 所有 `apiKey` 不是占位 `sk-your-*`.
- `NODE_ENV=production` 会强制校验上述项.

### 4.2 方式一: PM2 守护
```bash
npm i -g pm2
npm run pm2:start
npm run pm2:logs       # 查看日志
pm2 save               # 保存进程列表
pm2 startup            # 按输出执行开机自启命令
```

### 4.3 方式二: Docker
```bash
docker compose up -d
```
默认把容器内 `8787` 映射到主机 `8888`, 挂载 `./config ./logs ./output` 三个目录, 配置与日志可直接在主机查看.

### 4.4 Nginx 反代示例
```nginx
server {
  listen 80;
  server_name your-domain.com;

  client_max_body_size 80m;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 360s;
    proxy_send_timeout 360s;
  }
}
```
HTTPS 部署时记得把 `local.config.json` 里的 `secureCookies` 改为 `true`.

### 4.5 多人公网部署额外要求
- 启用 `accessPassword` 登录.
- 增加访问频率限制、Key 额度上限、审计日志.
- 禁止暴露 `config/local.config.json`、`.env`、日志中的明文 Key.

## 5. 日常运维与排查

### 5.1 日志位置
- 应用日志: `tail -f logs/server.log`
- PM2 日志: `npm run pm2:logs` (或 `logs/pm2-out.log`、`logs/pm2-error.log`)

### 5.2 上游失败定位
生图上游失败会在日志记录 `provider / status / error`. 出现 5xx 时:
1. 看日志确认是哪个 `provider` 出错.
2. 服务端会自动尝试切换下一个兼容的生图服务商.
3. 文本优化按 `textProviders` 顺序自动主备切换.

### 5.3 提示词优化 502 排查
- 服务端先请求上游 `/v1/responses`.
- 上游返回 502 / 404 / 不支持 Responses 时, 自动回落到 `/v1/chat/completions`.
- 两个接口都失败时, 页面只显示清理后的错误摘要, 不再展示 Cloudflare HTML 错误页.
- 仍失败时, 核对 `textProviders` 里的 `baseUrl / apiKey / model` 是否支持文本生成.

## 6. 当前架构边界
- 适合**小范围朋友使用**的部署规模.
- 画廊保存在每个浏览器本地 IndexedDB, **不在服务器共享**.
- 刷新或关闭浏览器**不会恢复**未完成任务.
- 若后续需要账户隔离、任务恢复、共享素材库, 再引入数据库、Redis 队列和对象存储.
