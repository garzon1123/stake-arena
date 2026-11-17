#!/usr/bin/env bash
# Deploys the stake_arena program to Solana devnet and prepares the TEST mint.
# Prereq: keys/deployer.json funded with ~2 SOL (https://faucet.solana.com).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

DEPLOYER=keys/deployer.json
PROGRAM_KEYPAIR=keys/stake_arena-program.json
[ -f "$PROGRAM_KEYPAIR" ] || cp target/deploy/stake_arena-keypair.json "$PROGRAM_KEYPAIR"
PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
echo "Program id: $PROGRAM_ID"
echo "Deployer:   $(solana-keygen pubkey $DEPLOYER) ($(solana balance -u devnet -k $DEPLOYER))"

anchor build
solana program deploy target/deploy/stake_arena.so \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$DEPLOYER" \
  --url devnet

# The adjudicator pays escrow rent + sponsored fees; give it some SOL from the deployer.
ADJ=$(solana-keygen pubkey keys/adjudicator.json)
solana transfer "$ADJ" 0.5 --allow-unfunded-recipient --keypair "$DEPLOYER" --url devnet

npx tsx scripts/setup-chain.ts --cluster devnet
echo "Done. Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
