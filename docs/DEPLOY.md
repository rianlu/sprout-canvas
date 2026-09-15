# 部署与配置指南

更新日期: 2026-09-13. 使用 Node.js >=22.13, 推荐 Node.js 22 LTS 最新补丁版本. 保持单实例, 单图像 worker.

## 1. 配置要求

- 将 `config/local.config.example.json` 复制为 `config/local.config.json`, 填入自己的配置.
- 保持 API Key 只在服务端, 不在网页提供密钥输入或暴露配置文件.
- 不提交真实配置, `data/`, `logs/` 或 `.env`. 生产环境拒绝包含 change-this, your-, example 的占位密钥/密码, 并要求生产环境配置 12-256 位管理员密码.
- 不将任务 SQLite 文件视为作品备份. 任务数据库保存任务元信息, 访问码哈希, 点数账本, 文字结果和会话 token 哈希; 风格数据库保存管理员维护的素材信息, 示例图保存在独立图片目录. 使用风格后台导出包含图片和文本的完整备份.

### 1.1 根字段

| 字段 | 默认/要求 | 说明 |
|---|---|---|
| `imageProviders[]` | 至少一个 | 图像通道列表, 自动路由时按兼容性与健康状态选择 |
| `textProviders[]` | 至少一个 | 文本通道主备列表, 首项为主通道 |
| `defaultImageProvider` | 首个图像通道 | 必须匹配图像通道 ID |
| `adminPassword` | 生产必填, 开发默认空 | 要求 12-256 位且非占位; 只授予风格和访问码管理权限, 不下发到浏览器. 开发环境未配置时无法创建访问码 |
| `cookieNamespace` | 默认空 | 为同一主机的独立环境使用不同 Cookie 名称; 最多 64 位字母/数字/下划线/短横线, 修改后重启 |
| `imageConcurrency` | `1` | 只接受 1, 其他值报错, 不提高并发 |
| `host` | `127.0.0.1` | Docker 镜像通过环境变量设置为 `0.0.0.0` |
| `port` | `8787` | 必须为 1-65535 的整数 |
| `dataDir` | `data` | 持久化根目录, 风格位于其 `styles/`; 相对路径按项目根目录解析 |
| `stateFile` | `<dataDir>/runtime.sqlite` | 任务, 访问码, 灵感点账本与会话 SQLite 路径; 显式配置可覆盖默认, 不改变风格存放目录 |
| `authSessionDays` | `7` | 登录有效天数, 至少 1 天 |
| `secureCookies` | `false` | HTTPS 部署设置 true |
| `logFile` | `logs/server.log` | 应用日志路径, 单份最多 10 MiB, 共保留 3 份 |

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
| `DATA_DIR` | 持久化根目录, 同时覆盖默认任务 SQLite 和风格目录; 优先于文件中的 dataDir/stateFile |
| `STATE_FILE` | 显式任务 SQLite 路径, 优先于 DATA_DIR 推导路径 |
| `ADMIN_PASSWORD` | 管理员密码, 仅在服务端使用; 生产环境拒绝空值, 开发环境显式空值关闭管理入口 |
| `COOKIE_NAMESPACE` | 登录 Cookie 名称的环境后缀, 同时区分工作台会话, 浏览器身份与管理会话 |
| `AUTH_SESSION_DAYS` | 会话有效天数 |
| `SECURE_COOKIES` | 接受 1/true 或 0/false, 显式 false 也可覆盖文件中的 true |
| `IMAGE_CONCURRENCY` | 只允许 1 |
| `LOG_FILE` | 应用日志路径 |

保留旧 `ANYROUTER_BASE_URL`, `ANYROUTER_API_KEY`, `DEFAULT_PROVIDER` 别名供现有配置读取; 有对应的新变量时以新变量为准. 没有独立文本配置时, 旧单通道字段可提供文本通道默认值. 部署新环境时填写明确的两类 Provider 数组.

## 2. 本地启动

### 2.1 与 Docker 隔离的手动测试

```sh
npm ci
npm run start:local
```

- 先打开本机独立后台创建测试访问码, 再用该码登录 `http://127.0.0.1:8789`. 本机和 Docker 的访问码与余额独立, 不复用真实部署中的码.
- 打开 `http://127.0.0.1:8789/#admin`, 使用自动生成的独立管理员密码. 从 `~/.local/share/sprout-canvas/local/admin-password.txt` 读取, 文件权限为 0600, 启动日志只显示路径.
- 将任务库, 风格库和日志保存在 `~/.local/share/sprout-canvas/local/`, 不使用 Compose 的项目 `data/` 和 `logs/`. 自动按本机数据目录生成独立 Cookie 名称, 避免同一主机不同端口互相覆盖登录.
- 每次启动复用已有管理员密码与风格数据. 可通过 `ADMIN_PASSWORD` 使用自定密码, 此时不创建或提示密码文件.
- 如需自定路径/端口, 设置 `DATA_DIR` 和 `PORT`. 本机入口固定监听 127.0.0.1, 固定任务库/日志为隔离目录中的文件, 不沿用部署配置的 stateFile/logFile.
- 将本机 8789 和 Docker 8888 视为不同的浏览器存储来源, 不共用作品, 草稿和管理数据. 在本机后台导出备份, 到 Docker 后台导入可迁移已整理的风格.
- 手动测试仍使用配置中的真实 Provider, 点击绘制会调用真实上游; 自动测试使用隔离虚拟配置和上游. 不同时在两个环境进行真实生图, 保持当前上游的串行使用约束.

