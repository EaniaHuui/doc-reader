#!/bin/bash

#======================================
# Doc Reader 启动脚本
#======================================
# 用法:
#   ./start.sh              # 开发模式 (Flask 内置服务器)
#   ./start.sh --prod       # 生产模式 (gunicorn)
#   MODE=prod ./start.sh
#======================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "venv" ]; then
    echo "错误: 虚拟环境不存在，请先运行 ./install.sh"
    exit 1
fi

# shellcheck disable=SC1091
source venv/bin/activate

MODE="${MODE:-dev}"
if [ "${1:-}" = "--prod" ] || [ "${1:-}" = "prod" ]; then
    MODE="prod"
fi

# Read host/port from config.yaml when possible (fallback defaults)
HOST="127.0.0.1"
PORT="5000"
if command -v python >/dev/null 2>&1; then
    eval "$(python - <<'PY'
import yaml
from pathlib import Path
try:
    cfg = yaml.safe_load(Path("config.yaml").read_text(encoding="utf-8")) or {}
    server = cfg.get("server") or {}
    host = server.get("host", "127.0.0.1")
    port = int(server.get("port", 5000))
    print(f'HOST={host!r}')
    print(f'PORT={port}')
except Exception:
    print("HOST='127.0.0.1'")
    print("PORT=5000")
PY
)"
fi

WORKERS="${WEB_CONCURRENCY:-2}"

if [ "$MODE" = "prod" ]; then
    if ! python -c "import gunicorn" 2>/dev/null; then
        echo "未安装 gunicorn，正在安装..."
        pip install -q "gunicorn>=21.0.0"
    fi
    echo "启动生产服务: gunicorn on ${HOST}:${PORT} (workers=${WORKERS})"
    exec gunicorn \
        --bind "${HOST}:${PORT}" \
        --workers "${WORKERS}" \
        --threads 2 \
        --timeout 60 \
        --access-logfile - \
        --error-logfile - \
        "app:app"
else
    echo "启动开发服务: python app.py (${HOST}:${PORT})"
    exec python app.py
fi
