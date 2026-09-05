# 芽绘台设计规范 (DESIGN.md)

> 本文档是 UI 设计的**单一事实来源**, 面向人和 AI 协作者. 改 UI 前先读本文.
> 分工: **PRD (`docs/PRD.md`) 管做什么, 本文管长什么样、怎么操作, BRAND (`docs/BRAND_AND_POSITIONING.md`) 管品牌**. 与代码冲突时以代码为准, 但必须先更新本文.
> v3 依据 `stitch_sproutcanvas_studio/` (Botanical Paper Studio 方案) 重写. 移植规则见 §9.

## 0. 设计原则 (决策顺序)

写任何样式/交互前, 按此优先级裁决:

1. **护眼优先** — 长时间创作不刺眼. 新增颜色饱和度/亮度超标即否决.
2. **双主题等价** — 每个颜色决策必须同时给出 light/dark 值 (Stitch 稿只有浅色, dark 值按本表推导).
3. **token 化** — 组件样式只引用 `src/styles.css` 的 CSS 变量; 硬编码色值 = 违规 (含 Tailwind 任意值).
4. **Provider 隐形** — UI 不暴露服务商概念 (无选择器/无结果标注), 失败只有「重试」.
5. **文案务实** — 直白短句, 说明"做什么、怎么做"; 禁止修辞、比喻、口号 (见 §8).
6. **纸面层次** — 深度靠"纸层叠放"表达 (卡 → 井 → 下沉), 阴影一律绿灰调低透明, 禁纯黑投影与荧光发光.
7. **轻盈动效** — ease-out, 150ms 控件 / 200-300ms 面板; 按下 `scale(0.98)`; 禁弹性/回弹动画.
8. **信息密度克制** — 留白区隔顶栏 / 控制轨 / 结果流 / 队列抽屉四大块.

调性关键词: **护眼 · 清新 · 自然 · 专业**. 视觉隐喻: 「自然光下的画纸工坊」— 温暖纸面、植物绿、工匠工具感, 反高科技荧光风.

## 1. 主题机制

- 浅色为**默认品牌主题**, 不跟随系统 `prefers-color-scheme`.
- 载体: `<html data-theme="light|dark">`, token 通过 `[data-theme]` 作用域切换.
- 首屏无闪烁: `index.html` 内联脚本在 React 挂载前读 `localStorage.sprout_canvas_theme` (缺省 light).
- 切换: `src/hooks/useTheme.ts` 同步 `meta[name=theme-color]` (light `#FDFCF8` / dark `#0f1412`).
- favicon: SVG 渐变 `#9DBEA6 → #597445`, 双主题通用.

## 2. 色彩 token

来源: `src/styles.css`. 浅色值 = Stitch Botanical Paper 方案与品牌基准取交集 (冲突时品牌值优先, 见 §9.3); 暗色值 = 现行暗色体系推导.

### 2.1 基础表面

| Token | Light (默认) | Dark | 用途 |
|---|---|---|---|
| `--bg` | `#FDFCF8` | `#0f1412` | 页面底色 (暖纸白 / 近黑绿) |
| `--bg-gradient` | `radial-gradient(circle at top left, rgba(89,116,69,0.10), transparent 28rem)` | `radial-gradient(circle at top left, rgba(157,190,166,0.16), transparent 28rem)` | 顶部氛围渐变 |
| `--bar` | `rgba(253,252,248,0.92)` | `rgba(15,20,18,0.92)` | 固定顶栏 / 吸顶工具条, 配 `backdrop-filter: blur(18px)` |
| `--panel` | `rgba(255,255,255,0.88)` | `rgba(24,32,28,0.78)` | 悬浮面板 / 抽屉, 毛玻璃 |
| `--panel-soft` | `rgba(255,255,255,0.72)` | `rgba(24,32,28,0.54)` | 次级面板 / 结果区外框 |
| `--card` | `#FFFFFF` | `#18211d` | 内容卡最高层纸面: 结果卡 / 分镜卡 / 风格卡 / 任务卡 (Stitch surface-container-lowest) |
| `--well` | `#F4F4F0` | `#1E2924` | 嵌套井: 输入容器内底 / 参数卡内格 / 缩略条底 (Stitch surface-container-low) |
| `--well-deep` | `#EFEFEA` | `#131A16` | 更深一层: 分段控件轨道 / 胶囊底 (Stitch surface-container) |
| `--panel-overlay` | `rgba(255,255,255,0.96)` | `rgba(15,20,18,0.94)` | 模态 / 灯箱面板 |
| `--backdrop` | `rgba(40,50,35,0.55)` | `rgba(0,0,0,0.72)` | 模态遮罩, 配 `blur(12px)` |
| `--text` | `#2A2F28` | `#edf7f0` | 正文 |
| `--muted` | `#798A6F` | `#9fb5a9` | 次要文字 / 占位符 (仅 ≥12px 辅助信息) |
| `--line` | `rgba(85,95,75,0.16)` | `rgba(208,233,218,0.14)` | 常规描边 |
| `--editor-bg` | `#E8E8E0` | `#050806` | 蒙版画布 / 大图查看底 |

