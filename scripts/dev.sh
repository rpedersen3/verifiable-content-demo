#!/usr/bin/env bash
# Launch the scripture demo triad. No chain needed (content is committed
# off-chain). Requires the published @agenticprimitives/* packages (pnpm install).
#
#   bible-mcp  :8790   resolver + tools (content-primitives + scripture-content-extension)
#   bible-a2a  :8791   resolve-scripture-passage agent; calls the MCP
#   bible-web  :5175   verse lookup UI; proxies /a2a -> a2a
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[bible] starting bible-mcp (:8790), bible-a2a (:8791), bible-web (:5175)"
trap 'kill 0' EXIT
pnpm --filter @verifiable-content-demo/bible-mcp dev &
pnpm --filter @verifiable-content-demo/bible-a2a dev &
pnpm --filter @verifiable-content-demo/bible-web dev &
wait
