# 芽绘台 / SproutCanvas

多 Provider 图像生成工作台, 支持文生图, 参考图生成, 蒙版编辑, 系列策划和浏览器本地展馆.

## 快速开始

1. 安装 Node.js 22.13 或更新版本, 推荐使用 Node.js 22 LTS 的最新补丁版本.
2. 执行 `npm ci`.
3. 将 `config/local.config.example.json` 复制为 `config/local.config.json`, 填写图像/文本通道和访问密码.
4. 执行 `npm start`, 打开 `http://127.0.0.1:8787`.

保持 `imageConcurrency: 1`. API Key 只由服务端持有. 生产配置拒绝占位密钥和不足 10 位的访问密码.

## 当前功能

- 单图一次提交 1/2/4 个独立任务, 顺序生成并逐张保存.
- 使用参考图和透明蒙版进行局部编辑, 保存并复用完整生成配方.
- 使用绘本, 电商, 视频分镜, 品牌 IP 四类模板规划 3-8 幕, 支持单镜编辑, 重绘, 版本查看和部分失败续交.
- 浏览 36 款开源风格预设, 使用 6 类真实计数, 查看作者与来源, 复制模板或应用画风.
- 在本地展馆检索, 下载原图/ZIP, 或调用浏览器系统文件分享. 删除直接生效, 不提供精选收藏或回收站.

服务器只在内存临时中转图片. SQLite 保存任务元信息, 幂等键和会话, 不保存图片/蒙版/带图请求. 作品与草稿保存在当前浏览器, 喜欢的作品请下载.

## 开发与验证

- 在一个终端运行 `npm run dev:api`, 另一个终端运行 `npm run dev`.
- 执行 `npm test`, 验证配置, 生成契约, 路由, HTTP, 领取和重启恢复, 并构建前端.
- 执行 `npm run test:browser`, 使用隔离浏览器和虚拟上游验证完整交互. 有系统 Chrome 时直接使用; 否则先运行 `npx playwright install chromium`.
- 执行 `docker build -t sprout-canvas:verify .`, 再执行 `npm run test:docker`, 验证容器页面, 产物一致性, 会话恢复和健康检查.
- 执行 `npm audit`, 检查包括构建工具在内的依赖. 上述自动测试均不调用真实生图通道.

## 文档

- [功能清单与架构评估](docs/FEATURE_ARCHITECTURE_REVIEW.md)
- [Stitch UI 对齐记录](docs/UI_STITCH_ALIGNMENT.md)
- [真实通道能力验证](docs/REAL_API_VALIDATION.md)
- [产品需求](docs/PRD.md), [设计规范](docs/DESIGN.md), [部署与配置](docs/DEPLOY.md)

当前已测通道按 PNG 提供生成, 请求尺寸作为目标画幅, 下载和查看器以真实文件格式/尺寸为准. Seed, CFG, 步数和参考权重不作为用户参数提供.

风格素材来源与许可见 [ATTRIBUTION.txt](public/assets/styles/ATTRIBUTION.txt). 保留原作者署名和 CC BY 4.0 许可, 不将示例图当作本模型效果承诺.
