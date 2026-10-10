#!/usr/bin/env bash
# One-command SYNTHETIC demo: builds the synthetic run store, then serves the API.
# Usage: scripts/start_demo.sh [PORT]   (default 8000). Data is SYNTHETIC, not Barcelona results.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-${PORT:-8000}}"
export PYTHONPATH=src
.venv/bin/python -m bcnflood.api.synthetic
exec .venv/bin/uvicorn bcnflood.api.main:app --host 0.0.0.0 --port "$PORT"
