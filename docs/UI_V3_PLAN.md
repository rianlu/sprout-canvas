# 芽绘台 UI v3 重构 · 执行计划清单

> 用途: 跟踪 Stitch Botanical Paper Studio 方案 (PRD v3.0 + DESIGN.md v3.0) 的落地进度.
> 规则: 每完成一项把 `[ ]` 改为 `[x]`; 发现新工作随时补条目; 阶段全部完成后在阶段末尾记一行完成日期.
> 参照: 设计规范 `docs/DESIGN.md` (§9 移植规则) / 功能边界 `docs/PRD.md` v3 / 设计稿 `stitch_sproutcanvas_studio/`.
> 策略: **逻辑层 (hooks/lib/types) 保留复用, UI 层 (styles.css/pages/components) 重写**. 交互协议不变 (202 + 轮询 + placeholderId 回填).

## 阶段 0 · 前置还债与基建

- [x] 0.1 删除旧入口资产: `js/app.js` + `css/styles.css` (服务端已不回退, 仅 test:legacy 引用)
- [x] 0.2 `package.json`: 移除 `test:legacy` 脚本, `test` 链去掉对应调用
- [x] 0.3 检查 `index.html` 无 `js/app.js` / `css/styles.css` 引用残留 (当前已确认无)
- [x] 0.4 下载字体 woff2 到 `public/fonts/` (Outfit 500/600, Inter 400/500, JetBrains Mono 400/500, latin 子集) + 附 OFL license 文件
- [x] 0.5 `index.html`: favicon 渐变改 `#9DBEA6 → #597445` (v3 品牌标记), 加字体 preload; 首屏主题内联脚本保持默认 light
- [ ] 0.6 确认 `stitch_sproutcanvas_studio/` 是否入库 (建议入库作为设计参照; 未跟踪)
- [ ] 0.7 提交: 主题「chore: remove legacy entry assets」

## 阶段 1 · CSS token 基建 (DESIGN.md §2-§4)

- [x] 1.1 重写 `src/styles.css` 顶部 token 层: `:root` (dark) + `:root[data-theme="light"]` 双主题全量 token (基础表面 / 强调 / 语义 / 阴影四档 / 圆角五档 / 字体三栈 / 字号九档)
- [x] 1.2 新增纸面层次 token: `--card / --well / --well-deep / --bar / --accent-soft / --accent-soft-on / --shadow-lift / --shadow-pop`
- [x] 1.3 `@font-face` 自托管声明 (font-display: swap) + 全局 reset/基础样式 (body 底色渐变 / focus-visible 焦点环 / reduced-motion 降级)
- [x] 1.4 验收: `npm run build` 通过; 用临时测试页 (或直接在旧页面上) 确认双主题切换无未定义变量
- [x] 1.5 提交: 主题「feat(css): v3 token foundation (botanical paper)」

## 阶段 2 · 应用骨架 (顶栏 + 布局)

- [x] 2.1 重写 `src/components/layout/AppShell.tsx`: 固定顶栏 64px (品牌区 + nav-segmented 四页 + 状态点 + 队列入口 + 主题切换) + `.app-frame` 主区
- [x] 2.2 响应式断点 1280/1024/768/640: 顶栏副标隐藏 / 导航换行 / 品牌收 mark (DESIGN.md §5 断点表)
- [x] 2.3 `src/app/App.tsx`: `PageKey` 扩为 `'studio' | 'series' | 'styles' | 'gallery'`, 移除 `'split'` 导航位 (切图入工具抽屉)
- [x] 2.4 登录页套新视觉 (`.login-card`: eyebrow + display 标题 + 密码 + 主按钮)
- [x] 2.5 移除旧 CSS 的 `.sidebar/.nav-item/.app-shell` 等旧骨架类
- [x] 2.6 验收: 四页切换正常, 双主题正常, `npm run build` + `npm test` 通过
- [x] 2.7 提交: 主题「feat(shell): top-bar navigation frame」