### 2.2 强调色 (品牌绿系)

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--accent` | `#597445` | `#9DBEA6` | 主按钮 / 选中态 / 焦点 / 进行中状态 (叶绿 / 灰绿) |
| `--accent-strong` | `#4A6338` | `#7FA389` | hover / active |
| `--accent-on` | `#FFFFFF` | `#07110b` | 强调色上文字 |
| `--accent-soft` | `#D3EABC` | `rgba(157,190,166,0.20)` | 次级选中底: 选中 chip / 徽标 / 推荐标签 (Stitch secondary-container) |
| `--accent-soft-on` | `#576A45` | `#9DBEA6` | `--accent-soft` 上文字 |
| `--accent-tint` | `rgba(89,116,69,0.10)` | `rgba(157,190,166,0.12)` | 选中底色 / 进度条底高亮 |
| `--accent-tint-strong` | `rgba(89,116,69,0.16)` | `rgba(157,190,166,0.18)` | 蒙版预览叠加 / 强选中 |
| `--accent-tint-soft` | `rgba(89,116,69,0.06)` | `rgba(157,190,166,0.08)` | 弱选中 / hover 底 |
| `--accent-border` | `rgba(89,116,69,0.36)` | `rgba(157,190,166,0.38)` | 强调描边 / 虚线拖放区 |

**暗色铁律**: dark accent 是低饱和灰绿 (sage `#9DBEA6`), 不是浅色叶绿的提亮版; 禁止荧光绿 (`#9fe7ba` 已判死刑, 勿复活).

### 2.3 语义色

| 语义 | Light | Dark |
|---|---|---|
| `--danger` | `#C53030` | `#ff8e8e` |
| `--danger-tint` | `rgba(197,48,48,0.10)` | `rgba(255,142,142,0.12)` |
| `--danger-tint-soft` | `rgba(197,48,48,0.06)` | `rgba(255,142,142,0.08)` |
| `--danger-border` | `rgba(197,48,48,0.36)` | `rgba(255,142,142,0.42)` |

成功/信息态一律复用 accent 系, 不另设色.