### 2.2 常规启动与开发

```sh
npm ci
npm test
npm run start:server
```

先打开 `http://127.0.0.1:8787/#admin` 使用管理员密码创建访问码, 再用访问码登录 `http://127.0.0.1:8787`. `/health` 检查进程, `/ready` 检查配置和就绪状态; 两者都不发起上游生图.

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
- 不挂载 output 作品图库, 不将生成作品落盘. 将风格数据库及示例图保存在 `/app/data/styles/`, 由 data 卷持久保存.
- 在配置中设置独立 `adminPassword`, 通过 `http://127.0.0.1:8888/#admin` 进入管理并单独登录. 用户端风格库和导航不展示管理入口, 将该地址保存为管理员书签. 更新镜像保留 data 卷, 不删除或重置 `styles/library.sqlite`.
- 保持 `stop_grace_period: 460s`. 镜像包含 `/health` 健康检查.
- 保持一个容器副本; 多副本会各自运行一个 worker, 破坏全局并发 1 的约定.

#### 3.2.1 临时公网入口

- 仅在需要临时分享时启用 `tunnel` profile. 默认只启动芽绘台, 不自动创建公网入口. 使用 Cloudflare Quick Tunnel 时无需域名, Cloudflare 账号或隧道令牌.
- 在项目根目录的 `.env` 中添加以下配置. 保留已有内容; 若已设置其他 Compose profile, 用逗号追加 `tunnel`. 不提交 `.env`.

```dotenv
COMPOSE_PROFILES=tunnel
```

- 使用同一 Compose 项目启动两个服务. 隧道等待芽绘台健康后连接 `http://sprout-canvas:8787`, 默认自动选择连接协议, 优先使用 QUIC, 无法建立 QUIC 连接时尝试 HTTP/2. 不额外映射主机端口, 不挂载项目配置或数据. 让 Docker 网络能够访问 Cloudflare 的出站 UDP 7844 (QUIC), TCP 7844 (HTTP/2) 和 HTTPS API; 至少保持一种隧道协议可用.

```sh
docker compose up -d
docker compose logs --tail 100 cloudflared
```

- 从最新启动日志中复制 `https://...trycloudflare.com` 地址. 在 Docker Desktop 或 OrbStack 中也可展开 `sprout-canvas` 项目, 打开 `cloudflared` 的日志查看. 使用已有访问码登录, 按 HTTPS 部署要求设置 `secureCookies: true`.
- 在隧道健康检查通过且外网访问正常后分享地址. 日志中的地址仅表示申请成功, 不代表隧道已连接; 若容器显示 `unhealthy`, 检查连接 Cloudflare 的网络和代理, 不通过关闭健康检查掩盖断开状态.
- 在生成和文字处理结束, 图片保存后, 使用整个 Compose 项目的启动/停止按钮, 或执行下面的命令. 单独停止芽绘台容器不会同时停止隧道; `depends_on` 负责启动与整体停止的顺序, 不持续绑定两个容器的运行状态. 隧道最多等待现有请求 3 分钟后关闭, 芽绘台保留独立的任务收尾等待.

```sh
docker compose stop
docker compose up -d
```

- 保持 Docker Desktop 或 OrbStack 运行. 如需登录 Mac 后继续提供服务, 启用所用容器应用的登录启动选项. `unless-stopped` 会恢复之前运行的容器, 已手动停止的项目需再次启动. 允许关闭终端和屏幕, 不让承载服务的电脑休眠或关机.
- 每次隧道进程重新启动都会申请新的临时地址, 从日志获取最新地址再分享. 切换地址前下载需要保留的作品; 不同地址下的浏览器作品, 草稿和登录状态不会自动迁移. 本机地址仍为 `http://127.0.0.1:8888`.
- 在首次切换完成并验证新地址后, 结束原终端中的 `cloudflared` 进程, 避免留下另一个独立运行的入口.
- 将隧道日志限制为每份 10 MiB, 最多 3 份. 仅在容器内的 `127.0.0.1:2000` 提供隧道健康检查. 更新隧道版本时调整 Compose 镜像标签并重新验证连接.
- 停用临时公网入口时先执行 `docker compose stop cloudflared` 和 `docker compose rm cloudflared`, 再从 `.env` 的 `COMPOSE_PROFILES` 中移除 `tunnel`. 只移除已停止的隧道容器, 保留芽绘台和数据.
- 将 Quick Tunnel 用于小范围临时测试, 不承诺固定地址或持续可用性. 需要固定网址时按 [Cloudflare 官方步骤](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/) 配置域名与命名隧道.

