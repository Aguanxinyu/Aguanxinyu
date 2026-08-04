#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先运行 ./一键安装.sh"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "还没安装依赖，正在自动执行一键安装..."
  ./一键安装.sh
fi

if [ ! -f "data/accounts.csv" ]; then
  cp data/accounts.example.csv data/accounts.csv
  echo "已创建 data/accounts.csv，请先填写账号密码后再运行本菜单。"
  exit 1
fi

node ./scripts/ops-menu.mjs
