# 部署与配置指南

更新日期: 2026-09-07. 使用 Node.js >=22.13, 推荐 Node.js 22 LTS 最新补丁版本. 保持单实例, 单图像 worker.

## 1. 配置要求

- 将 `config/local.config.example.json` 复制为 `config/local.config.json`, 填入自己的配置.
- 保持 API Key 只在服务端, 不在网页提供密钥输入或暴露配置文件.
- 不提交真实配置, `data/`, `logs/` 或 `.env`. 生产环境拒绝包含 change-this, your-, example 的占位密钥/密码, 并要求访问密码至少 10 位.
- 不将 SQLite 文件视为图库备份. 数据库只保存任务元信息, 幂等键和会话 token 哈希.

### 1.1 根字段

| 字段 | 默认/要求 | 说明 |
|---|---|---|
| `imageProviders[]` | 至少一个 | 图像通道列表, 自动路由时按兼容性与健康状态选择 |
| `textProviders[]` | 至少一个 | 文本通道主备列表, 首项为主通道 |
| `defaultImageProvider` | 首个图像通道 | 必须匹配图像通道 ID |
| `accessPassword` | 生产必填 | 共享访问密码, 不代表独立用户账户 |
| `imageConcurrency` | `1` | 只接受 1, 其他值报错, 不提高并发 |
| `host` | `127.0.0.1` | Docker 镜像通过环境变量设置为 `0.0.0.0` |
| `port` | `8787` | 必须为 1-65535 的整数 |
| `stateFile` | `data/runtime.sqlite` | SQLite 文件路径, 相对路径按项目根目录解析 |
| `authSessionDays` | `7` | 登录有效天数, 至少 1 天 |
| `secureCookies` | `false` | HTTPS 部署设置 true |
| `logFile` | `logs/server.log` | 应用日志路径 |

### 1.2 Provider 字段

| 字段 | 图像通道 | 文本通道 |
|---|---|---|
| `id` | 使用唯一稳定 ID | 使用唯一稳定 ID |
| `name` | 页面显示名称 | 页面显示名称 |
| `baseUrl` | HTTP(S) API 地址, 末尾 `/v1` 自动移除 | 同左 |
| `apiKey` | 服务端密钥 | 服务端密钥 |
| `imageModel` | Images 使用图像模型; Responses 使用调用图片工具的模型 | 不使用 |
| `model` / `textModel` | `model` 可作为 imageModel 的输入别名 | 文本模型, 走 `/v1/chat/completions` |
| `generationMode` | `images` 或 `responses`, 默认 images | 不使用 |
| `capabilities.outputFormats` | 非空数组, 可选 png/jpeg/webp, 默认三种. 按实际通道验证收敛 | 不使用 |
| `capabilities.exactSize` | 布尔值, 默认 false. 只有验证输出严格遵守请求像素后才设 true | 不使用 |
| `requestHeaders` | 可选请求头对象, 支持 `{{timestamp}}` 和 `{{sessionId}}` 替换 | 同左 |

- 当前已测 default 通道使用 `outputFormats: ["png"]`, `exactSize: false`. 该选择来自真实文件检查, 不是按文件扩展名猜测.
- `exactSize` 控制尺寸说明, 不改变上游实际能力. gpt-image-2 的 Images 模式支持自定义目标尺寸; 其他模式使用标准尺寸.
- 新配置只使用 `imageProviders[]` 和 `textProviders[]`. 旧单通道/`providers` 字段仅供已有配置读取, 不新增第二套配置方式.
- 图像/文本通道 ID 分别保持唯一. 不在 requestHeaders 中下发浏览器需要持有的凭据.

### 1.3 环境变量优先级