通过 `.env` 按需配置隧道出站参数. 临时入口与正式入口共用以下设置:

| 环境变量 | 默认值 | 要求 |
|---|---|---|
| `TUNNEL_PROTOCOL` | `auto` | 保留自动选择, 仅在确认网络限制后指定 `quic` 或 `http2`. |
| `TUNNEL_EDGE_IP_VERSION` | `auto` | 保留 IPv4/IPv6 自动选择, 仅在确认对应线路可用后指定 `4` 或 `6`. |
| `TUNNEL_IPV6` | `false` | 需要 IPv6 出站时设为 `true`, 为隧道专用网络启用 IPv6; 它不会为 WiFi 或路由器提供 IPv6 连接. |

排查连接失败或切换 WiFi 后的断开时:

- 先用 `docker context show` 确认实际容器运行环境, 再检查其网络设置. OrbStack 默认自动跟随 macOS 代理; 本机终端能连接不代表容器连接也正常.
- 在 macOS 使用 `scutil --nwi` 检查当前网络是否具备 IPv6, 结合隧道日志区分连接超时与 TLS 握手中断. 不以浏览器能打开 HTTPS 网页判断隧道的 7844 端口可用.
- 切换 WiFi 后检查已有的 `TUNNEL_EDGE_IP_VERSION=6` 或 `TUNNEL_PROTOCOL=http2` 等强制设置. 优先恢复 `auto`, 再验证实际连接; 不将某个 WiFi 下可用的 IPv6 线路视为所有网络都可用.
- 仅在已确认宿主网络 IPv6 直连可用时设置 `TUNNEL_IPV6=true`, 为隧道专用的 `tunnel-egress` 网络启用 IPv6. 保留 `TUNNEL_EDGE_IP_VERSION=auto`, 不要求普通部署具备 IPv6, 不改变现有应用网络.
- 使用 OrbStack 且已确认代理阻断隧道连接时, 按 [OrbStack 代理文档](https://docs.orbstack.dev/docker/network#proxies) 设置代理例外. 先运行 `orbctl config get network.proxy.exclude` 读取已有值, 再将 Cloudflare 隧道 IPv6 网段 `2606:4700:a0::/48,2606:4700:a8::/48` 追加到该设置, 保留原有例外. 只让这些隧道连接直连, 不关闭全部代理或 TLS 校验.
- 修改隧道参数后执行 `docker compose up -d --no-deps cloudflared`, 重新检查隧道健康状态和公网地址. 切换网络或代理后重复验证, 不以生成了临时地址作为连通依据.

#### 3.2.2 正式公网入口

1. 将自己的域名添加到 Cloudflare, 选择 Free 套餐并核对已有 DNS 记录. 在域名注册商的 DNS 服务器设置中填入 Cloudflare 分配的两条 Nameserver, 等待域名在 Cloudflare 显示 Active. 保留原注册商, 不把 Nameserver 更换当作域名转移.
2. 在 Cloudflare 控制台的 **Networking > Tunnels** 创建由控制台管理的 `cloudflared` 隧道, 例如命名为 `sprout-canvas`. 在连接器安装页面选择 Docker, 将安装命令中 `--token` 后的完整令牌填入本机 `.env` 的 `TUNNEL_TOKEN` 字段. 只填写令牌, 保留已有配置, 不提交或公开 `.env`.

```dotenv
TUNNEL_TOKEN=在这里填写自己的隧道令牌
```

3. 使用下面的命令启动独立的验证连接器, 保留已有临时入口. 通过 Compose secret 将令牌提供给容器内的 `--token-file`, 不将令牌放进容器命令参数或环境变量. 等待 Cloudflare 显示该连接器已经连接, 再继续添加公网路由.

```sh
docker compose -f docker-compose.yml -f docker-compose.named-tunnel.yml run -d --rm --no-deps --name sprout-canvas-tunnel-preview cloudflared
```

4. 在该隧道的 **Routes > Add route > Published application** 添加以下路由. 下表中的 `example.com` 表示自己已接入的域名.

| 字段 | 填写内容 |
|---|---|
| Subdomain | 留空, 使用根域名 |
| Domain | 选择自己的域名, 例如 `example.com` |
| Path | 留空 |
| Service Type | HTTP |
| Service URL | `sprout-canvas:8787`, 指向同一 Docker 网络中的应用 |

5. 等待域名解析和 HTTPS 证书就绪, 验证 `https://example.com/ready` 返回正常, 再检查访问码登录, 页面和风格图片读取. 将示例域名替换为自己的域名. 保持 `secureCookies: true`, 保留现有访问码和独立管理员认证. 切换网址前下载需要保留的作品, 新域名与旧临时地址的浏览器作品和草稿不会自动合并.
6. 验证通过后, 在 `.env` 中设置以下字段, 保留 `TUNNEL_TOKEN` 和已有网络设置. 使用覆盖文件将原 `cloudflared` 服务切换为正式隧道, 继续复用原应用容器和数据.

```dotenv
COMPOSE_PROFILES=tunnel
COMPOSE_FILE=docker-compose.yml:docker-compose.named-tunnel.yml
```

```sh
docker compose config --quiet
docker compose up -d --no-deps cloudflared
docker compose exec cloudflared cloudflared tunnel --metrics 127.0.0.1:2000 ready
```

7. 在正式服务健康检查通过后, 停止验证连接器. `--rm` 会自动移除已停止的验证容器; 再检查固定网址仍可访问.

```sh
docker stop --timeout 190 sprout-canvas-tunnel-preview
```

8. 后续继续使用 `docker compose up -d` 和 `docker compose stop` 整体启停. 保持电脑与容器运行环境在线; 重启正式隧道时继续使用同一域名, 不再分配 `trycloudflare.com` 临时地址. 更换令牌后强制重建隧道容器以更新 secret, 不重建应用容器.

```sh
docker compose up -d --no-deps --force-recreate cloudflared
```

- 按 [Cloudflare 官方指南](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/) 管理隧道和公网路由. 将子域名等入口变更同步到公开地址, 不在应用代码里写死域名.
- 将本机 `.env` 文件权限设为 0600. Compose secret 从该文件加载 `TUNNEL_TOKEN`, 应用容器不接收该令牌. 继续排除 `.env` 的 Git 提交和 Docker 构建上下文.

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
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 450s;
        proxy_send_timeout 450s;
    }
}
```

配置 HTTPS 后设置 `secureCookies: true`. 通过访问码分配小范围测试额度, 不把同码使用者描述为独立账户.

### 3.4 小范围对外使用的基础保护

- 保留反向代理传入的原始 Host, 包括非默认端口; 不把它改成内部服务地址. Vite 的 `/api` 代理已设置 `changeOrigin: false`.
- 对普通和管理写接口统一校验 Origin 与 Sec-Fetch-Site, 拒绝其他来源的浏览器调用. 登录和文本请求只接受 `application/json`. 无浏览器来源头的 CLI 请求仍须通过会话鉴权.
- 将普通登录与管理登录分别限制为同一连接来源 10 分钟内最多 8 次错误尝试; 超限返回 429 与 Retry-After. 成功登录清除对应失败计数, 现有有效会话不受错误登录尝试影响.
- 按 TCP 连接来源限速, 不信任客户端自行填写的 X-Forwarded-For 或其他转发头. 内网穿透或反向代理下, 多个访问者可能共享该来源的登录限制.
- 停用或重置访问码后停止接受该码旧会话的新任务, 取消尚未执行的排队项并返还占用; 已发往上游的任务正常收尾, 原浏览器在会话有效期内仍可领取与确认结果. 修改管理员密码单独撤销旧管理会话.
- 将文本调用限制为全局同时 2 个, 同一浏览器身份同时 1 个; 每分钟同一身份最多 10 次, 全局最多 30 次. 超限返回可读提示和 Retry-After, 不自动排队或重新发起付费调用. 将限流计数保存在进程内, 重启后重新计数.
- 仅从公开 HTTP(S) 地址下载上游返回的图片链接; 校验全部 DNS 结果并将已验证地址固定到连接, 每次重定向重新检查. 禁止回环, 私网, 链路本地, 保留网段及 IPv4 映射 IPv6 等地址, 最多跟随 3 次重定向, 整体下载限时 60 秒并限制文件大小.
- 保留管理员主动配置的 Provider API 地址规则, 不将图片下载地址限制施加到本机虚拟上游. 图片以 base64 返回时不进行额外下载.
- 保持固定保护阈值, 不增加账号注册或支付流程. 对外提供 HTTPS 入口, 使用安全随机访问码和独立管理员密码. 登录来源计数只在短期内存中维护, 不记录 IP 历史.

## 4. 任务与图片生命周期

| 数据 | 存放位置 | 清理规则 |
|---|---|---|
| 任务身份, 状态与配方元信息 | 服务端 SQLite | 保留 7 天 |
| 访问码, 点值规则, 点数操作幂等键与流水 | 任务 SQLite | 持久保留, 不随任务历史清理; 完整访问码只存哈希 |
| 文字完成结果 | 任务 SQLite | 保留 7 天用于同请求结果复用, 过期后仍保留操作与结算记录 |
| 浏览器身份 | 任务 SQLite, Cookie 密钥只存 SHA256 | 浏览器 Cookie 有效期 365 天, 按浏览器和访问码映射任务身份 |
| 工作台登录会话 | 任务 SQLite, 只存 token SHA256 | 按 authSessionDays 到期 |
| 管理会话 | 风格 SQLite, token SHA256 与密码指纹 | 12 小时, 更换管理员密码使旧会话失效 |
| 风格文本/作者/分类/许可 | `<dataDir>/styles/library.sqlite` | 管理员增删改和备份导入维护, 重启/更新不重新覆盖 |
| 风格示例图 | `<dataDir>/styles/images/` | 同内容去重, 替换/删除后清理无引用文件 |
| 排队请求, 参考图, 蒙版 | 服务端内存 | 完成/取消后释放或在临时 TTL 清理, 不落盘 |
| 未领取生成结果 | 服务端内存 | 通常 30 分钟, ack 且无活动依赖后释放 |
| 作品, 参考素材, 缩略图, outbox, 草稿 | 浏览器 IndexedDB | 由本地删除/清理操作释放, 不同步到服务端图库 |

- 将全局等待任务限制为 128, 每用户等待任务限制为 32, 超限返回 429.
- 将保留请求/结果预算限制为 128 MiB, 单次请求体/上游图片响应限制为 64 MiB. 参考图每张最多 12 MiB, 最多 4 张, 仍须满足总请求体限制.
- 保持 Images 上游超时 180 秒, Responses 图片调用超时 420 秒, 文本调用超时 60 秒.
- 优雅关闭时停止接收新任务, 等待在途图片, 已断开浏览器的文字任务及未落账结算, 最长 450 秒. 待落账重试保持进程运行; 进程强制结束后不假定上游未执行.
- 重启后 pending 标记为 interrupted, 可由原浏览器的配方恢复; running 标记为结果未知, 不自动重发; 未领取成功图片标记为 expired.
- 对网络中断和无法可靠解析的生成结果停止自动重发, 防止重复付费. 显式上游错误可按路由策略尝试兼容通道.
- 浏览器刷新或关闭不取消已受理任务, 不触发退款或再次生成. 使用保留 Cookie 与本地数据的同一浏览器重新打开, 继续领取服务仍保留的结果. 关闭页面超过临时保留期, 清除浏览器数据或重启服务可能使未保存图片丢失, 应及时下载喜欢的作品.

### 4.1 风格持久化与备份

- 通过 `/#admin` 登录并查看仪表盘; 使用 `/#admin/styles` 和 `/#admin/access` 直接进入对应管理页, 刷新后保留所在页. 在灵感点用量和创作使用卡片切换今日/本月/累计, 分开展示实际扣减和无限额度等值用量. 用最近 365 天热力图查看每日结算次数, 从待核实事项进入独立用量弹窗.
- 按固定北京时间 (UTC+8) 的成功结算日期读取仪表盘日/月统计, 不随主机或容器 `TZ` 改变. 对手动核实成功使用核实当天, 对重复结算和结果清理保留原日期. 将生图次数按图片任务统计, 不以偶然返回的多张图片重算; 只对灵感点启用后的记录统计, 不补造旧任务用量.
- 保留 `<dataDir>/styles/library.sqlite` 与 `images/` 的配套数据, 不只复制数据库丢弃图片. 如需直接复制目录, 先在无活动任务时停止服务再复制整个目录.
- 仅在库首次建立时从 `server/style-seed/` 初始化 36 款, 使用初始化标记避免后续版本覆盖管理员编辑和删除记录. 后台上架后普通库读取真实数据, 进入页面/回到标签页时刷新, 可见页面每 30 秒同步一次.
- 在后台点击导出备份, 下载 `sprout-styles-YYYY-MM-DD.json`; 格式为 `sprout-canvas-styles` version 1, 包含元信息和示例图 data URL. 备份不包含管理员密码, 会话, Provider 密钥或用户作品.
- 通过导入备份选择 JSON, 检查新增/更新/相同数量, 确认后按 ID 合并. 保留备份外现有风格, 相同内容重复导入不创建副本. 预览后库有其他变更时重新预览, 不覆盖并发修改.
- 仅接受 PNG/JPEG/WebP 示例图, 每张最多 12 MiB, 最大边 12000px 且不超过 4000 万像素. 网页录入时最长边规范化到 1600px 并转 WebP, 不对生成作品应用此处理.
- 保持最多 1000 条, 提示词最多 24000 字符, 完整 JSON 备份最多 64 MiB. 新增/修改/合并时校验含图片和 UTF-8 文本的完整备份容量, 提前拒绝超限写入并保留已有数据. 为请求包装预留少量空间, 不导出无法重新导入的文件.
- 更换或删除图片时清理无引用文件, 同一图片仍被其他风格引用时保留. 不自动给管理员新增素材套用初始案例许可.

