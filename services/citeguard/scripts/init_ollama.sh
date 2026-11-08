#!/usr/bin/env bash
set -euo pipefail

EMBED_MODEL="${CITEGUARD_EMBED_MODEL:-all-minilm}"
CHAT_MODEL="${CITEGUARD_CHAT_MODEL:-qwen2.5:0.5b}"

echo "[citeguard] Pulling lightweight neural embedding model (${EMBED_MODEL})..."
docker exec citeguard-ollama ollama pull "${EMBED_MODEL}"

echo "[citeguard] Pulling lightweight local LLM (${CHAT_MODEL})..."
docker exec citeguard-ollama ollama pull "${CHAT_MODEL}"

echo "[citeguard] Local Docker AI models ready."
