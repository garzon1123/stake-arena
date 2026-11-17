#!/usr/bin/env bash
# Starts a local validator with the stake_arena program preloaded (no deploy needed).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
PROGRAM_ID=$(solana-keygen pubkey keys/stake_arena-program.json 2>/dev/null || solana-keygen pubkey target/deploy/stake_arena-keypair.json)
mkdir -p .anchor
exec solana-test-validator --reset --quiet --ledger .anchor/test-ledger --bpf-program "$PROGRAM_ID" target/deploy/stake_arena.so