### 4.2 访问码与灵感点

- 首次启动后先用 `adminPassword` 登录 `/#admin`, 打开访问码管理并填写备注和初始灵感点. 需要无限额度时打开点数输入框右侧开关, 数字输入随之禁用. 支持每批 1-100 个码, 完整码只在创建或重置时显示一次, 复制后自行分发. 点击卡片修改设置, 点击卡片用量图标打开独立流水与核实弹窗.
- 使用 `sc_` 加 32 个 Base64URL 随机字符作为访问码, 由服务端生成 24 字节安全随机数据. 不手工设置短码, 不在 URL 或日志中传递完整码. 忘记后使用重置码功能, 保留内部 ID, 余额和流水.
- 不设置访问码有效期. 一码可多人使用并共享余额, 每个浏览器持有独立会话与任务身份. 不收集 IP 历史或设备指纹, 不提供注册与充值. 同一浏览器的本地展馆不是多个独立账户的数据空间.
- 默认图片任务 10 点, 文字处理 1 点. 在后台修改正整数点值, 每项最多 100 万点; 有限额度的单码总剩余点数最多 10 亿点. 调整只能扣除可用点数, 不得侵占已预占部分.
- 显式选择无限额度时保留原有限余额. 无限任务不预占或扣减该余额, 仍将成功任务的等值点数记入累计用量. 每个任务保存 `unlimited` 快照; 切换模式不改变已受理/恢复任务的结算, 新请求需与当前额度模式一致. 无限额度也遵守现有队列和请求频率限制.
- 区分余额字段和额度模式: `unlimited=true` 时界面显示无限, `available` 仍是保留的有限可用余额, 不返回 `Infinity` 或虚构的大额余额. 历史数据迁移默认为有限额度, 保留原余额, 预占, 流水和幂等记录.
- 在同一 SQLite 事务中完成批次校验, 预占与任务记录. 图片成功取得可用结果时扣点, 执行前取消或明确失败时返还. 每个任务按受理时快照结算, 意外返回多张图片不重复计次.
- 对文字和图片统一识别 HTTP 错误, HTTP 200 内的错误正文与 Responses 终止事件. 将 HTTP 408/504/524, 未明确结束的网关错误, 超时错误码, 连接中途断开与截断结果归为待核实, 不自动切换通道或重复生成.
- 对明确的上游拒绝和确认未连接成功的错误返还预占; 允许原有路由对可安全重试的失败切换通道, 最终成功仍只结算一次. 首镜失败时仅核实首镜自身, 返还尚未调用上游的后续分镜.
- 对系列拆解先使用前后端共用规则校验 JSON 数组, 3-8 幕的指定数量及每幕标题/提示词, 再扣文字点数. 无效或不完整的草稿按明确失败处理. 浏览器刷新或重开后先读取已保存请求的文字结果.
- 对已调用上游但在途重启的任务保留预占并显示待核实. 在后台用量明细中核实上游结果, 填写原因后确认扣除或返还. 仅重试写账失败的结算, 不为补记流水重新调用模型.
- 在领取确认丢失后复用已保存的任务编号补确认, 不重复保存作品或扣点. 已成功结果的临时保留期结束不退款; 过期标记与历史清理写入失败时保持进程可用并重试存储.
- 将有限额度余额为零视为可登录但不能新建消耗任务. 浏览风格, 复制模板, 查看与下载本地作品不扣点. 同码消费和模式修改通过轮询同步, 以服务端原子校验为准.
- 停用或重置后, 尚未执行任务取消并返还占用, 已发送任务正常结算. 旧会话在原有效期内可读取和领取自己的结果, 不能新建生成任务. 重新启用后需再次登录, 不恢复旧会话的新建权限.
- 在管理弹窗中确认删除访问码. 有运行中或待核实任务时先停用, 待任务结束或核实后删除; 未执行任务会取消并释放预占. 删除后从列表移除且不可恢复, 旧码不能重新登录或新建任务, 原会话仍可领取已完成结果. 保留数据库中的删除标记, 账本及幂等记录用于核对, 不提供回收站.

