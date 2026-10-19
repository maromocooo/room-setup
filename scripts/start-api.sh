#!/usr/bin/env bash
# Start the generation gateway. Engine paths come from .env (see .env.example).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

PYTHON="${GATEWAY_PYTHON:-.venv/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
    echo "Gateway Python not found: $PYTHON" >&2
    echo "Create it with: python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt" >&2
    exit 1
fi
exec "$PYTHON" server/gateway.py
