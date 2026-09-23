#!/usr/bin/env bash
# 芽绘台迁移导出: 停服打包 config/data/logs/.env 与 compose 文件.
# 用法: bash scripts/migrate-export.sh
# 输出: ~/.local/share/sprout-canvas/backups/migrate-<时间戳>/sprout-canvas-migrate.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."

stamp=$(date +%Y%m%d-%H%M%S)
out_dir="$HOME/.local/share/sprout-canvas/backups/migrate-$stamp"
mkdir -p "$out_dir"
chmod 700 "$out_dir"

echo "==> 停止 sprout-canvas 容器 (等待在途任务收尾, 最多 460s)"
docker compose stop sprout-canvas

echo "==> 打包 config/ data/ logs/ .env 与 compose 文件"
tar czf "$out_dir/sprout-canvas-migrate.tar.gz" \
  config data logs .env \
  docker-compose.yml docker-compose.named-tunnel.yml \
  scripts/migrate-deploy.sh

echo "==> 重启 sprout-canvas, 本机服务保持在线"
docker compose up -d sprout-canvas
docker compose ps sprout-canvas

echo
echo "==> 迁移包: $out_dir/sprout-canvas-migrate.tar.gz"
du -h "$out_dir/sprout-canvas-migrate.tar.gz"
echo
echo "下一步: 上传该包到服务器, 在项目根目录执行:"
echo "  tar xzf sprout-canvas-migrate.tar.gz  # 仅部署脚本"
echo "  bash scripts/migrate-deploy.sh <迁移包路径> <项目目录>"
