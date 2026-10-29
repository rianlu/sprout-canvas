# 部署与配置指南

更新日期: 2026-10-28. 使用 Node.js >=22.13, 推荐 Node.js 22 LTS 最新补丁版本. 保持单实例, 单图像 worker.

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
| `trustProxy` | `false` | 仅在服务只能经本机/容器网络的反向代理访问时设 true; 登录限速改用代理写入的最后一个 `X-Forwarded-For` 地址, 只信任回环与私网来源 |
| `logFile` | `logs/server.log` | 应用日志路径, 单份最多 10 MiB, 共保留 3 份 |

### 1.2 Provider 字段

| 字段 | 图像通道 | 文本通道 |
|---|---|---|
| `id` | 使用唯一稳定 ID | 使用唯一稳定 ID |
| `name` | 页面显示名称 | 页面显示名称 |
| `baseUrl` | HTTP(S) API 地址, 末尾 `/v1` 自动移除 | 同左 |
| `apiKey` | 服务端密钥 | 服务端密钥 |
| `imageModel` | Images 使用图像模型; Responses 使用调用图片工具的模型 | 不使用 |
| `modelName` | 可选, 1 到 40 字. 页面模型选择的显示与分组名, 同名通道视为同一模型并互为备用. 默认按 imageModel 推导, 如 `gpt-image-2.5` 显示为 `GPT Image 2.5` | 不使用 |
| `model` / `textModel` | `model` 可作为 imageModel 的输入别名 | 文本模型, 走 `/v1/chat/completions` |
| `generationMode` | `images` 或 `responses`, 默认 images | 不使用 |
| `capabilities.outputFormats` | 非空数组, 可选 png/jpeg/webp, 默认三种. 按实际通道验证收敛 | 不使用 |
| `capabilities.exactSize` | 布尔值, 默认 false. 只有验证输出严格遵守请求像素后才设 true | 不使用 |
| `capabilities.transparent` | 布尔值, 默认 false. 只有真实返回带透明通道的 PNG/WebP 后才设 true | 不使用 |
| `capabilities.customSizes` | 布尔值. 是否接受 1:1, 3:2, 2:3 以外的画幅 (如 16:9, 3:4, 21:9). 默认 Images 模式且 imageModel 属于 gpt-image-2 系列 (含 2.5) 时为 true, 其他为 false | 不使用 |
| `requestHeaders` | 可选请求头对象, 支持 `{{timestamp}}` 和 `{{sessionId}}` 替换 | 同左 |

- 当前两个图像通道均按真实文件检查设为 `outputFormats: ["png"]`, `exactSize: false`, `transparent: true`, 实测记录见 `docs/REAL_API_VALIDATION.md`. 透明底仅在对应通道 `transparent: true` 时启用.
- `exactSize` 控制尺寸说明, 不改变上游实际能力. 自定义画幅只路由到 `customSizes: true` 的通道.
- 页面在存在两个以上 `modelName` 时显示模型选择, 默认自动. 选定模型后只在该模型的通道间调度与切换; 自动则在全部通道间调度. 参数按所选模型中单个通道能同时满足的组合启用, 例如透明背景与 16:9 需由同一通道同时支持. 局部重绘固定原作品通道.
- 新增与已有模型相同的通道时使用相同 `modelName`, 页面不新增选项, 只增加该模型的备用通道.
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
| `TRUST_PROXY` | 接受 1/true 或 0/false, 覆盖文件中的 trustProxy; `compose.yaml` 设为 1 |
| `IMAGE_CONCURRENCY` | 只允许 1 |
| `LOG_FILE` | 应用日志路径 |

保留旧 `ANYROUTER_BASE_URL`, `ANYROUTER_API_KEY`, `DEFAULT_PROVIDER` 别名供现有配置读取; 有对应的新变量时以新变量为准. 没有独立文本配置时, 旧单通道字段可提供文本通道默认值. 部署新环境时填写明确的两类 Provider 数组.

## 2. 本地启动

### 2.1 与正式部署隔离的手动测试

```sh
npm ci
npm run start:local
```

