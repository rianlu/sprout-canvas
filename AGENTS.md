# AGENTS.md

## 项目身份

- 使用中文名芽绘台, 英文名 SproutCanvas, 包名 `sprout-canvas`.
- 保持多 Provider 图像生成工作台定位: 文生图, 参考图生成, 蒙版编辑和系列策划.
- 不添加视频生成, LoRA 训练, 团队协作, 计费或云端作品库. 视频分镜只生成静态图片.
- 按 `docs/PRD.md`, `docs/DESIGN.md` 和 `docs/FEATURE_ARCHITECTURE_REVIEW.md` 执行当前要求. 将 `docs/UI_V3_PLAN.md` 视为历史记录.
- 保留 Stitch 五张正式稿的布局和视觉语言. 以用户后续决策覆盖原稿的功能假设: 移除作品精选收藏, 回收站和不支持的模型参数.

## 常用命令

| 命令 | 要求 |
|---|---|
| `npm start` | 构建前端后启动 `server.mjs`, 默认 `127.0.0.1:8787` |
| `npm run start:local` | 构建后运行隔离的本机测试服务, 默认 8789; 独立数据与管理员凭据规则见 `docs/DEPLOY.md` |
| `npm run start:server` | 启动已有 `dist/` 的 Node 服务 |
| `npm run dev:api` | 启动 API 服务 |
| `npm run dev` | 启动 Vite, 同时运行 API 服务以供 `/api`, `/health`, `/ready` 反代 |
| `npm run build` | 执行 TypeScript strict 检查和 Vite 构建 |
| `npm test` | 执行 `node --test tests/*.test.mjs`, 再构建前端 |
| `npm run test:browser` | 使用 Playwright, 隔离服务和虚拟上游验证浏览器交互 |
| `npm run test:docker` | 先构建 `sprout-canvas:verify`, 再验证容器, 使用独立虚拟配置 |
| `npm run pm2:start` | 构建后按单实例 PM2 配置启动 |
| `docker compose up -d` | 挂载 `config/`, `logs/`, `data/`, 将容器 8787 映射到主机 8888 |

- 使用 Node.js >=22.13, 推荐 Node.js 22 LTS 最新补丁版本. 服务端依赖 Node 内置 `node:sqlite`.
- 使用 Node 内置测试执行器与 `node:assert/strict`. 单个测试直接运行 `node tests/<name>.test.mjs`.
- 将真实付费 API 验证与自动测试分离, 不让默认测试读取真实密钥或调用上游.
- 将测试产物放临时目录; 使用 `SPROUT_TEST_OUTPUT` 指定截图/报告目录.

## 模块边界

| 模块 | 保持的职责 |
|---|---|
| `server.mjs` | 同源 HTTP 路由, 静态文件, 健康检查, 生命周期 |
| `server/config.mjs` | 集中加载/校验配置, 输出不含密钥的公开配置 |
| `server/auth.mjs`, `server/http.mjs` | 会话, Cookie, 请求边界, 错误脱敏 |
| `server/text.mjs`, `server/text-routing.mjs` | 提示词/分镜文本调用及文本通道熔断 |
| `server/queue.mjs` | 单 worker, 用户内 FIFO, 用户间公平轮询, 幂等, 置顶, 领取和恢复 |
| `server/provider-adapter.mjs` | Images / Responses 适配, multipart, 完成事件解析 |
| `server/generation-input.mjs`, `server/image-result.mjs` | 输入图/蒙版校验, 图片结果读取和真实 MIME/尺寸识别 |
| `server/state-store.mjs` | SQLite 任务元信息和哈希会话 token |
| `server/style-store.mjs`, `server/style-routes.mjs` | 风格 SQLite, 示例图文件, 公开读取, 管理增删改与备份事务 |
| `server/admin-auth.mjs` | 独立管理会话, 密码轮换失效, 同源校验与登录限速 |
| `shared/style-contract.mjs` + `.d.mts` | 风格字段, 图片/容量限制和前后端共享类型 |
| `shared/generation-contract.mjs` + `.d.mts` | 前后端统一请求类型与运行时校验 |
| `shared/series-planning.mjs` | 四模板拆解规则和独立分镜提示词 |
| `src/app/App.tsx` | 四页导航, 独立管理入口, 登录, 队列和作品动作集成 |
| `src/pages/StyleAdmin.tsx`, `src/hooks/useStyleCatalog.ts` | 风格管理表单, 图片上传/拖拽/粘贴, 动态目录同步 |
| `src/hooks/useSeriesStudio.ts` | 系列身份, 草稿, 单镜版本和续交业务 |
| `src/lib/storage/gallery-db.ts` | IndexedDB v4 元信息, 原图 Blob, 缩略图, 领取记录, outbox 和草稿 |

