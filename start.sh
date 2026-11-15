#!/usr/bin/env bash
# 一键启动：缺依赖自动装、缺前端产物自动构建、然后单进程启动后端。
set -euo pipefail

cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo "错误：未找到 Node.js（需 >= 18）。"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "错误：未找到 npm。"; exit 1; }

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "错误：Node.js 版本过低（当前 ${NODE_MAJOR}，需 >= 18）。"
  exit 1
fi

# 1) 依赖（workspaces 一次装齐）
if [ ! -d node_modules ]; then
  echo "==> 安装依赖（首次运行）…"
  npm install
fi

# 2) 前端产物（生产运行不依赖 Vite）
if [ ! -f server/public/index.html ]; then
  echo "==> 构建前端产物…"
  npm run build
fi

# 3) 启动
echo "==> 启动 DDS 轻量监控工具…"
exec node server/index.js