- 先打开本机独立后台创建测试访问码, 再用该码登录 `http://127.0.0.1:8789`. 本机和正式部署的访问码与余额独立, 不复用真实部署中的码.
- 打开 `http://127.0.0.1:8789/#admin`, 使用自动生成的独立管理员密码. 从 `~/.local/share/sprout-canvas/local/admin-password.txt` 读取, 文件权限为 0600, 启动日志只显示路径.
- 将任务库, 风格库和日志保存在 `~/.local/share/sprout-canvas/local/`, 不使用项目目录的 `data/` 和 `logs/`. 自动按本机数据目录生成独立 Cookie 名称, 避免同一主机不同端口互相覆盖登录.
- 每次启动复用已有管理员密码与风格数据. 可通过 `ADMIN_PASSWORD` 使用自定密码, 此时不创建或提示密码文件.
- 如需自定路径/端口, 设置 `DATA_DIR` 和 `PORT`. 本机入口固定监听 127.0.0.1, 固定任务库/日志为隔离目录中的文件, 不沿用部署配置的 stateFile/logFile.
- 将本机 8789 和正式域名视为不同的浏览器存储来源, 不共用作品, 草稿和管理数据. 在本机后台导出备份, 到正式后台导入可迁移已整理的风格.
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

### 3.1 部署结构

```
访客 ─HTTPS─> Caddy (独立项目, 多站共用, 80/443) ─edge 网络─> sprout-canvas:8787 (本项目唯一容器)
```

- 生产只运行一个由本仓库 `Dockerfile` 构建的应用容器. `compose.yaml` 只定义该容器, 不包含反向代理, 隧道或进程管理器.
- 公网入口由服务器上独立部署的 Caddy 提供, 经外部 Docker 网络 `edge` 按容器名访问 `sprout-canvas:8787`. 主机端口 `127.0.0.1:8888` 只用于本机健康检查和 SSH 隧道, 不对外开放.
- 容器以 `node` 用户 (uid 1000) 运行, 应用文件只读, `config/` 只读挂载, 只有 `data/` 和 `logs/` 可写. 基础镜像按 digest 固定, 升级时显式修改.
- 保持一个容器副本和固定容器名; 多副本会各自运行一个 worker, 破坏全局并发 1 的约定. 保持 `stop_grace_period: 460s`, 长于服务自身最长 450 秒的在途等待. 镜像内置 `/health` 健康检查, 发布以此判定启动成功.
- 应用日志写入 `logs/server.log` 并自行轮转; 容器标准输出使用 `local` 日志驱动, 单份 10 MiB, 保留 3 份.

服务器目录 (默认 `/opt/apps/sprout-canvas/`) 只保存:

| 路径 | 内容 |
|---|---|
| `compose.yaml` | 由发布脚本每次覆盖, 不在服务器上手改 |
| `.env` | 当前镜像与回滚目标, 由发布脚本维护; 权限 0600, 不放密钥 |
| `config/local.config.json` | Provider 密钥, 管理员密码等配置, 手工维护 |
| `data/` | 任务/点数 SQLite 与 `styles/` 风格库, 需要备份 |
| `logs/` | 应用日志 |
| `deploy.log` | 每次发布的时间和镜像 |

`config/`, `data/`, `logs/` 属于 uid 1000 (容器内 `node` 用户), 权限只允许属主访问. 发布脚本会检查配置文件和目录属主, 因此发布用户也应为 uid 1000 (Ubuntu 默认 `ubuntu` 用户即是). 服务器不需要源码仓库, npm 或 GitHub 访问.

`.env` 可选变量:

| 变量 | 默认 | 说明 |
|---|---|---|
| `SPROUT_CANVAS_IMAGE` | 发布脚本写入 | 当前运行的镜像标签 |
| `SPROUT_CANVAS_PREVIOUS_IMAGE` | 发布脚本写入 | 回滚目标 |
| `SPROUT_CANVAS_PORT` | `8888` | 本机回环端口 |
| `SPROUT_CANVAS_MEM_LIMIT` | `256m` | 容器内存上限 |