### 2.4 阴影 (全部绿灰调, 禁纯黑)

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--shadow` | `0 12px 36px rgba(85,95,75,0.10)` | `0 24px 80px rgba(0,0,0,0.34)` | 卡片 / 面板主投影 |
| `--shadow-soft` | `0 8px 24px rgba(85,95,75,0.08)` | `0 12px 40px rgba(0,0,0,0.22)` | 小卡 / 嵌套元素 |
| `--shadow-lift` | `0 4px 12px rgba(89,116,69,0.25)` | `0 4px 16px rgba(0,0,0,0.40)` | 主按钮 / 悬浮徽标 |
| `--shadow-pop` | `0 24px 64px rgba(85,95,75,0.20)` | `0 24px 64px rgba(0,0,0,0.50)` | 模态 / 灯箱 / 抽屉 |

### 2.5 规则

- 新增语义色: 先登记本文, 再写 CSS; light/dark 同步提交.
- 半透明色 rgb 必须与基色一致, 改基色全量替换.
- 正文对比度 ≥ WCAG AA; `--muted` 仅用于 ≥12px 辅助信息.
- 选中态三档: 弱 (`accent-tint-soft`) / 中 (`accent-tint`) / 强 (`accent-soft` 实底).

## 3. 字体与字号

**字体自托管方案 (已敲定)**: 三个品牌字体均以 woff2 内置于 `public/fonts/` (SIL OFL 1.1, 允许自由分发, 需随附 license 文件), `@font-face` 声明 + `font-display: swap`; `index.html` 仅 preload 关键字重. 禁外链字体 CDN (隐私/离线优先). 中文 UI 文本天然回退系统字体 (苹方/微软雅黑), 与 Stitch 稿渲染行为一致, 不视为还原损失.

| Token | 栈 | 用途 |
|---|---|---|
| `--font-ui` | Outfit, -apple-system, "Segoe UI", sans-serif | 导航 / 标题 / 按钮 |
| `--font-body` | Inter, -apple-system, "Segoe UI", sans-serif | 正文 / 表单 |
| `--font-mono` | JetBrains Mono, ui-monospace, monospace | 元数据 / 参数 / 尺寸 / 时间戳 |

字号阶梯 (行高):

| 级 | 字号 | 行高 | 字重 | 用途 |
|---|---|---|---|---|
| display | 48px (`clamp(28px,4vw,48px)`) | 56 | 600 | 登录页大标题 |
| headline-lg | 32px | 40 | 600 | 页面 H1 |
| headline-md | 24px | 32 | 500 | 分区标题 / 灯箱标题 |
| headline-sm | 18px | 26 | 500 | 卡片标题 / 面板标题 |
| body-lg | 16px | 26 | 400 | 提示词正文 / 说明段落 |
| body-md | 14px | 22 | 400 | 正文 / 按钮 / 输入 |
| body-sm | 12px | 18 | 400 | 辅助说明 / chip |
| meta-md | 12px | 16 | 500 (mono) | 元数据胶囊 / 队列摘要 |
| meta-sm | 10px | 14 | 400 (mono) | 微标签 / 计数 (仅配合 ≥12px 主文字) |

正文行高 1.5+; meta 字距 0.02-0.04em; headline 字距 -0.01 ~ -0.02em.

## 4. 空间 · 圆角 · 动效

### 4.1 空间
- 基线: 4px; 常用步进 4/6/8/10/12/16/24/32/48.
- 页面水平留白 (gutter): 24px (≤768px 收 16px).
- 内容最大宽度: 1720px 居中.
- 关键尺寸: 顶栏 64px; 单图控制轨 440px; 队列抽屉 352px; 结果卡图区 aspect-ratio 按所选比例.

### 4.2 圆角 (v3 收敛为中等柔和, 取代旧 24px 大圆角体系)

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 6px | 微徽标 / 计数角标 / mono 小标签 |
| `--radius-md` | 10px | 按钮 / 输入 / chip / 缩略图 |
| `--radius-lg` | 12px | 内容卡 / 任务卡 / 风格卡 / 分镜卡 |
| `--radius-xl` | 16px | 大面板 / 模态 / 灯箱 / 抽屉 / 工具条容器 |
| 胶囊 | 999px | 导航项 / 过滤 pill / toast / 状态徽标 |

### 4.3 动效
- 控件 hover/press: 150ms ease-out; 主按钮 hover 允许 `translateY(-1px)`.
- 面板/抽屉/模态: 200-300ms ease-out (队列抽屉滑入 300ms).
- 生成中状态: 缓慢呼吸 (opacity 0.6↔1, ~2s ease-in-out) 或旋转 spinner; **仅状态指示**, 不做装饰动画.
- 按下统一 `scale(0.98)`.
- `prefers-reduced-motion: reduce` 全量降级 (动画时长 0.01ms).
- 禁: 弹性/回弹/bounce; 长闪烁; 大位移视差.

## 5. 布局骨架 (v3 信息架构, 对齐 PRD v3)

```
app = 固定顶栏 + 主工作区
├─ 顶栏 (fixed, 64px, --bar + blur):
│   品牌 (mark + 名 + 副标) | 分段导航 (单图创作/系列策划/风格库/展馆, 胶囊分段)
│   | 状态点(就绪/异常, 弱化小圆点) | 队列按钮(图标+计数徽标) | 主题切换
├─ 单图创作: 双栏 — 左 440px 控制轨 (sticky, 可滚动) + 右结果流
│   控制轨: 提示词井 → 风格快选 pills → 垫图/蒙版卡 → 参数卡(折叠) → 提交按钮 (sticky 底)
│   结果流: 标题行 + 过滤 pills + 大卡网格 (1列 <1280 / 2列 ≥1280)
├─ 系列策划: 工作流工具条 (类型分段 + 幕数 stepper + 风格按钮 + 主题输入 + 拆解按钮)
│   + 分镜卡网格 (1列 <768 / 2列 <1280 / 4列 ≥1280), 卡间「+」插入位
├─ 风格库: 吸顶搜索条 (搜索 + 视图切换) + 分类 pills 横滑 + 3列卡网格 (≤1024 2列, ≤640 1列)
│   + 详情灯箱 (左图右文双栏)
├─ 展馆: 按天分组流 (今日/近7天/更早) + 大图查看器 (弹层, 左右切换)
└─ 全局: 队列抽屉 (右侧滑出 352px) / toast (底部胶囊) / 模态 (focus trap) / 页脚
```

响应式断点 (v3 对齐 Stitch, 取代旧 1180/980/860/720/560): **1280 / 1024 / 768 / 640**.

| 断点 | 变化 |
|---|---|
| <1280 | 结果流 1 列; 分镜网格 2 列 |
| <1024 | 单图控制轨脱离侧位 (变全宽, 结果流下移); 风格库 2 列; 顶栏副标隐藏 |
| <768 | 导航分段收为顶栏下第二行横滑 pills; 控制轨折叠为底部工作表 (触发条常驻); 队列抽屉全宽; 分镜 1 列 |
| <640 | 风格库/展馆 1 列; 顶栏仅留品牌 mark + 队列徽标 + 主题; 工具条换行堆叠 |

移动端底栏避让: 底部工作表/队列抽屉展开时 toast 上移, 预留 `env(safe-area-inset-bottom)`.

## 6. 组件规格

| 组件 | 类名 (新) | 规格 |
|---|---|---|
| 顶栏 | `.top-bar` | 64px, `--bar`+blur(18), 底边 1px `--line`, 阴影 `0 1px 8px rgba(85,95,75,0.06)` |
| 导航分段 | `.nav-segmented` | 容器 `--well` 底 + `--radius-xl`; 激活项 `--accent` 底 + `--accent-on` 文字 + `--shadow-lift`; 非激活 muted, hover `--well-deep` |
| 队列入口 | `.queue-entry` | `--well` 底胶囊按钮: 图标 + 文字 + 计数徽标 (`--accent-soft` 底, `--accent-soft-on` 文字) |
| 状态点 | `.status-dot` | 8px 圆点; 就绪 `--accent` / 异常 `--danger`; 无动画 |
| 控制轨 | `.control-rail` | 440px 卡: `--card` 底 (light 透明度 0.8 + blur) + `--radius-xl` + `--shadow`; 内距 24px; sticky top 80px |
| 提示词井 | `.prompt-well` | `--well` 底 + `--radius-lg`; focus-within: 描边 `--accent` + 外圈 `--accent-tint`; 底部工具行 (清空/润色 + 计数 mono) |
| 风格 pill | `.style-pill` | 胶囊; 选中 `--accent` 底 + `--accent-on`; 未选 `--well-deep` 底 + muted |
| 垫图卡 | `.ref-panel` | `--well` 容器; 缩略 64px (`--radius-md`); 已载入徽标 `--accent-soft`; 蒙版状态条 `--accent-tint` 底 |
| 参数卡 | `.param-card` | `--well` 内格 + `--radius-lg`; 标签 meta-md muted + 括号参数名 mono |
| 比例选择格 | `.ratio-grid` | 3 列小卡; 选中: `--well-deep` 底 + 2px `--accent` 外圈 + 比例示意图标 |
| 分段控件 | `.seg-control` | 轨道 `--well-deep` + `--radius-md`; 激活块 `--card` 底 + `--shadow-soft` + accent 文字 |
| 开关 | `.switch` | 36×20 胶囊; 开 `--accent`, 关 `--well-deep`; 焦点环 accent |
| 提交按钮 | `.generate-cta` | 全宽 48px, `--accent` 底 + `--accent-on` + `--shadow-lift`; hover `--accent-strong` + `translateY(-1px)`; 快捷键角标 mono |
| 结果流 | `.result-stream` | 网格 `gap 24px`; 卡 `--card` + `--radius-lg` + `--shadow-soft`, hover `--shadow` + 图 `scale(1.02)` |
| 生成中卡 | `.task-card.running` | 图区 `--accent-tint-soft` 呼吸底 + 图标 + 已等待时长 (mono) + 排队位次; 「中断生成」danger 文字链 |
| 完成卡 | `.result-card` | 图 + 底部: 标题行 (headline-sm + 时间 mono) + 元数据胶囊行 (`--well` 底 mono); hover 浮出动作条 (下载/设为参考/局部修改/全屏, `--bar` 底胶囊组) |
| 失败卡 | `.task-card.failed` | `--danger-tint` 底图区 + 图标 + 错误摘要 + 「修改提示词」(ghost) + 「重试」(accent) |
| 分镜卡 | `.shot-card` | `--card` + `--radius-xl`; 头部编号圆标 (`--accent` 底 `--accent-on`) + 标题 + 状态徽标; 16:9 图区; 描述 2 行截断; 卡底动作行 (mono 链接); 等待中: 虚线边框 + 「立即生成」 |
| 插入位 | `.shot-insert` | 卡间虚线 `--accent-border` 胶囊, hover `--accent-tint` |
| 风格卡 | `.style-card` | `--card` + `--radius-lg`; 图区 4:3 + hover `scale(1.05)`; 名称 headline-sm + 英文名 meta; 标签 chips (`--well` 底); 底部双按钮: 复制 (ghost) + 发送 (accent) |
| 详情灯箱 | `.style-detail-modal` | 双栏: 左图右文; 遮罩 `--backdrop`; 面板 `--panel-overlay` + `--radius-xl` + `--shadow-pop`; 提示词模板块 `--well` 底 mono + 复制按钮 |
| 分类 pills | `.filter-pill` | 胶囊; 选中 `--accent`+on; 计数 mono; 容器横滑, 右缘渐隐 |
| 展馆流 | `.gallery-stream` | 按天分组; 组头 sticky (`--bg` 渐隐底) + 计数徽标; 卡: `--card` 横排 (图 200px + 正文列), `--radius-lg` |
| 查看器 | `.gallery-viewer` | 全屏 `--backdrop`; 面板双栏 (图 + 右侧元数据列); 左右切换按钮 + 键盘; prompt 全文; 下载/删除 |
| 队列抽屉 | `.queue-drawer` | 右滑 352px, `--panel` + blur(24) + 左缘 `--shadow-pop`; 头部标题 + 运行数徽标; 任务卡: `--card` + `--radius-lg` + 进度条 (轨道 `--well-deep`, 填充 `--accent`) + 状态/摘要/动作; 底部「清空已完成」 |
| toast | `.toast` | 底部居中胶囊: `--backdrop` 类深底 (inverse: light 下 `#2F312E` 90% / dark 下 `rgba(24,32,28,0.95)`), 反色文字 + 状态图标; 三态 (success/error/info) |
| 登录卡 | `.login-card` | 居中 420px, `--card` + `--radius-xl` + `--shadow`; 品牌 eyebrow + display 标题 + 密码输入 + 主按钮 |
| 页脚 | `.app-footer` | `--well` 底通栏; 品牌名 mono + 版本号 muted; 无外链 |
| 空态 | `.empty-state` | 虚线 `--accent-border` + `--radius-xl` + 一句务实文案 + 可选插图位 |

