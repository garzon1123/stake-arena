# STAKE Arena — Demo Video Narration & Shot List

**File:** `deliverables/stake-arena-demo.mp4` · 2:13 · 1920×1080 · H.264/AAC
**Footage:** a real, unedited two-player match recorded with Playwright from two independent browser contexts (two separate STAKE Demo Wallet keys). It ran against the real server, a PostgreSQL database and a **local Solana validator** running the `stake_arena` program.
**Voice:** generated locally with macOS `say` (voice "Samantha"). **No music.**
**Not shown or claimed:** no devnet transactions; nothing is mocked or simulated.

Recorded match: `c2270bb0-5fee-4648-94f4-49f4b9a89b99` (magnus_rha vs judit_rha, 10 TEST each, 3+0).
Settlement transaction (localnet, slot 6011): `36Zju5EfZYvGnHhhfVhJ1A2SLR4KS5MmajzYKqzPY44a6mnghSKuyjwJFAzwcwGKBDcji33gdj1nbEJSD9ddGihQ`. Full extract: [`settlement-proof.json`](settlement-proof.json).

| # | Time | Visual | On-screen caption | Narration |
|---|---|---|---|---|
| 1 | 0:00 | Title card | "Recorded live on a local Solana validator · valueless test tokens" | This is STAKE Arena. Prove your skill. Own your victory. |
| 2 | 0:05 | Problem card (Matching / Results / Payouts) | — | Competitive players want to play for something real. But matching skill, verifying the result, and paying the winner are three separate, trust-heavy steps. STAKE Arena brings them into one flow. |
| 3 | 0:17 | Player A: landing page | Head-to-head blitz chess · skill matchmaking · Solana escrow settlement | Players compete head to head in blitz chess, matched by skill, with their stakes held by a Solana escrow program. |
| 4 | 0:27 | Split screen: both connect demo wallets, sign, create profiles, faucet | Two browser profiles · two separate wallets · sign-in by message signature · free test tokens | Two players, in two separate browser profiles, connect their own wallets. Each signs a one-time message to prove ownership, creates a player card, and claims free test tokens. Network fees are sponsored, so neither player needs SOL. |
| 5 | 0:43 | Both pick 10 TEST / 3+0; A searches; B joins; paired | Same stake tier + time control · paired within ±150 Elo | Both choose a ten-token stake. The matchmaking engine pairs them by stake tier, time control, and Elo rating. |
| 6 | 0:50 | Fund the match: A deposits, B deposits, badges flip to Funded | create_match opens a PDA escrow · each player signs one deposit into the program vault | The escrow program opens a dedicated account for this match. Each player approves one deposit into a program-owned vault. The board only unlocks after the server reads both deposits back from the chain. |
| 7 | 1:03 | Live board on both sides: f3, e5, g4, Qh4# | Server-authoritative moves and clocks · synced live to both players | Now they play. Every move is validated and timed by the server, and synced live to both players. Here's a quick, legal checkmate. |
| 8 | 1:14 | Victory / Defeat panels, ±16 Elo, "Settlement pending" → "Confirmed" | Checkmate verified by the server → adjudicator signs settle → 20 TEST pot to the winner | Checkmate. The server derives the result from the moves themselves and updates both ratings exactly once. The adjudicator then submits the settle instruction, and the escrow pays the full twenty-token pot to the winner. The payout is only shown as confirmed after the validator confirms it. |
| 9 | 1:31 | Proof card: signature, program ID, token balances (winner 90→110, loser 90→90, vault 20→closed), program logs | "Onchain proof · local Solana validator (not devnet)" | This is the real settlement transaction from our local Solana validator. The STAKE Arena program executes settle, the vault owned by the escrow address is emptied and closed, and the winner receives the twenty-token pot. |
| 10 | 1:44 | Winner's profile (rating chart, W/L, history) → leaderboard | Ratings, statistics, match history and leaderboard update from real results | Ratings, statistics, and match history update automatically, and the leaderboard reflects real results. |
| 11 | 1:58 | Closing card | "Demo mode · test tokens have no cash value · not audited" | STAKE Arena runs today on a local Solana validator with valueless test tokens, and public devnet deployment is next. Chess is our first game. The same escrow and settlement layer can power any skill game with a verifiable result. |

## Re-recording

With the stack running (`npm run demo`):

```bash
npm run demo:record   # records live footage → extracts the real settle tx → composes the MP4
```

If you'd rather use your own voice, record over the same timeline with this script. The silent cuts are built from the same footage.