- 默认内存上限按小内存主机设置. Docker 默认另允许等量 swap, 容器合计可用 512 MiB. 以同样限制实测: 4 张 3 MiB 参考图峰值约 180 MiB; 4 张接近 12 MiB 上限 (请求体 61 MiB) 时物理内存用满 256 MiB, 其余进入 swap, 任务仍完成但变慢. 不给容器 swap 时同一请求会被强制结束; 不限制时峰值约 640 MiB.
- 宿主机关闭 swap, 或经常同时提交多个大图请求时, 将上限调到 768m. 超限时容器被强制结束并重启, 在途任务按结果未知处理.
- `.env` 只用于 Compose 变量替换, 不注入容器环境. 运行配置 (如 `secureCookies`, `cookieNamespace`) 写入 `config/local.config.json`; 不在服务器上修改 `compose.yaml`, 下次发布会覆盖.

### 3.2 首次准备服务器

前置条件: Linux 主机已安装 Docker Engine 与 Compose v2; 发布用户可 SSH 登录, 属于 `docker` 组并可免密 sudo; 已安装 `curl`; 云安全组放行反向代理的 80/443. 服务器需要能拉取 `node:22-alpine`, 无法直连 Docker Hub 时先配置镜像加速.

1. 在服务器创建共享网络和应用目录. 反向代理已创建 `edge` 网络时跳过第一行. 应用目录属于发布用户, 发布脚本向其中写入 `compose.yaml`, `.env` 和 `deploy.log`:

```sh
docker network create edge
sudo install -d -o "$USER" -m 0755 /opt/apps/sprout-canvas
sudo install -d -o 1000 -g 1000 -m 0700 /opt/apps/sprout-canvas/config /opt/apps/sprout-canvas/data /opt/apps/sprout-canvas/logs
```

2. 在本机项目目录上传配置. 通过标准输入写入, 服务器上不留中间副本:

```sh
ssh user@server 'sudo install -o 1000 -g 1000 -m 0600 /dev/stdin /opt/apps/sprout-canvas/config/local.config.json' < config/local.config.json
```

生产配置要求 `adminPassword` 为 12-256 位非占位值, HTTPS 部署设置 `secureCookies: true`. `trustProxy` 无需填写, `compose.yaml` 已传入 `TRUST_PROXY=1`. 之后修改配置时重复该命令, 再在服务器应用目录执行 `docker compose restart`.