**反 token 清单** (出现即违规): 纯黑 `#000` 阴影; 高饱和绿 (`#56c986`/`#9fe7ba`); Google CDN 字体/图标; Tailwind 任意值色 (`bg-[#...]`); Material Symbols (换 lucide-react).

## 7. 可访问性底线

- 可交互元素键盘可达; 焦点环 `:focus-visible` 用 `--accent` 2px + offset 3px (禁 `outline: none` 裸奔).
- 图标按钮必须有 `aria-label`; 弹窗 `role="dialog" aria-modal`; focus trap + ESC 分层关闭.
- 状态不只靠颜色区分: 任务状态 = 图标 + 文字 (spinner/沙漏 + "生成中/排队中"); 失败 = 图标 + 错误码文本.
- 图片 alt = prompt 摘要 (截断).
- `--muted` 文字不小于 12px; meta-sm (10px) 只用于胶囊内短计数, 不承载语义.
- 触控目标 ≥ 40px.

## 8. 文案语气规范

**直白、务实、克制. 写"做什么、怎么做", 不写情绪.**

| 场景 | ✅ 正确 | ✗ 错误 (Stitch 原文, 已替换) |
|---|---|---|
| 提示词占位符 | 描述主体、风格、构图、光线… | 让灵感在画布上发芽 |
| 提示词辅助按钮 | 润色扩写 | 魔法润色 |
| 结果空态 | 提交后会显示排队和生成结果. | 你的画布还在等待第一笔 |
| 提交按钮 | 开始绘制 | 开启创作之旅 |
| 队列状态 | 排队中 · 第 3 位 | 灵感正在路上 |
| 系统状态条 | 服务就绪 | 全通道就绪 |
| toast | 图片已保存到展馆 | 画布环境已就绪, 享受创作心流 |
| 顶栏副标 | 图像生成工作台 | 自然心流·灵感绘台 |
| 风格库动作 | 复制提示词 / 发送到创作台 | 唤醒风格 / 让风格流淌 |
| 展馆分组 | 今日 / 近 7 天 / 更早 | 灵感绘卷与单作珍藏 |

