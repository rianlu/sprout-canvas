# 芽绘台 / SproutCanvas

多 Provider 图像生成工作台, 支持文生图, 参考图生成, 局部编辑, 批量出图和本地展馆保存.

## 快速开始
- 安装 Node.js 22+.
- 执行 `npm ci` 安装依赖.
- 复制 `config/local.config.example.json` 为 `config/local.config.json`.
- 填写 `imageProviders[]`, `textProviders[]`, `defaultImageProvider`, `accessPassword`.
- 执行 `npm start` 构建并启动服务.
- 打开 `http://127.0.0.1:8787`.

## 开发模式
- 在一个终端执行 `npm run dev:api`.
- 在另一个终端执行 `npm run dev`.
- 使用 Vite 页面访问前端, API 自动反代到 `127.0.0.1:8787`.

## 验证
- 执行 `npm test` 完整验证服务端语法, 队列路由, 文本路由, 前端构建和旧入口语法.
- 执行 `npm audit --omit=dev` 检查运行依赖安全状态.

## 部署
- 阅读 `docs/DEPLOY.md`.
- 生产环境必须设置非占位 `accessPassword` 和真实 API Key.
- Docker 执行 `docker compose up -d`.
- PM2 执行 `npm run pm2:start`.
