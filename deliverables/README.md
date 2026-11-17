# STAKE Arena — Submission Package

| File | What it is |
|---|---|
| [`stake-arena-demo.mp4`](stake-arena-demo.mp4) | 2:13 demo video. Real two-player match on a local Solana validator, narrated, with captions. Upload to YouTube (unlisted) or Google Drive (anyone with link). |
| [`demo-narration.md`](demo-narration.md) | Narration script, shot list and timestamps for the video |
| [`DEVPOST_READY.md`](DEVPOST_READY.md) | Copy-paste Devpost submission |
| [`settlement-proof.json`](settlement-proof.json) | Extract of the real `settle` transaction shown in the video |
| [`../docs/judging-brief.md`](../docs/judging-brief.md) | How to explain the contract, custody, trust model and Q&A |
| [`../docs/HACKATHON_REQUIREMENTS.md`](../docs/HACKATHON_REQUIREMENTS.md) | Requirements audit |
| [`../docs/deployment.md`](../docs/deployment.md) | Public hosting plan (not provisioned) |

## Run the demo yourself

```bash
npm install
npm run demo        # validator + program + TEST mint + DB + API + web → http://localhost:5173
```

Open http://localhost:5173 in two browser profiles, choose **STAKE Demo Wallet** in each, and play. Re-record the video with `npm run demo:record`.

## Status

| | |
|---|---|
| Full flow (wallets → matchmaking → escrow deposits → chess → onchain payout → Elo) | ✅ Verified on a local Solana validator |
| Program, server, integration and browser tests | ✅ 19 + 29 + 2 + 1 passing |
| Public Solana devnet deployment | ⛔ Not yet. Devnet SOL unavailable from public faucets |
| Public hosted web demo | ⛔ Not provisioned. A public deployment needs devnet plus a paid host (~$7/mo) |