规则: 动词+宾语; 一句话说明; 不用比喻/排比/口号/感叹号; 数字用阿拉伯数字.

## 9. Stitch 移植规则 (v3 核心)

### 9.1 技术替换
| Stitch 稿 | 实现 |
|---|---|
| Tailwind CDN + 任意值类 | 全局 `src/styles.css` 自定义类 + token 变量 (见 §6 类名表) |
| Material Symbols 图标 | lucide-react (无新增依赖) |
| Google Fonts (Outfit/Inter/JetBrains Mono) | 自托管 woff2: `public/fonts/*.woff2` + `@font-face` (SIL OFL, 附 license 文件), 禁外链 CDN; 仅 latin 子集 + 用到的字重 (全套 ~120KB) |
| `lh3.googleusercontent.com` 示例图 | `public/` 自托管; 风格示例图按现有 advanced style 数据结构补齐 |
| `animate-pulse/bounce/spin` | 呼吸/spinner/spin 的受限实现, 遵守 §4.3 与 reduced-motion |

### 9.2 色值 → token 映射表 (移植时按此翻译, 禁止直接拷贝色值)

| Stitch token | 映射到 |
|---|---|
| `surface #faf9f5` | `--bg` (品牌值 `#FDFCF8` 优先) |
| `surface-container-lowest #ffffff` | `--card` |
| `surface-container-low #f4f4f0` | `--well` |
| `surface-container #efeeea` | `--well-deep` |
| `primary #415b2f` / `primary-container #597445` | `--accent` `#597445` / hover `--accent-strong` `#4A6338` |
| `on-primary #ffffff` | `--accent-on` |
| `secondary-container #d3eabc` + `on-secondary-container #576a45` | `--accent-soft` + `--accent-soft-on` |
| `secondary-fixed / primary-fixed (#cdecb3/#d3eabc)` | `--accent-soft` (单一化, 不保留 fixed 双档) |
| `on-surface #1b1c1a` | `--text` (品牌值 `#2A2F28` 优先) |
| `on-surface-variant #44483e` / `outline #74796d` | `--muted` (品牌值 `#798A6F` 优先) |
| `outline-variant #c4c8bb` | `--line` (品牌 rgba 优先) |
| `error #ba1a1a` / `error-container #ffdad6` | `--danger` `#C53030` / `--danger-tint` |
| `inverse-surface #2f312e` + `inverse-on-surface` | toast 深底方案 (见 §6 toast) |
| 绿灰阴影 rgba(85,95,75,…) | §2.4 阴影 token 原样采纳 |

