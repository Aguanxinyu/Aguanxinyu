#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "============================================"
echo "  讯灵批量发布机器人 - 一键安装"
echo "============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js。"
  echo "请先安装 Node.js LTS： https://nodejs.org"
  exit 1
fi

echo "[1/3] 正在安装依赖..."
npm install

echo
echo "[2/3] 正在安装浏览器组件..."
npx playwright install chromium

echo
echo "[3/3] 检查账号表..."
if [ ! -f "data/accounts.csv" ]; then
  cp data/accounts.example.csv data/accounts.csv
  echo "已自动创建 data/accounts.csv，请填写账号密码后保存。"
else
  echo "已检测到 data/accounts.csv"
fi

echo
echo "安装完成！接下来运行： ./开始使用.sh"