### 4.3 从共享密码版升级

1. 在旧版本的独立管理员入口确认密码可用. 让使用者保存未领取图片, 确认没有活动任务后停止服务, 按下节备份完整数据.
2. 保留原 `adminPassword`, Provider 配置, 数据目录和浏览器存储地址, 更新代码并运行 `docker compose up -d --build`. 启动时自动增量迁移 SQLite 结构, 不重置风格或任务.
3. 进入 `http://127.0.0.1:8888/#admin`, 创建首批有限点数访问码. 使用者用新码重新登录. 原 `accessPassword` 和 `ACCESS_PASSWORD` 已不再参与登录或生成授权, 可从旧配置中删除; 不自动生成访问码或赠送无限额度.
4. 尽量在原浏览器直接输入新码, 保留原有效登录 Cookie, 由服务端校验旧会话后接续任务身份. 不根据客户端自报编号认领旧任务, 不追溯扣除历史任务点数.
5. 保留旧作品, 草稿, 参考图和蒙版. 无有效旧会话时无法认领原任务; 从本地材料明确重新创建, 使用新请求编号和当前点值, 不自动补发. 已确认未执行的旧任务恢复也需通过当前访问码预占后才发往上游.

- 在旧版待提交草稿或换码后的继续提交操作中, 先确认图片数量与当前预计灵感点, 再建立新请求. 取消时保留原材料; 确认时原子保存新请求和草稿关联, 为系列重新连接首镜参考. 后续响应丢失或刷新继续复用已确认的新请求编号.