### 9.3 冲突裁决 (品牌基准 vs Stitch)
- 基底/文字/强调绿: 双方几乎一致, **品牌值优先** (`--bg`/`--text`/`--muted`/`--accent` 保持 BRAND 文档登记值).
- 圆角: 旧品牌「圆角偏大 (24px+)」→ 采 Stitch 中等柔和体系 (6/10/12/16px, §4.2); BRAND 文档已同步修订.
- 字体三件套与字号阶梯: 采 Stitch (§3).
- 阴影: 双方一致, 无冲突.
- 布局骨架: 采 Stitch (顶栏 + 四页), 详见 PRD v3 §3.

### 9.4 旧类名 → 新类名对照 (实现迁移用)

| 旧类名 (v2 及之前) | 新类名 (v3) |
|---|---|
| `.app-shell` `.sidebar` `.nav-item` | `.app-frame` `.top-bar` `.nav-segmented` |
| `.studio-workbench` `.studio-composer` | `.studio-layout` `.control-rail` |
| `.mode-switcher` | `.mode-tabs` (控制轨内三子模式) |
| `.prompt-panel` `.field` | `.prompt-well` `.param-card` |
| `.dropzone` `.thumb-grid` | `.dropzone` (保留) `.thumb-row` |
| `.region-editor` `.selection-box` | `.mask-canvas` `.mask-brush-*` (画笔蒙版) |
| `.result-grid` `.result-card` | `.result-stream` `.result-card` (保留语义) |
| `.task-card` `.task-placeholder` | `.task-card` (保留) `.task-body` |
| `.queue-dock` `.queue-card` | `.queue-drawer` `.queue-task` |
| `.style-modal` `.style-card` | `.style-detail-modal` `.style-card` (保留语义, 升级为页) |
| `.gallery-stream` `.stream-card` `.gallery-viewer` | 同名保留 |
| `.login-card` `.toast` `.empty-state` | 同名保留 |