## 阶段 3 · 全局组件 (队列抽屉 + toast)

- [ ] 3.1 重写 `src/components/queue/QueueDock.tsx` → `QueueDrawer.tsx`: 右侧滑出 352px, 顶栏按钮徽标 (active+queued 计数), 任务卡 (状态/位次/进度/取消/重试), 底部「清空已完成」
- [ ] 3.2 状态诚实化: 进度环只表达「生成中」+ 已等待时长 (elapsedMs), 不做假百分比 (PRD §7.1); 显示 `yourPosition`/`estimatedWaitMs`
- [ ] 3.3 toast 组件化 (三态 success/error/info, 底部胶囊, 自动消失); 替换页面内散落的局部 toast state
- [ ] 3.4 验收: 提交任务后抽屉数据实时更新; 取消/重试可用; 页面隐藏时轮询暂停
- [ ] 3.5 提交: 主题「feat(queue): slide-out queue drawer」

## 阶段 4 · 单图创作页 (最大块)

- [x] 4.1 重写 `src/pages/CreativeStudio.tsx`: 双栏布局 (左 440px control-rail sticky + 右 result-stream); 三子模式 tabs (文生图/参考生成/局部编辑)
- [x] 4.2 PromptWell 组件: auto-grow textarea + 字数统计 + 清空/润色扩写 (调 `/api/text`) + 已选风格 pill (可清除)
- [x] 4.3 快捷风格 pills 横滑条 + 「更多风格」跳风格库页
- [x] 4.4 ReferenceUploader 重写: 拖拽/粘贴/展馆选取; 缩略卡 (64px) + 已载入徽标 + 蒙版状态条
- [x] 4.5 GenerationSettingsPanel 重写: 比例格 (3 列小卡 + 比例示意) / 清晰度 / 质量 / 数量 (1/2/4) / 背景 toggle / 高级折叠 (格式/压缩率) / 实际尺寸预览
- [x] 4.6 提交按钮 `generate-cta` (全宽 accent + ⌘+Enter 实装)
- [x] 4.7 ResultGrid 重写: 大卡 1/2 列; 生成中卡 (呼吸底 + spinner + 位次 + 中断) / 完成卡 (hover 动作条: 下载/设为参考/局部修改/全屏) / 失败卡 (错误摘要 + 修改提示词 + 重试)
- [x] 4.8 复用验证: useQueue/useGallery/drafts/storage 零改动接入 (若需扩 fields, 保持向后兼容)
- [x] 4.9 验收: 完整走一遍 文生图 → 参考 → 失败重试 → 下载
- [x] 4.10 提交: 主题「feat(studio): creative studio page v3」

## 阶段 5 · 画笔蒙版 (局部编辑核心新能力)

- [ ] 5.1 重写 `src/components/editor/RegionEditor.tsx` → `MaskEditor.tsx`: 全屏模态画布; 画笔/橡皮/撤销/清空工具栏; 画笔尺寸滑杆 (5-80px)
- [ ] 5.2 蒙版渲染: Canvas 叠加层 (`--accent-tint-strong` 半透明) + 笔画记录栈 (支持撤销); 输出 dataUrl 兼容现有 `maskFactory` 钩子
- [ ] 5.3 蒙版语义: 透明=重绘区 (对齐现有 `createRectMaskDataUrl` 的输出约定, 需先读 `src/lib/editor/mask.ts` 确认颜色通道语义再实现)
- [ ] 5.4 输入校验: 无蒙版时提交走普通 edits; 蒙版+prompt 双必填提示
- [ ] 5.5 验收: 与上游真实调试一次 edits + mask (可暂用 tests/real-api-smoke.mjs 思路验证)
- [ ] 5.6 提交: 主题「feat(editor): brush mask editor」

## 阶段 6 · 系列策划页

