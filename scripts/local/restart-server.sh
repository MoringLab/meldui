#!/usr/bin/env bash
# Local-workstation helper: (re)start the lab server with the OmniRoute key from the local store.
cd "$(dirname "$0")/../.."
pid=$(lsof -ti tcp:8787 2>/dev/null || true)
[ -n "$pid" ] && kill $pid && sleep 1
ENGINE_MODELS="${ENGINE_MODELS:-auto/claude-sonnet,cx/gpt-5.6-sol-medium,agy/claude-sonnet-4-6,agy/gemini-3.7-flash-medium,cfp/zai-org/glm-5.2}" \
OMNIROUTE_MODEL="${OMNIROUTE_MODEL:-auto/claude-sonnet}" \
setsid nohup scripts/local/with-omniroute-key.py pnpm exec tsx apps/server/src/index.ts > /tmp/engine-server.log 2>&1 < /dev/null &
sleep 4
curl -s --max-time 3 http://127.0.0.1:8787/api/health
