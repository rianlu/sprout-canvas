#!/usr/bin/env bash
# 芽绘台服务器部署: 在服务器上解包迁移数据并启动.
# 用法: bash scripts/migrate-deploy.sh <迁移包路径> <项目目录>
#   迁移包路径: 本机导出的 sprout-canvas-migrate.tar.gz
#   项目目录:   部署目标目录, 不存在时自动创建并 clone 代码
# 前置: 服务器已安装 Docker + Docker Compose v2.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "用法: $0 <迁移包路径> <项目目录>" >&2
  exit 2
fi
tarball="$1"
app_dir="$2"

[ -f "$tarball" ] || { echo "迁移包不存在: $tarball" >&2; exit 2; }
if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker, 请先安装 Docker" >&2; exit 2
fi
docker compose version >/dev/null 2>&1 || { echo "未找到 docker compose 插件" >&2; exit 2; }

mkdir -p "$app_dir"
cd "$app_dir"

if [ ! -f docker-compose.yml ]; then
  echo "==> clone 项目代码 (公开仓库, HTTPS)"
  git clone https://github.com/rianlu/sprout-canvas.git .
fi

echo "==> 解包迁移数据: config/ data/ logs/ .env compose 文件"
tar xzf "$tarball" --overwrite

echo "==> 校验配置"
if grep -Eq 'change-this|your-|example' config/local.config.json 2>/dev/null; then
  echo "错误: config/local.config.json 含占位密钥/密码, 拒绝启动" >&2
  exit 1
fi
grep -q 'TUNNEL_TOKEN=ey' .env || echo "警告: .env 中未找到 TUNNEL_TOKEN, 公网入口可能不可用"

echo "==> 校验 compose 配置"
docker compose config --quiet

echo "==> 构建并启动"
docker compose up -d --build

echo "==> 等待就绪 (/ready)"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:8888/ready >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" -ne 1 ]; then
  echo "错误: 60s 内未就绪, 查看日志: docker compose logs sprout-canvas" >&2
  docker compose ps
  exit 1
fi

echo "==> 容器状态"
docker compose ps
curl -fsS http://127.0.0.1:8888/ready && echo
echo
echo "部署完成. 切换公网流量前必须停止本机旧部署:"
echo "  本机执行: docker compose stop cloudflared sprout-canvas"
echo "之后验证: https://draw.sleepypie.top/ready"
