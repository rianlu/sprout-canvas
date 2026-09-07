# 真实图像通道能力验证

验证时间: 2026-09-06 至 2026-09-07, 北京时间. 验证对象: 本地配置的 default 通道, 请求模型字段 `gpt-image-2`.

## 1. 判定与产品处理

- 对当前通道提供 PNG 生成, 将请求尺寸作为目标画幅, 以实际文件尺寸和 MIME 展示/下载结果.
- 保留参考图与蒙版编辑, 已收到可解码图片并检查对应视觉变化.
- 不提供 Seed, CFG, 步数或参考图数值权重. 官方接口未列出这些字段, 当前网关接受明显非法值仍返回图片, 不能证明参数生效.
- 不将本通道结果推广为所有同名模型/网关的行为. Responses 通道只完成模拟协议验证, 本轮没有真实 Responses 通道可测试.

## 2. 真实请求记录

共执行 5 个串行请求, 保持图像并发 1. 第一批在移除旧透传入口前检查网关对未知参数的处理, 第二批通过新版 `POST /api/jobs` 验证文件格式, 透明参考图和蒙版.

| 请求 | 目标 | 实际结果 | 判定 |
|---|---|---|---|
| 基线文生图 | 1024x1024, PNG | PNG, 1254x1254, 成功解码 | 基础生成可用, 精确尺寸未遵守 |
| 非法参数检查 | seed/CFG 字符串非法值, 负步数/权重, 1024x1024 | 仍生成 PNG, 1254x1254 | 接受参数不等于参数有效, 不开放这些控件 |
| 宽屏 JPEG | 1280x720, JPEG | PNG, 1672x940, 1,087,740 bytes, 约 40 秒 | 格式与精确尺寸均未遵守 |
| 透明参考图 | 1024x1024, WebP, transparent, 1 张参考图 | PNG, 1254x1254, 带 alpha, 139,977 bytes, 约 58 秒 | 参考图/透明结果可用, WebP 未遵守 |
| 局部蒙版 | 1024x1024, PNG, 原图与等尺寸透明蒙版 | PNG, 1254x1254, 1,169,078 bytes, 约 46 秒 | 蒙版编辑可用, 输出精确尺寸未遵守 |

- 检查参考图结果中的蓝色芽叶与透明背景.
- 检查蒙版结果右侧叶片变橙, 左叶/茎/背景在视觉上保留. 不将视觉检查表述为蒙版外像素完全一致.
- 按基线原图的实际 1254x1254 制作蒙版, 不按请求的 1024x1024 假定原图尺寸.
- 在领取结果后确认 ack 并归档测试任务, 不把测试作品写入用户浏览器展馆.

非法参数探针实际使用了 `seed`, `cfg`, `cfg_scale`, `steps`, `num_inference_steps`, `weight`, `image_strength`, `reference_image_weight`. 该检查只能证明网关没有拒绝这些非法值, 不能测出不存在的参数有效性.

## 3. 官方接口依据

- 对照 [OpenAI 图像生成指南](https://developers.openai.com/api/docs/guides/image-generation) 和 [Images generate 接口](https://developers.openai.com/api/reference/resources/images/methods/generate).
- 使用接口明确提供的 prompt, size, quality, background, output_format, output_compression 和参考图/蒙版字段.
- 对 gpt-image-2 自定义目标尺寸要求: 两边均为 16 的倍数, 最大边不超过 3840, 长宽比不超过 3, 总像素在 655360-8294400 之间. 超过 3686400 像素属于实验范围.
- 不从 Stable Diffusion 等其他体系借用 Seed/CFG/步数/参考权重参数.
- 将官方模型能力和当前网关实测行为分别记录. 本通道的尺寸/格式表现不满足按请求值直接命名文件的条件.

## 4. 已落实的保护

- 在真实 default 通道配置 `capabilities.outputFormats: ["png"]`, `capabilities.exactSize: false`, 保留原密钥和单 worker 配置.
- 前端通过公开能力信息收敛格式选项, 不让用户重复选择实测未遵守的 JPEG/WebP.
- 由共享领域契约拒绝未知生成参数和透明 JPEG 组合.
- 校验输入图片真实格式与蒙版尺寸. 涂抹区透明表示允许编辑, 保留区不透明.
- 读取返回图片文件头和实际尺寸, 将上游 URL 取回为可保存文件. 不按请求格式伪造 MIME/扩展名.
- 对网络中断, 无图片结果或不可可靠解析的成功响应标记结果未知, 不自动重发可能已计费的任务.
- 服务器只在内存保留临时图片. 测试脚本的文件产物位于本机临时目录, 不构成应用的服务端图库.

## 5. 证据与复现边界

| 证据 | 位置 |
|---|---|
| 第一批参数探针报告和图片 | `/tmp/sprout-real-capabilities/` |
| 第二批领域 API 报告, 参考图, 蒙版和图片 | `/tmp/sprout-real-domain-check/` |
| 可复用真实领域验证脚本 | `~/.codex/scripts/sprout-real-domain-check.mjs` |
| 自动协议/格式验证 | `tests/generation-contract.test.mjs`, `tests/queue-routing.test.mjs`, `tests/server-integration.test.mjs` |
| 浏览器验证 | `tests/browser-check.mjs` |

第二批图片 SHA256:

- JPEG 宽屏请求的实际 PNG: `8dc482b5baa7584d94a28993e8312f04047bf20770f2639773f67af3f1ef191a`.
- 透明参考图结果: `bb438963806db3b0c4fdde677725e7db9bc1f35c7fa3a9448198775295ca3b2e`.
- 蒙版结果: `33a0403353df1ac87cd557972265e377222ddb9eec2bebf4820d4845d134d18f`.

- 本轮完成能力检查后已经限制当前通道格式. 原 JPEG/WebP 探针用于记录调整前网关行为, 不将其作为当前 UI 可选项.
- 不直接运行旧 `sprout-real-capabilities.mjs`, 其透传入口已经移除. 新增真实验证时使用当前领域契约并限定必要请求, 不为了确认构建而再次付费生图.
- 不把单次参考图/蒙版成功推断为人物身份一致性指标, 高分辨率 SLA 或全部质量档位的量化验证.
- 不把模拟 Responses 的 JSON/SSE/多图片测试记为真实 Responses 生图通过.