未列出的旧类按语义就近归并; 删除旧类时同步清理 `js/app.js` 兼容资产与 `npm run test:legacy` 引用.

## 10. 变更流程

1. 改设计 → 先改本文对应小节 → 再改 `src/styles.css` → `npm run build` 验证.
2. 涉及功能增删 → 先改 `docs/PRD.md`, 再动本文与代码.
3. 涉及品牌绿/命名/圆角体系 → 同步 `docs/BRAND_AND_POSITIONING.md` 并登记变更记录.
4. 外部设计稿 (Stitch 导出 HTML/CSS) 移植: **必须按 §9.2 映射表把色值翻译回 token**, 禁止直接拷贝色值/外链资源, 否则双主题体系会断裂.
5. 本文末尾追加变更记录 (日期 + 摘要).

## 11. 变更记录

- 2026-07-24: 初版 (v1). 敲定双主题配色: 浅色默认, 暗色灰绿 accent, favicon 渐变.
- 2026-07-24: v2 重写. 对齐 PRD v2.0 信息架构 (三页导航); 新增「Provider 隐形」与「文案务实」原则.
- 2026-09-05: v3.0. 依据 Stitch Botanical Paper Studio 稿重写: 布局改顶栏+四页 (单图/系列/风格库/展馆); 圆角体系从 24px 大圆角收敛为 6/10/12/16 中等柔和档; 新增 `--card/--well/--well-deep/--bar/--accent-soft` 等纸面层次 token; 字号阶梯细化 (display/meta 九档); 断点改为 1280/1024/768/640; 队列坞改右侧滑出抽屉; 局部编辑改画笔蒙版画布; 新增 §9 Stitch 移植规则 (色值映射表 / 技术替换 / 旧新类名对照 / 冲突裁决) 与文案替换清单; 阴影 token 扩为四档.
- 2026-09-05: 字体方案敲定为自托管 woff2 (public/fonts/ + @font-face + font-display: swap, SIL OFL 允许分发), 中文回退系统字体与 Stitch 稿行为一致; 图标 lucide-react 构建期打包, 零运行时请求.
