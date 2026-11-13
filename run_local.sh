#!/bin/sh
# Runs without Docker (requires Python 3.11+)
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
open http://localhost:8000 2>/dev/null &
.venv/bin/uvicorn main:app --port 8000
