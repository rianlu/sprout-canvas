#!/usr/bin/env bash
# Build the frontend locally, assemble the image on the server from the prebuilt files and restart the container.
# The server keeps only compose.yaml, .env, config/, data/ and logs/. It needs no source checkout, npm or GitHub
# access; the pinned Node base image comes through its own registry mirror.
#
# Usage:
#   DEPLOY_HOST=user@host [DEPLOY_SSH_KEY=~/.ssh/key] [DEPLOY_DIR=/opt/apps/sprout-canvas] scripts/deploy.sh [deploy|rollback|status]
# DEPLOY_HOST may also be an alias from ~/.ssh/config.
set -euo pipefail

action="${1:-deploy}"
host="${DEPLOY_HOST:?set DEPLOY_HOST, for example user@203.0.113.10 or an ~/.ssh/config alias}"
remote_dir="${DEPLOY_DIR:-/opt/apps/sprout-canvas}"
ssh_args=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
[ -n "${DEPLOY_SSH_KEY:-}" ] && ssh_args+=(-i "$DEPLOY_SSH_KEY" -o IdentitiesOnly=yes)
remote() { ssh "${ssh_args[@]}" "$host" "$@"; }
cd "$(dirname "$0")/.."

# Runs on the server: point .env at the given image, start it and wait for the container health check.
activate='
set -euo pipefail
cd "$1"; image="$2"
[ -f config/local.config.json ] || { echo "missing $1/config/local.config.json" >&2; exit 1; }
for dir in data logs; do
  mkdir -p "$dir"
  [ "$(stat -c %u "$dir")" = 1000 ] || { echo "$1/$dir must be owned by uid 1000, the container user" >&2; exit 1; }
done
docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null
touch .env
current=$(sed -n "s/^SPROUT_CANVAS_IMAGE=//p" .env)
previous=$(sed -n "s/^SPROUT_CANVAS_PREVIOUS_IMAGE=//p" .env)
# Redeploying the same tag keeps the older rollback target.
[ -n "$current" ] && [ "$current" != "$image" ] && previous="$current"
{ grep -v -e "^SPROUT_CANVAS_IMAGE=" -e "^SPROUT_CANVAS_PREVIOUS_IMAGE=" .env || true
  echo "SPROUT_CANVAS_IMAGE=$image"
  [ -z "$previous" ] || echo "SPROUT_CANVAS_PREVIOUS_IMAGE=$previous"; } > .env.next
mv .env.next .env; chmod 600 .env
docker compose config --quiet
docker compose up -d --wait --wait-timeout 180
echo "$(date "+%F %T") $image" >> deploy.log
# Keep the running image and the rollback target only.
docker image ls --format "{{.Repository}}:{{.Tag}}" sprout-canvas | while read -r ref; do
  [ "$ref" = "$image" ] || [ "$ref" = "$previous" ] || docker image rm "$ref" >/dev/null 2>&1 || true
done
port=$(sed -n "s/^SPROUT_CANVAS_PORT=//p" .env)
curl -fsS --max-time 5 "http://127.0.0.1:${port:-8888}/ready"; echo
'

case "$action" in
  deploy)
    revision=$(git rev-parse --short HEAD)
    tag="$revision"
    if [ -n "$(git status --porcelain)" ]; then
      tag="$revision-dirty-$(date +%Y%m%d%H%M%S)"
      echo "warning: deploying uncommitted changes as $tag" >&2
    fi
    image="sprout-canvas:$tag"
    echo "==> build frontend"
    npm run build
    echo "==> assemble $image on $host"
    # Only runtime files travel; the Dockerfile's prebuilt stage copies dist/ instead of running npm.
    COPYFILE_DISABLE=1 tar --no-xattrs --exclude .DS_Store -czf - Dockerfile .dockerignore package.json server.mjs server shared config/local.config.example.json dist \
      | remote "docker build -q --build-arg FRONTEND=prebuilt --build-arg REVISION='$tag' -t '$image' -" >/dev/null
    remote "mkdir -p '$remote_dir'"
    scp "${ssh_args[@]}" -q compose.yaml "$host:$remote_dir/compose.yaml"
    echo "==> start"
    remote bash -s -- "$remote_dir" "$image" <<<"$activate"
    ;;
  rollback)
    previous=$(remote "sed -n 's/^SPROUT_CANVAS_PREVIOUS_IMAGE=//p' '$remote_dir/.env'")
    [ -n "$previous" ] || { echo "no previous image recorded in $remote_dir/.env" >&2; exit 1; }
    echo "==> roll back to $previous"
    remote bash -s -- "$remote_dir" "$previous" <<<"$activate"
    ;;
  status)
    remote "cd '$remote_dir' && docker compose ps && grep -E '^SPROUT_CANVAS_(PREVIOUS_)?IMAGE=' .env; tail -n 5 deploy.log 2>/dev/null || true"
    ;;
  *)
    echo "usage: $0 [deploy|rollback|status]" >&2; exit 2
    ;;
esac