### 4.4 完整数据备份与恢复

- 将风格导出与完整服务备份分开. 风格 JSON 仅包含风格文本和图片, 不包含访问码, 余额, 账本, 普通会话或管理员会话.
- 在无活动任务和未领取图片时停止容器, 使用私有目录备份完整 `data/` 与 `config/`. 单独配置 `STATE_FILE` 时一并备份该文件及同目录 SQLite 附属文件. 不在运行中直接复制 SQLite 主文件而漏掉 WAL.
- 按以下步骤执行默认 Compose 目录的停机备份, 将备份目录保存在项目树外, 不提交到 Git:

```sh
docker compose stop
sprout_backup_dir="$HOME/.local/share/sprout-canvas/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$sprout_backup_dir"
chmod 700 "$sprout_backup_dir"
cp -R data config "$sprout_backup_dir/"
docker compose up -d
```

- 恢复前停止服务并另行保存当前数据. 将备份中的完整 `data/` 和 `config/` 恢复到原挂载位置, 保持目录私有权限, 再启动服务. 不将备份中的旧账本直接合并到正在消费的新账本.
- 恢复后核对风格数量及示例图, 访问码状态, 点值, 可用/占用/累计消耗和用量流水. 数据库恢复不会恢复内存中的未领取生成图片, 作品由使用者的浏览器和下载文件保留.

