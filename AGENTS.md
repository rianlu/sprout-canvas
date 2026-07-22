# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目身份
- 中文「芽绘台」, 英文「SproutCanvas」, 包名 `sprout-canvas`.
- 定位: **多 Provider 图像生成工作台** (文生图 / 图生图 / 局部编辑 / 系列生成). 明确**不做视频, 不做 LoRA 训练, 不做团队协作 / 计费**. 涉及方向调整前先看 `docs/BRAND_AND_POSITIONING.md`.
- 部署/配置细节在 `docs/DEPLOY.md`, 不要在此重复.

## 常用命令
| 命令 | 说明 |
|---|---|
| `npm start` | 先跑 `npm run build`, 再启动 Node 22 服务端 `server.mjs`, 默认 `127.0.0.1:8787` |
| `npm run start:server` | 只启动服务端, 要求 `dist/index.html` 已存在 |
| `npm run dev:api` | 只启动 API 服务端, 给 Vite 开发服务器反代使用 |
| `npm run dev` | Vite 开发服务器. `/api` `/ready` `/health` 反代到 8787, 因此**必须同时跑 `npm run dev:api`** |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm test` | `node --check` 静态校验 `server.mjs` 与 `server/*.mjs`, 跑 `tests/queue-routing.test.mjs` + `tests/text-routing.test.mjs`, 再 `npm run build`, 最后 `npm run test:legacy` |
| `npm run test:legacy` | 仅 `node --check js/app.js` — 防止改坏旧的纯 JS 入口 |
| `npm run pm2:start` / `npm run pm2:logs` | PM2 生产部署, 配置见 `ecosystem.config.cjs` |
| `docker compose up -d` | 容器内 8787 映射主机 8888, 挂载 `config/` `logs/` `output/` |
- 单测无框架, 全部基于 `node:assert/strict`. 跑单个测试直接 `node tests/queue-routing.test.mjs`.
- `tests/real-api-*.mjs` 需要真实上游 Key, 默认**不**在 `npm test` 内.

## 配置加载
- 主配置 `config/local.config.json` (在 `.gitignore`). 模板 `config/local.config.example.json`.
- 关键字段: `imageProviders[]`, `textProviders[]` (按数组顺序主备), `defaultImageProvider`, `accessPassword`, `imageConcurrency` (**默认且要求保持 1**, 见下文).
- 环境变量覆盖文件: `TEXT_BASE_URL/TEXT_API_KEY/TEXT_MODEL`, `OPENAI_BASE_URL/OPENAI_API_KEY`, `IMAGE_MODEL`, `GENERATION_MODE`, `DEFAULT_IMAGE_PROVIDER`, `HOST`, `PORT`, `ACCESS_PASSWORD`, `AUTH_SESSION_DAYS`, `SECURE_COOKIES`, `IMAGE_CONCURRENCY`.
- `NODE_ENV=production` 启动会强制拒绝占位密钥/密码 (`change-this` `your-` `example` 等子串, `accessPassword` 长度 <10). 校验失败直接 exit, 不要绕过.

## 总体架构

### 进程模型
单 Node 进程 `server.mjs` 同时承担: 静态资源服务, 浏览器 `/api/*` 入口, 上游 API Key 持有方, 内存任务队列. **零运行时依赖** — `package.json` 中所有 `dependencies` 都只在前端构建期使用. 服务端只用 Node 22 内置模块.

### 模块职责
- `server.mjs`: HTTP 路由 + auth + 文本生成 (`/api/text`, 按 `textProviders[]` 调用 `/v1/chat/completions`) + 生图请求入队 + 静态文件. 是唯一拥有上游 API Key 的进程.
- `server/queue.mjs`: 生图任务队列. **严格单 worker** (`imageConcurrency=1`), 按 `userId` 分桶 FIFO, 用户间公平轮询. 提供 `chooseImageProvider` (自动路由, 跳过不支持当前请求类型的 Provider) + `rewriteImageJobBody` (把客户端发过来的 `model` 字段强行改成所选 Provider 的 `imageModel`) + 熔断 (`PROVIDER_FAILURE_THRESHOLD=3`, 30 分钟 `PROVIDER_CIRCUIT_OPEN_MS`). 任务 TTL 30 分钟, **进程重启即全部丢失**.
- `server/text-routing.mjs`: 文本提示词优化 Provider 的熔断状态机, 接口与生图类似.
- `src/app/App.tsx`: React 19 + StrictMode 入口. 顶层挂载 `useAuth` + `useGallery` + `useQueue`, 按 `PageKey` 切 `pages/`.
- `src/pages/`: `CreativeStudio` (单图), `SeriesStudio` (先调文本拆分→批量入队, 携带 `clientContext.kind='series'`), `SplitTool` (纯前端切图, 不打上游), 展馆在 `components/gallery/GalleryGrid`.
- `src/hooks/useQueue.ts`: 每 2.2 秒轮询 `/api/jobs/me`. 命中 `succeeded` 后拉 `/api/jobs/:id/result`, 用 `clientContext.placeholderId` 把结果填回画廊占位.
- `src/lib/storage/gallery-db.ts`: 展馆只在浏览器 IndexedDB (`img-gen-gallery` v2). 旧 `localStorage` 数据自动迁移. **不在服务端共享**.
- `js/app.js` + `css/styles.css`: 旧纯 JS 兼容资产, 当前服务端不再作为 `dist/` 缺失时的回退入口. `npm run test:legacy` 仍依赖它存在. 删之前必须同步清理测试与文档.

### 关键时序: 生图
1. 浏览器 `POST /api/jobs/images/generations` (或 `/edits` / `/responses`), 带 `X-Client-Context` (base64 后的 `{kind, placeholderId, prompt, mode}` JSON). 可带 `X-Provider-Id` 强制指定, 不带则自动路由.
2. `handleQueuedImageJob` → 解析配置 → `chooseImageProvider` 选 Provider → `rewriteImageJobBody` 改 `model` → 入队 → 立即 202 返回任务元数据.
3. `useQueue` 轮询拉到 `succeeded` → `/api/jobs/:id/result` → 用 `placeholderId` 回填画廊.
4. 失败任务 `/api/jobs/:id/retry` 会自动把上一次的 `providerId` 加入 exclude 列表, 让自动路由换一个 Provider.

### Provider 能力矩阵
`server/queue.mjs#providerSupportsRequest`:
- `generationMode: 'responses'` 的 Provider → 只能服务 `/v1/responses` JSON.
- `generationMode: 'images'` 的 Provider → 服务 `/v1/images/generations` (JSON) 和 `/v1/images/edits` (multipart, 必须含 `image` 字段).
- 自动路由时不支持的 Provider 会跳过; 全部失败 → 502.

### 鉴权
`accessPassword` 非空即启用登录. 浏览器 `useAuth` 在 `localStorage` 生成 UUID `userId` 持久化, 登录时把 `userId + password` 提交. 服务端用 cookie `img_auth_max` (HttpOnly, SameSite=Lax, HTTPS 部署需 `secureCookies: true`) 维护会话. **`userId` 同时是队列分桶 key 和任务可见性边界** — 一个用户看不到另一个用户的 job.

## 必须守住的约定
- **API Key 永远不下发到浏览器**. 任何新增上游调用走 `server.mjs` 的代理路径, 配置统一从 `readLocalConfig()` 拿. 前端不允许引入第三方 LLM SDK.
- **`imageConcurrency` 默认且保持 1**. 提高会同时打多个上游, 容易撞限流; 改之前先确认上游配额, 并同步更新 `docs/DEPLOY.md` 的字段表.
- **新增/修改配置字段** 要同时改 `config/local.config.example.json` 和 `docs/DEPLOY.md` 的字段表, 避免示例和生产对不上.
- **`config/local.config.json` 不进 git**. 提供配置示例时一律放进 `*.example.json`.
- **展馆只在浏览器**. 不要假设服务端能列出某用户历史 — 服务端只保留 30 分钟内未过期的 job 元数据.
- React 19 + TypeScript strict, 类型检查走 `tsc -b` (`npm run build` 自带). 没有独立 lint 配置.
