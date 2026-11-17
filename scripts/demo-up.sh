#!/usr/bin/env bash
# One command to run the full STAKE Arena demo on a local Solana validator.
# Starts: validator (program preloaded) → fresh TEST mint → DB migrations → API (8787) → web (5173).
# Ctrl+C stops everything. Prereqs: README → Local setup (Node, Postgres, Solana CLI, keys, anchor build).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"
LOGS=.anchor/logs; mkdir -p "$LOGS"
pids=()
cleanup() { echo; echo "stopping…"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

[ -f .env ] || cp .env.example .env
[ -f keys/adjudicator.json ] || bash scripts/generate-keys.sh
[ -f target/deploy/stake_arena.so ] || anchor build
[ -f keys/stake_arena-program.json ] || cp target/deploy/stake_arena-keypair.json keys/stake_arena-program.json

if solana cluster-version -u localhost >/dev/null 2>&1; then
  echo "• validator already running on :8899"
else
  echo "• starting local validator…"
  bash scripts/localnet.sh > "$LOGS/validator.log" 2>&1 & pids+=($!)
  for _ in $(seq 1 30); do solana cluster-version -u localhost >/dev/null 2>&1 && break; sleep 1; done
fi
echo "• creating TEST mint on localnet…"
npx tsx scripts/setup-chain.ts --cluster localnet | tail -2
echo "• migrating database…"
npm run db:migrate --silent
echo "• starting API and web…"
npm run dev:server > "$LOGS/server.log" 2>&1 & pids+=($!)
npm run dev:web > "$LOGS/web.log" 2>&1 & pids+=($!)
for _ in $(seq 1 30); do curl -sf localhost:8787/api/health >/dev/null && curl -sf localhost:5173 >/dev/null && break; sleep 1; done
echo
echo "STAKE Arena is running → http://localhost:5173   (logs in $LOGS)"
echo "Open it in two browser profiles, use the STAKE Demo Wallet in each, and play."
wait
