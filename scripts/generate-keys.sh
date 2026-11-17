#!/usr/bin/env bash
# Creates the local, gitignored keypairs the server needs. Never commit keys/*.json.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
mkdir -p keys
for k in deployer adjudicator mint-authority; do
  [ -f "keys/$k.json" ] || solana-keygen new --no-bip39-passphrase -s -o "keys/$k.json" >/dev/null
  echo "$k: $(solana-keygen pubkey keys/$k.json)"
done