## 5. API 与验证

| 接口 | 用途 |
|---|---|
| `POST /api/jobs` | 单任务提交, 含 requestId, request, clientContext, creditQuote |
| `POST /api/jobs/batch` | 多图/系列批次原子提交, body 为 jobs 数组, 1-32 项 |
| `GET /api/jobs/me` | 完整活动/未领取同步与历史分页; limit 默认 30, 最大 100; cursor 加载下一页 |
| `GET /api/jobs/me?requests=id1,id2` | 补查本地 outbox 对应请求, 每次最多 100 个 |
| `GET /api/jobs/:id` / `result` | 状态与临时结果 |
| `PATCH /api/jobs/:id` | 更新本人尚未执行的任务 |
| `DELETE /api/jobs/:id` | 取消本人待执行任务, running 返回 409 |
| `POST /api/jobs/:id/priority` | 置顶到本人的待执行队列 |
| `POST /api/jobs/:id/ack` | 确认本地事务已保存图片 |
| `POST /api/jobs/:id/resume` | 使用原请求恢复重启前尚未执行的任务 |
| `POST /api/jobs/archive` | 持久化收起已保存/已取消任务 |
| `POST /api/text` | 文字处理, 含 requestId, kind(prompt/series), input 和 creditQuote; series 额外携带 sceneCount(3-8) |
| `GET /api/text/:requestId` | 按原请求编号读取文字结果, 不再次调用模型 |
| `GET /api/credits` | 当前码可用/占用/累计消耗与点值版本 |
| `/api/auth/status`, `login`, `logout` | 工作台会话状态, 访问码登录和退出; 登录 body 仅接受 code |
| `GET /api/styles` / `/api/styles/images/:file` | 普通登录后读取已上架风格和示例图 |
| `/api/admin/auth/status`, `login`, `logout` | 独立管理登录, 不获得生图权限 |
| `GET /api/admin/overview` | 仅管理员读取当前风格/访问码/待核实, 累计 usage, 今日/本月 usagePeriods 和 365 天 activity, 不返回凭据或用户作品 |
| `GET/POST /api/admin/styles` | 读取全部风格或新建, 新建请求可含 imageDataUrl |
| `PUT/DELETE /api/admin/styles/:id` | 按版本更新或删除, 冲突返回 409 |
| `GET /api/admin/styles/images/:file` | 管理员读取示例图, 包含未上架内容 |
| `GET /api/admin/styles/export` | 导出完整 JSON 备份, 含图片和元信息 |
| `POST /api/admin/styles/import?preview=1` | 校验备份并预览新增/更新/相同数量 |
| `POST /api/admin/styles/import` | 提交 archive 与预览 revision, 事务合并 |
| `GET/POST /api/admin/access-codes` | 分页搜索访问码或单个/批量创建 |
| `GET/PATCH /api/admin/access-codes/:id` | 详情, 备注, unlimited 模式, 启停和带原因的 delta 点数调整, 按 version 一次保存 |
| `DELETE /api/admin/access-codes/:id` | 按 requestId 和 version 删除, 有运行中或待核实操作时返回 409 |
| `POST /api/admin/access-codes/:id/points` / `reset` | 带原因的点数调整或重置码 |
| `GET /api/admin/access-codes/:id/ledger` / `unresolved` | 分页流水与待核实预占, 每页 30 条, 使用返回的 nextCursor |
| `GET/PUT /api/admin/credit-prices` | 读取或按 version 保存图片/文字点值 |
| `POST /api/admin/credit-operations/:id/resolve` | 带原因确认扣除或返还未知结果的预占 |