| 环境变量 | 覆盖范围 |
|---|---|
| `DEFAULT_IMAGE_PROVIDER` | 选择默认图像通道 ID |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `IMAGE_MODEL`, `GENERATION_MODE` | 覆盖默认图像通道对应字段, 包括存在完整 providers 数组的情况; 不修改其他备用通道 |
| `TEXT_BASE_URL`, `TEXT_API_KEY`, `TEXT_MODEL` | 覆盖首个文本通道, 保持备用文本通道独立 |
| `HOST`, `PORT` | 监听地址与端口 |
| `STATE_FILE` | SQLite 文件路径 |
| `ACCESS_PASSWORD` | 访问密码 |
| `AUTH_SESSION_DAYS` | 会话有效天数 |
| `SECURE_COOKIES` | 接受 1/true 或 0/false, 显式 false 也可覆盖文件中的 true |
| `IMAGE_CONCURRENCY` | 只允许 1 |
| `LOG_FILE` | 应用日志路径 |

保留旧 `ANYROUTER_BASE_URL`, `ANYROUTER_API_KEY`, `DEFAULT_PROVIDER` 别名供现有配置读取; 有对应的新变量时以新变量为准. 没有独立文本配置时, 旧单通道字段可提供文本通道默认值. 部署新环境时填写明确的两类 Provider 数组.

## 2. 本地启动

```sh
npm ci
npm test
npm run start:server
```

打开 `http://127.0.0.1:8787`, 使用配置密码登录. `/health` 检查进程, `/ready` 检查配置和就绪状态; 两者都不发起上游生图.

开发时在两个终端分别运行:

```sh
npm run dev:api
```

```sh
npm run dev
```

使用 Vite 输出的地址, `/api`, `/health`, `/ready` 代理到 8787. 不同时启动第二个真实 API 服务.

## 3. 生产运行

### 3.1 PM2

```sh
npm ci
npm run pm2:start
npm run pm2:logs
```

- 保持 `instances: 1`, `exec_mode: fork`.
- 保持 `kill_timeout: 460000`, 使服务有时间完成当前上游调用.
- 将内存自动重启阈值设置为 768M, 按实际机器容量监控, 不把队列字节预算当作进程 RSS 上限.
- 按需通过 PM2 保存进程列表和配置开机启动, 不增加多个 worker.

### 3.2 Docker

```sh
docker compose up -d --build
```

- 容器运行 Node 22, 默认监听 `0.0.0.0:8787`, 主机端口为 8888.
- 挂载 `./config:/app/config`, `./logs:/app/logs`, `./data:/app/data`.
- 不挂载 output 图库, 不将图片写到容器文件系统.
- 保持 `stop_grace_period: 460s`. 镜像包含 `/health` 健康检查.
- 保持一个容器副本; 多副本会各自运行一个 worker, 破坏全局并发 1 的约定.

### 3.3 Nginx