- [x] 6.1 重写 `src/pages/SeriesStudio.tsx`: 工作流工具条 (类型 segmented: 绘本连环画/电商长图/视频分镜/IP图库 ↔ 现有 BatchMode 映射) + 幕数 stepper (2-16) + 风格选择按钮 + 主题输入 + 「自动拆解故事」
- [x] 6.2 分镜卡网格 (1/2/4 列): 编号徽标 + 标题 + 状态三态 (就绪/渲染中/等待) + 16:9 图区 + 描述 2 行截断 (点开微调) + 卡底动作 (微调/重绘/移除)
- [x] 6.3 分镜插入位: 卡间「+ 添加镜头」, 支持任意位置增补
- [x] 6.4 逐卡独立提交/重绘 (等价单任务提交 + 排除失败链), 批量「一键渲染」
- [x] 6.5 验收: 拆解 → 编辑 → 批量提交 → 逐卡回填 → 单卡重绘全流程
- [x] 6.6 提交: 主题「feat(series): storyboard planning page」

## 阶段 7 · 风格库页 (新页面)

- [ ] 7.1 新建 `src/pages/StylesLibrary.tsx` + 路由接入; 吸顶搜索条 (⌘K 聚焦) + 分类 pills 横滑 (数量徽标) + 视图切换
- [ ] 7.2 风格卡网格 (3/2/1 列): 普通卡 (名称/英文名/描述/标签) + 高级卡 (示例图 + 用法说明); 选中态
- [ ] 7.3 卡片动作: 复制提示词 (写剪贴板 + toast) / 发送到创作台 (跳页 + 选中持久化)
- [ ] 7.4 详情灯箱: 大图 + 完整模板 (mono 块 + 复制) + 用法说明
- [ ] 7.5 示例图自托管: 高级风格示例图存 `public/styles/` (Stitch 外链图不可用); 风格数据源复用 `src/lib/styles/image-styles.ts`
- [ ] 7.6 验收: 搜索/分类/复制/发送全通; 创作页能看到已选风格 pill
- [ ] 7.7 提交: 主题「feat(styles): styles library page」

## 阶段 8 · 展馆页 + 大图查看器

- [ ] 8.1 GalleryGrid 重写: 按天分组流 (今日/近 7 天/更早) + sticky 组头 + 计数徽标; 卡片 (图 + prompt 摘要 + 元数据胶囊, 无服务商信息)
- [ ] 8.2 大图查看器升级: 左右切换 (按钮 + 键盘 ←→) / 缩放 / prompt 全文 / 下载 (文件名含 prompt 摘要与日期) / 删除 / ESC
- [ ] 8.3 单张删除 + 全部清空 (确认对话框, focus trap)
- [ ] 8.4 验收: 生成→入馆→查看→下载→删除全链路
- [ ] 8.5 提交: 主题「feat(gallery): gallery page + viewer v3」

## 阶段 9 · 切图工具抽屉 + 收尾

- [ ] 9.1 SplitTool 改造: 独立页 → 创作页工具抽屉/弹层 (入口: 垫图区 + 展馆卡动作)
- [ ] 9.2 功能迁移: 行×列切分 + 切片网格 + 下载 + 「作为参考图送创作」
- [ ] 9.3 清理: 删除残留旧 CSS 类 / 无用组件 / 死代码; `tsc -b` 零警告
- [ ] 9.4 全量验收: `npm test` 全绿 + 四页 + 双主题 + 响应式断点手动过一遍
- [ ] 9.5 文档收尾: PRD/DESIGN 变更记录登记实现完成; AGENTS.md 页面结构描述同步最终态
- [ ] 9.6 提交: 主题「feat: UI v3 complete」

---

## 变更记录

- 2026-09-05: 初版计划清单 (9 阶段). 依据: PRD v3.0 + DESIGN.md v3.0 + 前后端调研结论 (逻辑层复用/UI 层重写, 交互协议不变).