- 为生成请求携带服务端会话对应的 `creditQuote: { accessCodeId, userId, version, unlimited }`, 不以客户端 userId 授权. 报价版本或额度模式变化返回 409, 刷新点数标记后由用户再次确认. 重放已受理请求沿用原点值和模式; 旧有限额度报价缺少 unlimited 时按 false 校验.
- 为管理写操作携带稳定 requestId, 失败重试复用原编号与相同内容; 修改操作意图时生成新编号. 创建/重置请求重放不再次返回完整码.
- 用新的 requestId 和 retryOf 显式重新生成失败任务. 丢响应时查回原请求或用原编号续交, 不自动重新计点.
- 不调用已删除的 `/api/images/*`, `/api/jobs/images/*`, `/api/responses`, `/api/models`.
- 上线前执行 `npm test`, `npm run test:browser`, `docker build -t sprout-canvas:verify .`, `npm run test:docker` 和 `git diff --check`.
- 在 Linux CI 中先运行 `npx playwright install --with-deps chromium`. 在本机可使用系统 Chrome 或 `SPROUT_BROWSER_EXECUTABLE`.
- 使用 `SPROUT_TEST_OUTPUT` 指定测试产物目录, 使用 `SPROUT_TEST_IMAGE` 指定容器验收镜像. 自动测试均使用虚拟密钥/上游, 不消费真实生成额度.
- 在本机先完成相关验证, 再提交推送. 涉及浏览器交互时, 使用与项目 Playwright 版本一致的 Linux Chromium 容器补充验证:

```sh
npm test
sprout_playwright_version=$(node -p "require('playwright/package.json').version")
sprout_browser_output=$(mktemp -d /tmp/sprout-linux-browser.XXXXXX)
docker run --rm --platform linux/amd64 --init --ipc=host \
  --mount "type=bind,source=$PWD,target=/workspace,readonly" \
  --mount "type=bind,source=$sprout_browser_output,target=/artifacts" \
  --workdir /workspace --env SPROUT_TEST_OUTPUT=/artifacts \
  "mcr.microsoft.com/playwright:v${sprout_playwright_version}-noble" \
  npm run test:browser
docker build -t sprout-canvas:verify .
SPROUT_TEST_OUTPUT="$sprout_browser_output/docker" npm run test:docker
git diff --check
```

- 对容器验收使用独立 Docker 原生数据卷, 避免 macOS 共享目录掩盖 Linux 文件权限差异. 在服务容器内检查 SQLite 的 0600 权限与 token 非明文存储, 再用非拥有者容器验证读取被拒绝. 验收结束后自动移除测试容器和测试卷.
- 查看 `.github/workflows/verify.yml` 的自动流程. 工作流配置存在不等于远端已运行成功.

## 6. 运维与能力边界

- 查看 `logs/server.log` 或 PM2 日志定位失败通道. 上游错误摘要会脱敏, 不打印密钥或图片正文. 应用文件日志按 10 MiB 轮转, 共保留当前文件和 `.1`/`.2` 两份归档; 自动清理更旧内容, 首次遇到已有超大文件时仅保留最近的完整日志行. 将待写文件日志限制为 1 MiB, 堆积超限时保留标准输出并报告文件日志丢弃; 写入失败通过标准错误输出报告.
- 通过帮助弹层检查通道状态, 区分未验证, 可用, 最近失败和冷却. 状态反映本次进程的调用记录.
- 在无活动任务时升级并重启, 保留 data 卷. 修改 host/port/dataDir/stateFile/logFile/cookieNamespace 后重启服务以使用新值. 访问码停用/重置与管理员改密分别控制普通生成权限和管理权限.
- 按 [真实通道验证](REAL_API_VALIDATION.md) 配置格式与尺寸能力, 不因请求返回 200 就断言参数生效.
- 不把浏览器本地展馆描述为服务器历史图库或跨设备同步. 不使用 SQLite 元信息备份替代图片下载.
- 将管理员和普通工作台的 Cookie 分开维护, 写请求只接受同源浏览器调用, 登录限制连续失败尝试. 不将密码填入网页脚本或提交到 Git.
- 在批量录入风格或升级前, 使用风格后台手动导出备份并保留在独立位置, 不将 data 卷视为备份. 重要生成作品仍由用户下载保存.
- 当前为单进程小规模架构, 未进行生产容量压测. 大规模图库, 多实例调度和公开账户系统需要另行设计, 不直接增加容器副本.
