#!/usr/bin/env bash
# Local-only Ask WAKA Ollama/Qwen harness.
# Talks to http://127.0.0.1:11434 — do NOT expose this port publicly.
#
# Prerequisites:
#   ollama serve
#   ollama pull qwen3:4b
#
# Usage:
#   ./scripts/dev/ollama_qwen_ask_waka_harness.py
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
exec python3 scripts/dev/ollama_qwen_ask_waka_harness.py