将下面 upstream 端口按运行方式选择为 Node 的 8787 或 Docker 的主机 8888:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 450s;
        proxy_send_timeout 450s;
    }
}
```

配置 HTTPS 后设置 `secureCookies: true`. 共享密码用于可信小范围使用, 不把该机制当作公开注册账户系统.

## 4. 任务与图片生命周期

| 数据 | 存放位置 | 清理规则 |
|---|---|---|
| 任务身份, 状态, 配方元信息, 幂等键 | 服务端 SQLite | 保留 7 天 |
| 登录会话 | SQLite, 只存 token SHA256 | 按 authSessionDays 到期 |
| 排队请求, 参考图, 蒙版 | 服务端内存 | 完成/取消后释放或在临时 TTL 清理, 不落盘 |
| 未领取生成结果 | 服务端内存 | 通常 30 分钟, ack 且无活动依赖后释放 |
| 作品, 参考素材, 缩略图, outbox, 草稿 | 浏览器 IndexedDB | 由本地删除/清理操作释放, 不同步到服务端图库 |

- 将全局等待任务限制为 128, 每用户等待任务限制为 32, 超限返回 429.
- 将保留请求/结果预算限制为 128 MiB, 单次请求体/上游图片响应限制为 64 MiB. 参考图每张最多 12 MiB, 最多 4 张, 仍须满足总请求体限制.
- 保持 Images 上游超时 180 秒, Responses 图片调用超时 420 秒, 文本调用超时 60 秒.
- 优雅关闭时停止接收新任务, 等待当前任务, 最长 450 秒. 进程强制结束后不假定上游未执行.
- 重启后 pending 标记为 interrupted, 可由原浏览器的配方恢复; running 标记为结果未知, 不自动重发; 未领取成功图片标记为 expired.
- 对网络中断和无法可靠解析的生成结果停止自动重发, 防止重复付费. 显式上游错误可按路由策略尝试兼容通道.
- 浏览器刷新可继续领取服务仍保留的结果. 关闭页面超过临时保留期, 清除浏览器数据或重启服务可能使未保存图片丢失, 应及时下载喜欢的作品.

## 5. API 与验证

| 接口 | 用途 |
|---|---|
| `POST /api/jobs` | 唯一生成提交入口, 含 requestId, request, clientContext |
| `GET /api/jobs/me` | 完整活动/未领取同步与历史分页; limit 默认 30, 最大 100; cursor 加载下一页 |
| `GET /api/jobs/me?requests=id1,id2` | 补查本地 outbox 对应请求, 每次最多 100 个 |
| `GET /api/jobs/:id` / `result` | 状态与临时结果 |
| `PATCH /api/jobs/:id` | 更新本人尚未执行的任务 |
| `DELETE /api/jobs/:id` | 取消本人待执行任务, running 返回 409 |
| `POST /api/jobs/:id/priority` | 置顶到本人的待执行队列 |
| `POST /api/jobs/:id/ack` | 确认本地事务已保存图片 |
| `POST /api/jobs/:id/resume` | 使用原请求恢复重启前尚未执行的任务 |
| `POST /api/jobs/archive` | 持久化收起已保存/已取消任务 |
| `POST /api/text` | 提示词润色和系列拆解 |
| `/api/auth/status`, `login`, `logout` | 会话状态, 登录, 退出 |

- 用新的 requestId 和 retryOf 显式重新生成失败任务, 不重复提交已受理批次.
- 不调用已删除的 `/api/images/*`, `/api/jobs/images/*`, `/api/responses`, `/api/models`.
- 上线前执行 `npm test`, `npm run test:browser`, `docker build -t sprout-canvas:verify .`, `npm run test:docker` 和 `git diff --check`.
- 在 Linux CI 中先运行 `npx playwright install --with-deps chromium`. 在本机可使用系统 Chrome 或 `SPROUT_BROWSER_EXECUTABLE`.
- 使用 `SPROUT_TEST_OUTPUT` 指定测试产物目录, 使用 `SPROUT_TEST_IMAGE` 指定容器验收镜像. 自动测试均使用虚拟密钥/上游, 不消费真实生成额度.
- 查看 `.github/workflows/verify.yml` 的自动流程. 工作流配置存在不等于远端已运行成功.

## 6. 运维与能力边界

- 查看 `logs/server.log` 或 PM2 日志定位失败通道. 上游错误摘要会脱敏, 不打印密钥或图片正文.
- 通过帮助弹层检查通道状态, 区分未验证, 可用, 最近失败和冷却. 状态反映本次进程的调用记录.
- 在无活动任务时升级并重启, 保留 data 卷. 修改 host/port/stateFile/logFile 后重启服务以使用新值.
- 按 [真实通道验证](REAL_API_VALIDATION.md) 配置格式与尺寸能力, 不因请求返回 200 就断言参数生效.
- 不把浏览器本地展馆描述为服务器历史图库或跨设备同步. 不使用 SQLite 元信息备份替代图片下载.
- 当前为单进程小规模架构, 未进行生产容量压测. 大规模元信息分页 UI, 多实例调度和公开账户系统需要另行设计, 不直接增加容器副本.
