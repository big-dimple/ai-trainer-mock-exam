#!/usr/bin/env bash
# 服务器一键部署：拉取 release 分支最新代码并重启服务。
# 用法：bash deploy/deploy.sh [代码目录]     （默认 /opt/ai-trainer-mock-exam）
set -euo pipefail

APP_DIR="${1:-/opt/ai-trainer-mock-exam}"
cd "$APP_DIR"

echo "==> 拉取 release 分支"
git fetch origin release
git reset --hard origin/release

echo "==> 重启服务"
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl restart ai-trainer-exam
  systemctl --no-pager --full status ai-trainer-exam | head -8
else
  echo "未检测到 systemctl，请手动重启：pkill -f 'python3 server.py' 后重新启动"
fi

echo "==> 部署完成：http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 服务器IP):8848/"
