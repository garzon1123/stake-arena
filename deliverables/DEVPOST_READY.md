# Devpost Submission (copy-paste ready)

> Fill the four `⟨…⟩` slots before submitting: team members, GitHub URL, video URL, live demo URL (or "Run locally — see README").

**Devpost selections**
- Main track: **Consumer Applications**
- Chain award: **Best use of Solana**
- Bounties: **none** (we don't use QuickNode Streams, ElevenLabs, Gemini Prediction Markets or Grok Bot)

---

## Project title
STAKE Arena

## Tagline
Prove your skill. Own your victory.

## Team members
⟨names⟩

## Links
- GitHub: ⟨https://github.com/garzon1123/stake-arena⟩
- Demo video (YouTube or Google Drive, 2:13): ⟨link⟩
- Live demo: ⟨link, or "Runs locally with one command: `npm run demo`. See README"⟩
- Solana program: `stake_arena`, verified on a **local Solana validator**. Program ID `4CGHpkEjVe6PAZC5V2cpNH2u1kakXQUxru4CSpnarCZL` is reserved; **public devnet deployment is pending** (see "Challenges").

---

## Inspiration / Problem

Competitive players love having something on the line. A friendly match with stakes, though, means trusting a stranger to pay, arguing over self-reported results, and juggling separate apps for finding an opponent, playing, and settling up. Skill matching, result verification and payment are three disconnected, trust-heavy processes, and a player's record rarely follows them.

## What it does

STAKE Arena is a competitive chess app where the crypto stays in the background:

1. **Connect a Solana wallet**, or use the built-in devnet demo wallet, and sign a free message to verify ownership.
2. **Create a player card.** Everyone starts at 1200 Elo.
3. **Pick a stake** (5, 10 or 25 TEST, a valueless test token) and a time control. Grab free test tokens from the faucet. Network fees are sponsored, so you never need SOL.
4. **Get matched** with a player of similar rating.
5. **Fund the match.** Each player approves one deposit into a vault owned by our Solana program, not by us and not by the opponent.
6. **Play live blitz chess.** Moves and clocks are validated by the server and synced in real time.
7. **Get paid automatically.** The server derives the result from the game itself, the program sends the full pot to the winner (a draw refunds both), and ratings, stats, match history and the leaderboard update.

## How we built it

- **Solana program (Anchor 1.2, Rust).** Each match gets a `MatchEscrow` account at a Program Derived Address computed from the match ID, plus an SPL token vault owned by that PDA. It has five instructions:
  - `create_match` binds both wallets, the mint, the exact stake, a funding deadline and the adjudicator.
  - `deposit` accepts exactly one stake per seat via `transfer_checked`.
  - `settle` (adjudicator only) pays the winner the pot, or refunds on a draw. It can never run twice.
  - `cancel_unfunded` (anyone, after the deadline) refunds a partially funded match.
  - `refund_unresolved` (anyone, one hour after funding) returns both stakes if a result is never settled.

  Every payout path is constrained to the two players' own token accounts. There is no admin withdrawal.
- **Server (Node, Fastify, Socket.IO, PostgreSQL/Drizzle).**
  - Wallet sign-in uses single-use nonces and ed25519 verification.
  - A matchmaking queue pairs players by stake tier, time control and Elo (±150, widening over time) in one atomic transaction.
  - An authoritative chess engine (chess.js plus server clocks) validates every move's sender, turn, sequence number and legality.
  - A settlement worker submits `settle`, verifies the escrow account onchain, and retries idempotently after failures or restarts.
- **Fee sponsorship.** The server builds each deposit transaction with itself as fee payer. The player's wallet signs only its own token transfer, and the server co-signs only the byte-identical message it issued.
- **Onchain verification.** The game starts only after the server *reads the escrow account* and sees both deposits. A client-supplied signature is never trusted on its own.
- **Frontend (React, Vite, Tailwind, Radix, Motion, TanStack Query, react-chessboard).** Wallet discovery uses the Wallet Standard (`@wallet-standard/react`, `@solana/react`). Solana calls go through `@solana/kit`.

## Solana integration: why it matters

The money logic is the program, not our server. Because the vault is owned by a PDA, no private key (ours included) can move the stakes except through the program's rules. That makes "noncustodial escrow" literally true and auditable by anyone. Solana's fast confirmation and sub-cent fees make it practical to sponsor every player's gas and settle a 3-minute game instantly. And native primitives (SPL Token `transfer_checked`, PDAs as signers, account constraints, Wallet Standard wallets) let us enforce mint, amount, seat and payout-destination rules onchain rather than trusting application code.

## Challenges we ran into

- **Never trusting the browser.** Results, deposits and moves all needed server-side or onchain verification: an authoritative engine, ply sequence numbers against replays, and reading escrow state instead of trusting submitted signatures.
- **Sponsoring fees safely.** Co-signing a user-built transaction is dangerous, so the server only signs the exact message bytes it prepared, and only after verifying the player's signature.
- **Exactly-once settlement and ratings.** Recording the result, the Elo update and a settlement job in one database transaction, then making the onchain step idempotent so retries and restarts can't double-pay or double-rate.
- **A donation griefing edge case.** Anyone could send dust to a vault, which would block closing it; we made payouts close the vault only when it's empty.
- **Devnet funding.** Public devnet faucets were rate-limited or ineligible for our new accounts during the event, so we verified the full system on a local Solana validator running the same program. Public devnet deployment is the first item on our list.

## Accomplishments that we're proud of

- A complete, real two-player flow: two separate wallets matched, funded a program-owned escrow, played a legal game, and the program paid the winner the full pot. It's recorded in our demo against a local validator, with the actual settlement transaction shown.
- **19 program tests** (on LiteSVM, against the real SPL Token program) covering wrong mints, duplicate and late deposits, outsiders, double settlement, wrong adjudicator, redirected payouts, and time-gated refunds.
- **Real-validator integration tests**: a full match with payout, plus an underfunded match that cancels and refunds onchain. Also a **two-browser Playwright test** of the real UI, including a mid-game page refresh.
- Players need **zero SOL**. The experience feels like a game, not a wallet.

## What we learned

Product trust comes from making the dangerous parts boring: program-owned custody, explicit timeouts, idempotent settlement, and saying clearly what is and isn't trustless.

## What's next for STAKE Arena

- Public **devnet deployment** and hosted demo
- **Fair-play analysis** (engine-assistance detection) and move transcripts countersigned by both players
- Reducing trust in the adjudicator: dispute windows and multi-party attestation
- More original or properly licensed skill games on the same settlement layer, plus challenge-a-friend links and non-financial tournaments
- An independent **security audit**, plus legal and regulatory review, **before** any feature involving assets of value

## Trust & compliance notes

- **Test tokens only.** STAKE Arena runs on a local validator or devnet with a valueless test token. It has no fiat, no withdrawals and no mainnet or real-money mode.
- **Trusted adjudicator.** The server attests results. It can't redirect funds or settle twice, and anyone can refund stakes after a timeout, but it is not trustless.
- **No cheat-proof claim.** The server prevents illegal moves; it can't detect a player using a chess engine.
- **Not audited.**

## Built with

solana · anchor · rust · spl-token · solana-kit · wallet-standard · litesvm · typescript · react · vite · tailwindcss · radix-ui · tanstack-query · react-chessboard · chess.js · node.js · fastify · socket.io · zod · postgresql · drizzle-orm · vitest · playwright

## Originality & AI assistance

All code was written during the hackathon window (repository history starts Nov 16, 2026). We used AI coding assistance (Claude) as the rules allow. The team designed, reviewed, tested and can explain the system. Open-source dependencies are listed above.