3. 按 [3.4](#34-共享反向代理) 添加站点并设置 DNS, 再按 [3.3](#33-发布-回滚与状态) 首次发布.

首次发布后打开 `https://<域名>/#admin`, 使用 `adminPassword` 登录并创建访问码. 用户端风格库和导航不展示管理入口, 将该地址保存为管理员书签. 也可经 SSH 隧道打开 `http://127.0.0.1:8888/#admin`; 两个地址的登录 Cookie 相互独立.

### 3.3 发布, 回滚与状态

在本机项目目录执行:

```sh
export DEPLOY_HOST=user@server        # 或 ~/.ssh/config 中的别名
export DEPLOY_SSH_KEY=~/.ssh/server.pem  # 可选; DEPLOY_DIR 默认 /opt/apps/sprout-canvas
npm run deploy                  # 发布当前工作区
npm run deploy -- rollback      # 回到上一个镜像
npm run deploy -- status        # 查看容器状态与最近发布
```

- 发布流程: 本机 `npm run build`; 只将 Dockerfile, 服务端代码和 `dist/` 经 SSH 发送, 服务器按 Dockerfile 的 `prebuilt` 阶段组装镜像, 不运行 npm; 上传 `compose.yaml`, 更新 `.env` 后执行 `docker compose up -d --wait`. 健康检查通过且 `/ready` 返回成功才算完成, 通常约 15 秒.
- 镜像标签取提交短哈希; 工作区有未提交修改时追加 `-dirty-<时间>` 并提示. 服务器只保留当前与回滚目标两个镜像, 自动清理更旧的版本.
- 回滚只切换镜像, 不改动 `data/`. 回滚到更早的 SQLite 结构前先确认旧代码能读取新结构, 否则按 [4.3](#43-完整数据备份与恢复) 从备份恢复.
- 发布和回滚都会重启容器. 先确认没有排队, 生成中或待领取的任务; 排队任务会标记为中断并可从原浏览器恢复, 生成中的任务按 [第 4 节](#4-任务与图片生命周期) 的结果未知规则处理. 关闭时最多等待 450 秒在途任务, 发布命令随之等待.
- 发布只打包本机工作区. 发布前运行 `npm test`, 正式版本先按授权提交并推送, 便于对应记录.
- Dockerfile 默认 `FRONTEND=build` 在镜像内构建前端, 供 CI 与 Docker 验收使用; `FRONTEND=prebuilt` 只供发布脚本使用. 升级 Node 时修改 Dockerfile 顶部 `NODE_IMAGE` 的 digest (用 `docker buildx imagetools inspect node:22-alpine` 查看多架构索引 digest), 再完成第 5 节验收后发布.
- 本机无法直连 Docker Hub 时, BuildKit 可能取不到固定 digest 的基础镜像元数据. 先经 Docker 守护进程拉取 `docker pull node:22-alpine@<digest>`, 再构建.

### 3.4 共享反向代理

Caddy 作为服务器上的独立 Compose 项目运行, 统一占用 80/443 并为多个站点申请和续期 Let's Encrypt 证书. 不放入本仓库, 避免与其他项目争用端口和容器名. 各站点容器通过外部网络 `edge` 接入. 最小 `compose.yaml` 示例:

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks: [edge]
volumes:
  caddy_data:
  caddy_config:
networks:
  edge:
    external: true
```

芽绘台站点块:

```
draw.example.com {
    encode zstd gzip
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy sprout-canvas:8787
}
```

- `encode` 压缩 JS/CSS/HTML/JSON, 图片和字体本身已压缩, 原样传输. 实测构建 JS 从约 351 KiB 降到 103 KiB (zstd).
- 缓存头由应用设置, 反向代理不另配: `/assets/` 下带内容哈希的构建文件缓存一年并标记 immutable; `index.html` 与 SPA 路由使用 `no-cache`, 新版本发布后刷新即生效; 其他静态文件缓存一天; API 为 `no-store`.
- 确认 HTTPS 可用后再启用 HSTS. 只作用于当前子域名, 不加 `includeSubDomains`, 避免影响同域名的其他站点.
- Caddy 丢弃访客自带的 `X-Forwarded-For` 并写入真实连接地址, 配合 `TRUST_PROXY=1` 使登录限速区分访客. 使用 Cloudflare 托管 DNS 时保持灰云 (仅 DNS), 不经 CDN 代理, 否则 Caddy 只看到 CDN 地址且 HTTP-01 验证受影响.
- Caddy 默认不限制请求体大小, 由应用执行 64 MiB 上限; 实测 70 MB 请求经代理直达应用, 由应用返回结果. 连接上游的超时为 3 秒, 等待响应不设超时, 适合较长的文字处理调用. 改用其他反向代理时, 保留原始 `Host`, 使 `X-Forwarded-For` 最后一项为真实连接地址, 并设置不小于 64 MiB 的请求体与 450 秒读取超时.

修改共享 `Caddyfile`:

```sh
cd /opt/apps/caddy
cp -a Caddyfile Caddyfile.bak-$(date +%Y%m%d-%H%M%S)
# 编辑 Caddyfile 后:
docker exec <caddy 容器> caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec <caddy 容器> caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

- `Caddyfile` 以单文件挂载时, 只能原地改写内容. `sed -i` 等先写新文件再替换的方式会改变 inode, 容器看不到新内容; 出现这种情况时把新内容写回原文件再 reload.
- `reload` 平滑生效, 不重启容器, 不中断其他站点. 不在应用代码中写死域名; 入口变更只涉及 `Caddyfile` 与 DNS.
- 在 DNS 托管处将域名设为 A 记录指向服务器 IP. 同一域名同一时刻只指向一台机器; 浏览器作品按网址隔离, 切换地址前下载需要保留的作品.
- 首次签发证书需要 80 端口可达. 验证 `curl -fsS https://draw.example.com/ready` 返回 `{"ok":true,"imageConcurrency":1}`, 再检查访问码登录, 页面和风格图片读取.

### 3.5 小范围对外使用的基础保护

- 通过访问码分配小范围测试额度, 不把同码使用者描述为独立账户.
- 保留反向代理传入的原始 Host, 包括非默认端口; 不把它改成内部服务地址. Vite 的 `/api` 代理已设置 `changeOrigin: false`.
- 对普通和管理写接口统一校验 Origin 与 Sec-Fetch-Site, 拒绝其他来源的浏览器调用. 登录和文本请求只接受 `application/json`. 无浏览器来源头的 CLI 请求仍须通过会话鉴权.
- 将普通登录与管理登录分别限制为同一访客来源 10 分钟内最多 8 次错误尝试; 超限返回 429 与 Retry-After. 成功登录清除对应失败计数, 现有有效会话不受错误登录尝试影响.
- 默认按 TCP 连接来源限速, 不信任客户端自行填写的转发头. 设置 `trustProxy`/`TRUST_PROXY` 后, 仅当连接来自回环或私网地址时读取 `X-Forwarded-For` 的最后一项: Caddy 丢弃访客自带的转发头, Nginx 将连接地址追加在末尾. 只在应用端口不对外开放时启用: `compose.yaml` 将主机端口绑定到 `127.0.0.1` 并设置该变量, `edge` 网络内的容器均视为可信代理. 对外发布该端口时同时删除该变量, 否则直连访客可伪造转发地址. 已在正式入口验证: 同一访客携带伪造转发头连续错误登录, 第 9 次返回 429, 其他访客不受影响.
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
- 将保留请求/结果预算限制为全站 128 MiB, 同一浏览器身份最多占用其中 96 MiB, 单次请求体/上游图片响应限制为 64 MiB. 参考图每张最多 12 MiB, 最多 4 张, 仍须满足总请求体限制. 成功和失败任务结束后立即释放请求中的参考图与蒙版, 失败重试从浏览器保存的配方重新提交.
- 保持 Images 上游超时 180 秒, Responses 图片调用超时 420 秒, 文本调用超时 60 秒.
- 优雅关闭时停止接收新任务, 等待在途图片, 已断开浏览器的文字任务及未落账结算, 最长 450 秒. 待落账重试保持进程运行; 进程强制结束后不假定上游未执行.
- 重启后 pending 标记为 interrupted, 可由原浏览器的配方恢复; running 标记为结果未知, 自动返还预占且不自动重发; 未领取成功图片标记为 expired.
- 对网络中断和无法可靠解析的生成结果停止自动重发, 防止重复付费. 显式上游错误可按路由策略尝试兼容通道.
- 浏览器刷新或关闭不取消已受理任务, 不触发退款或再次生成. 使用保留 Cookie 与本地数据的同一浏览器重新打开, 继续领取服务仍保留的结果. 关闭页面超过临时保留期, 清除浏览器数据或重启服务可能使未保存图片丢失, 应及时下载喜欢的作品.

### 4.1 风格持久化与备份

- 通过 `/#admin` 登录并查看仪表盘; 使用 `/#admin/styles` 和 `/#admin/access` 直接进入对应管理页, 刷新后保留所在页. 在灵感点用量和创作使用卡片切换今日/本月/累计, 分开展示实际扣减和无限额度等值用量. 用最近 365 天热力图查看每日结算次数.
- 按固定北京时间 (UTC+8) 的成功结算日期读取仪表盘日/月统计, 不随主机或容器 `TZ` 改变. 对重复结算和结果清理保留原日期. 将生图次数按图片任务统计, 不以偶然返回的多张图片重算; 只对灵感点启用后的记录统计, 不补造旧任务用量.
- 保留 `<dataDir>/styles/library.sqlite` 与 `images/` 的配套数据, 不只复制数据库丢弃图片. 如需直接复制目录, 先在无活动任务时停止服务再复制整个目录.
- 仅在库首次建立时从 `server/style-seed/` 初始化 36 款, 使用初始化标记避免后续版本覆盖管理员编辑和删除记录. 后台上架后普通库读取真实数据, 进入页面/回到标签页时刷新, 可见页面每 30 秒同步一次.
- 在后台点击导出备份, 下载 `sprout-styles-YYYY-MM-DD.json`; 格式为 `sprout-canvas-styles` version 1, 包含元信息和示例图 data URL. 备份不包含管理员密码, 会话, Provider 密钥或用户作品.
- 通过导入备份选择 JSON, 检查新增/更新/相同数量, 确认后按 ID 合并. 保留备份外现有风格, 相同内容重复导入不创建副本. 预览后库有其他变更时重新预览, 不覆盖并发修改.
- 仅接受 PNG/JPEG/WebP 示例图, 每张最多 12 MiB, 最大边 12000px 且不超过 4000 万像素. 网页录入时最长边规范化到 1600px 并转 WebP, 不对生成作品应用此处理.
- 保持最多 1000 条, 提示词最多 24000 字符, 完整 JSON 备份最多 64 MiB. 新增/修改/合并时校验含图片和 UTF-8 文本的完整备份容量, 提前拒绝超限写入并保留已有数据. 为请求包装预留少量空间, 不导出无法重新导入的文件.
- 更换或删除图片时清理无引用文件, 同一图片仍被其他风格引用时保留. 不自动给管理员新增素材套用初始案例许可.

### 4.2 访问码与灵感点

- 首次启动后先用 `adminPassword` 登录 `/#admin`, 打开访问码管理并填写备注和初始灵感点. 需要无限额度时打开点数输入框右侧开关, 数字输入随之禁用. 支持每批 1-100 个码, 完整码只在创建或重置时显示一次, 复制后自行分发. 点击卡片修改设置, 点击卡片用量图标打开独立流水弹窗.
- 使用 `sc_` 加 32 个 Base64URL 随机字符作为访问码, 由服务端生成 24 字节安全随机数据. 不手工设置短码, 不在 URL 或日志中传递完整码. 忘记后使用重置码功能, 保留内部 ID, 余额和流水.
- 不设置访问码有效期. 一码可多人使用并共享余额, 每个浏览器持有独立会话与任务身份. 不收集 IP 历史或设备指纹, 不提供注册与充值. 同一浏览器的本地展馆不是多个独立账户的数据空间.
- 默认图片任务 10 点, 文字处理 1 点. 在后台修改正整数点值, 每项最多 100 万点; 有限额度的单码总剩余点数最多 10 亿点. 调整只能扣除可用点数, 不得侵占已预占部分.
- 显式选择无限额度时保留原有限余额. 无限任务不预占或扣减该余额, 仍将成功任务的等值点数记入累计用量. 每个任务保存 `unlimited` 快照; 切换模式不改变已受理/恢复任务的结算, 新请求需与当前额度模式一致. 无限额度也遵守现有队列和请求频率限制.
- 区分余额字段和额度模式: `unlimited=true` 时界面显示无限, `available` 仍是保留的有限可用余额, 不返回 `Infinity` 或虚构的大额余额. 历史数据迁移默认为有限额度, 保留原余额, 预占, 流水和幂等记录.
- 在同一 SQLite 事务中完成批次校验, 预占与任务记录. 图片成功取得可用结果时扣点, 执行前取消或明确失败时返还. 每个任务按受理时快照结算, 意外返回多张图片不重复计次.
- 对文字和图片统一识别 HTTP 错误, HTTP 200 内的错误正文与 Responses 终止事件. 将 HTTP 408/504/524, 未明确结束的网关错误, 超时错误码, 连接中途断开与截断结果归为结果未知, 自动返还预占, 不自动切换通道或重复生成.
- 对明确的上游拒绝和确认未连接成功的错误返还预占; 允许原有路由对可安全重试的失败切换通道, 最终成功仍只结算一次. 首镜失败或结果未知时, 首镜与尚未调用上游的后续分镜全部返还.
- 对系列拆解先使用前后端共用规则校验 JSON 数组, 3-8 幕的指定数量及每幕标题/提示词, 再扣文字点数. 无效或不完整的草稿按明确失败处理. 浏览器刷新或重开后先读取已保存请求的文字结果.
- 对已调用上游但超时, 断流或在途重启的任务自动返还预占, 流水原因记为 "上游结果未知, 已自动返还占用, 未自动重新调用". 不提供人工核实; 若上游实际已完成, 该次成本由服务方承担. 用户手动重试时以新请求重新生成并重新计点, 不再弹窗确认. 升级时一次性返还旧版遗留的待核实预占. 仅重试写账失败的结算, 不为补记流水重新调用模型.
- 在领取确认丢失后复用已保存的任务编号补确认, 不重复保存作品或扣点. 已成功结果的临时保留期结束不退款; 过期标记与历史清理写入失败时保持进程可用并重试存储.
- 将有限额度余额为零视为可登录但不能新建消耗任务. 浏览风格, 复制模板, 查看与下载本地作品不扣点. 同码消费和模式修改通过轮询同步, 以服务端原子校验为准.
- 停用或重置后, 尚未执行任务取消并返还占用, 已发送任务正常结算. 旧会话在原有效期内可读取和领取自己的结果, 不能新建生成任务. 重新启用后需再次登录, 不恢复旧会话的新建权限.
- 在管理弹窗中确认删除访问码. 有运行中任务时先停用, 待任务结束后删除; 未执行任务会取消并释放预占. 删除后从列表移除且不可恢复, 旧码不能重新登录或新建任务, 原会话仍可领取已完成结果. 保留数据库中的删除标记, 账本及幂等记录用于核对, 不提供回收站.

- 在旧版待提交草稿或换码后的继续提交操作中, 先确认图片数量与当前预计灵感点, 再建立新请求. 取消时保留原材料; 确认时原子保存新请求和草稿关联, 为系列重新连接首镜参考. 后续响应丢失或刷新继续复用已确认的新请求编号.

### 4.3 完整数据备份与恢复

- 将风格导出与完整服务备份分开. 风格 JSON 仅包含风格文本和图片, 不包含访问码, 余额, 账本, 普通会话或管理员会话.
- 完整服务备份包含应用目录的 `data/`, `config/` 与 `.env`. 单独配置 `STATE_FILE` 时一并备份该文件及同目录 SQLite 附属文件. 不在运行中直接复制 SQLite 主文件而漏掉 WAL.
- 在无活动任务和未领取图片时于服务器应用目录执行停机备份. 备份目录放在应用目录外并保持私有, 不提交到 Git:

```sh
cd /opt/apps/sprout-canvas
docker compose stop
sprout_backup_dir="$HOME/backup/sprout-canvas-$(date +%Y%m%d-%H%M%S)"
install -d -m 0700 "$sprout_backup_dir"
sudo cp -a data config .env compose.yaml "$sprout_backup_dir/"
docker compose up -d --wait
```

- 定时备份可改用 SQLite 在线备份接口 (如 Python `sqlite3.Connection.backup`) 分别导出 `data/runtime.sqlite` 与 `data/styles/library.sqlite`, 再复制 `data/styles/images/` 和 `config/`, 无需停机. 备份含 Provider 密钥与点数账本, 上传到外部存储前先加密.
- 恢复前停止服务并另行保存当前数据. 将备份中的 `data/` 和 `config/` 恢复到应用目录, 保持属主 uid 1000 与私有权限 (`sudo cp -a` 保留原属性; 来源不同时执行 `sudo chown -R 1000:1000 data config logs`), 再启动服务. 不将备份中的旧账本直接合并到正在消费的新账本.
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
| `POST /api/text` | 文字处理, 含 requestId, kind(prompt/series), content (用户原文) 和 creditQuote; series 额外携带 sceneCount(3-8). 润色/拆解指令由服务端组装, 携带 input 等旧字段时返回 400 |
| `GET /api/text/:requestId` | 按原请求编号读取文字结果, 不再次调用模型 |
| `GET /api/credits` | 当前码可用/占用/累计消耗与点值版本 |
| `/api/auth/status`, `login`, `logout` | 工作台会话状态, 访问码登录和退出; 登录 body 仅接受 code |
| `GET /api/styles` / `/api/styles/images/:file` | 普通登录后读取已上架风格和示例图 |
| `/api/admin/auth/status`, `login`, `logout` | 独立管理登录, 不获得生图权限 |
| `GET /api/admin/overview` | 仅管理员读取当前风格/访问码, 累计 usage, 今日/本月 usagePeriods 和 365 天 activity, 不返回凭据或用户作品 |
| `GET/POST /api/admin/styles` | 读取全部风格或新建, 新建请求可含 imageDataUrl |
| `PUT/DELETE /api/admin/styles/:id` | 按版本更新或删除, 冲突返回 409 |
| `GET /api/admin/styles/images/:file` | 管理员读取示例图, 包含未上架内容 |
| `GET /api/admin/styles/export` | 导出完整 JSON 备份, 含图片和元信息 |
| `POST /api/admin/styles/import?preview=1` | 校验备份并预览新增/更新/相同数量 |
| `POST /api/admin/styles/import` | 提交 archive 与预览 revision, 事务合并 |
| `GET/POST /api/admin/access-codes` | 分页搜索访问码或单个/批量创建 |
| `GET/PATCH /api/admin/access-codes/:id` | 详情, 备注, unlimited 模式, 启停和 delta 点数调整, 按 version 一次保存; reason 可选, 缺省时服务端自动记录 |
| `DELETE /api/admin/access-codes/:id` | 按 requestId 和 version 删除, 有运行中操作时返回 409 |
| `POST /api/admin/access-codes/:id/points` / `reset` | 点数调整或重置码, reason 可选, 缺省时服务端自动记录 |
| `GET /api/admin/access-codes/:id/ledger` | 分页流水, 每页 30 条, 使用返回的 nextCursor |
| `GET/PUT /api/admin/credit-prices` | 读取或按 version 保存图片/文字点值 |

- 为生成请求携带服务端会话对应的 `creditQuote: { accessCodeId, userId, version, unlimited }`, 不以客户端 userId 授权. 报价版本或额度模式变化返回 409, 刷新点数标记后由用户再次确认. 重放已受理请求沿用原点值和模式; 旧有限额度报价缺少 unlimited 时按 false 校验.
- 为管理写操作携带稳定 requestId, 失败重试复用原编号与相同内容; 修改操作意图时生成新编号. 创建/重置请求重放不再次返回完整码.
- 用新的 requestId 和 retryOf 显式重新生成失败任务. 丢响应时查回原请求或用原编号续交, 不自动重新计点.
- 不调用已删除的 `/api/images/*`, `/api/jobs/images/*`, `/api/responses`, `/api/models`.
- 上线前执行 `npm test`, `npm run test:browser`, `docker build -t sprout-canvas:verify .`, `npm run test:docker` 和 `git diff --check`, 通过后按 [3.3](#33-发布-回滚与状态) 发布.
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

- 查看 `logs/server.log` 或在服务器应用目录执行 `docker compose logs --tail 200` 定位失败通道. 上游错误摘要会脱敏, 不打印密钥或图片正文. 应用文件日志按 10 MiB 轮转, 共保留当前文件和 `.1`/`.2` 两份归档; 自动清理更旧内容, 首次遇到已有超大文件时仅保留最近的完整日志行. 将待写文件日志限制为 1 MiB, 堆积超限时保留标准输出并报告文件日志丢弃; 写入失败通过标准错误输出报告.
- 服务端按本次进程的调用记录保留通道状态, 区分未验证, 可用, 最近失败和冷却; 前台顶栏与帮助不展示, 通过日志中的 `circuit-open` 记录查看熔断. 同一通道连续 3 次连接或接口失败后冷却 30 分钟; 模型返回的拆解/润色内容未通过校验时按失败返还并尝试备用通道, 不计入熔断.
- 在无活动任务时发布并重启, 保留 `data/` 目录. 修改 host/port/dataDir/stateFile/logFile/cookieNamespace 后重启服务以使用新值. 访问码停用/重置与管理员改密分别控制普通生成权限和管理权限.
- 按 [真实通道验证](REAL_API_VALIDATION.md) 配置格式与尺寸能力, 不因请求返回 200 就断言参数生效.
- 不把浏览器本地展馆描述为服务器历史图库或跨设备同步. 不使用 SQLite 元信息备份替代图片下载.
- 将管理员和普通工作台的 Cookie 分开维护, 写请求只接受同源浏览器调用, 登录限制连续失败尝试. 不将密码填入网页脚本或提交到 Git.
- 在批量录入风格或升级前, 使用风格后台手动导出备份并保留在独立位置, 不将 `data/` 目录视为备份. 重要生成作品仍由用户下载保存.
- 当前为单进程小规模架构, 未进行生产容量压测. 大规模图库, 多实例调度和公开账户系统需要另行设计, 不直接增加容器副本.