## 生成与存储约定

1. 将全部图像任务提交到 `POST /api/jobs`, 使用稳定 `requestId` 和 `clientContext`.
2. 先将配方及参考素材保存在浏览器 outbox, 再发请求. 同一请求编号不得代表不同意图.
3. 由服务端校验能力并选择 Provider, 转换 Images JSON / multipart 或 Responses 图片工具调用.
4. 通过 `/api/jobs/me` 轮询, 活动任务和未领取结果完整返回, 已结束历史使用游标分页.
5. 将所有返回图片和已消费 job ID 放在同一个 IndexedDB 事务中. 事务成功后才发送 `/api/jobs/:id/ack`.
6. 使用稳定完成时间. 删除作品后不得再次导入已消费任务. 删除系列时处理其所有版本.
7. 将生成作品/参考图/蒙版保存在浏览器. 服务端仅对生成图片进行内存短期中转, 通常 30 分钟, 领取且无活动依赖后释放. 允许管理员录入的风格示例图持久化到风格数据目录, 不将其作为用户作品库.
8. 将任务元信息和幂等键保留 7 天. 重启后将 pending 标记为可恢复中断, running 标记为结果未知, 未领取成功结果标记为已过期.
9. 从本地配方恢复未执行任务. 对结果未知的付费请求要求用户明确重新生成, 禁止自动重发.
10. 让后续分镜使用首镜参考. 首镜内存已释放时使用本地原图快照, 服务端校验作品身份和图片 SHA256.

## 必须守住的约束

- 只在用户明确要求并确认后执行 Git commit, 不自行提交, 不 amend.
- 永远不将 API Key 下发到浏览器. 所有上游调用必须经服务端模块并使用 `readLocalConfig()`.
- 使用一个 Node 进程和一个图像 worker. 固定 `imageConcurrency: 1`, 不增加 PM2 cluster worker 或容器副本.
- 不把 `config/local.config.json`, `data/`, `logs/` 或测试生成图片提交到 Git.
- 修改配置字段时同步 `config/local.config.example.json` 与 `docs/DEPLOY.md` 字段表.
- 将图像环境变量覆盖到所选默认图像通道, 将 `TEXT_*` 覆盖到首个文本通道, 保留其他通道独立配置.
- 拒绝生产占位密码/密钥, 不绕过校验. 配置与部署细节只在 `docs/DEPLOY.md` 维护.
- 保存真实输出格式和尺寸, 不根据请求值伪造文件类型. 不提供 Seed/CFG/步数/参考权重占位控件.
- 从作品进入局部重绘时继承原配方, 固定画幅/质量/背景/格式/压缩率, 使用原通道与原图文件, 不叠加其他画风或隐式缩图. 将参考图生成与局部重绘明确区分, 清空蒙版不得变成整图生成.
- 保持系列梗概/分镜剧本统一输入, 从中提取主体要求. 不添加独立主体设定字段, 保留可选参考图和首镜参考链.
- 将系列拆解与生图分开: 拆解只生成可编辑草稿, 经用户检查并点击确认生成后才入队. 不在拆解成功, 草稿恢复或全局快捷键中自动提交图片任务.
- 通过 `/api/styles` 读取已上架风格和真实分类数. 仅在首次启动风格库时导入 `server/style-seed/catalog.json` 的 36 款及对应示例图; 更新和重启不得覆盖编辑或恢复删除项.
- 保持风格录入以图片和完整提示词为必填, 作者可留空, 名称/分类/来源/排序为可选项. 不添加标签, 英文名或独立画风描述. 保留原文, 不自动翻译或追加隐藏画风.
- 将风格模板仅用于单图创作. 系列从梗概/分镜的画面要求, 可选参考图和首镜参考链保持连贯, 不增加风格库选择入口.
- 对风格管理使用独立管理员会话, 不与普通生成权限互相授权. 保存采用版本校验, 备份包含图片与文本, 导入先预览并全量校验后事务合并.
- 在接受新增/修改/导入前校验整个风格库可完整导出和恢复, 不生成超过导入限制的备份. 清理无引用示例图, 保留初始素材署名与许可.
- 将本机手动测试与 Docker 的数据目录和网页地址隔离; 不修改真实部署密码和图像通道来运行自动测试.
- 通过 Tailwind 3 + PostCSS 编译 React 源码类名, 不依赖设计稿目录参与生产构建. 复用语义色与本地图标字体.
- 修改后运行直接相关测试. 发布前检查 `npm test`, 浏览器验收, Docker 验收和 `git diff --check`.
