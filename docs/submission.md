# Devpost Submission Draft

**Project name:** STAKE Arena
**Tagline:** Prove your skill. Own your victory.
**Short description:** Skill-matched, real-time blitz chess where each player's test-token stake is locked in a Solana escrow program and paid to the winner automatically after the server verifies the result.

**Main track:** Consumer Applications
**Chain award:** Best use of Solana
**Bounties:** None
**Team members:** _fill in_

---

### What did you build?

STAKE Arena is a competitive gaming app. You connect a Solana wallet, pick a stake (5, 10 or 25 TEST), get matched with someone near your rating, and play a live game of blitz chess. When you're paired, an Anchor program opens an escrow for that exact match. Each player approves one deposit into a program-owned vault, and the board unlocks only after both deposits are verified onchain. When the game ends, the server derives the result from the actual moves and clocks, and the program pays the full pot to the winner (or refunds both stakes on a draw). Players get Elo ratings, match history, a leaderboard and an Explorer link for every payout. It runs on Solana devnet with a valueless test token.

### What problem does it solve?

Competitive players like having something on the line, but today that means trusting the other person to pay, arguing over results reported in a different app, and juggling separate payment tools. Skill matching, result verification and payment are three disconnected systems, and players' records don't follow them. STAKE Arena puts all of it in one flow: the platform hosts the game, so it knows the real result; matchmaking pairs players of similar skill; and a program, not a person, holds and releases the stakes.

### How does it work?

- **Matchmaking:** a Postgres-backed queue pairs players with the same stake tier and time control within ±150 Elo, widening over time. Pairing is one atomic transaction protected by unique indexes, so nobody is double-booked or matched with themselves.
- **Escrow (Anchor):** `create_match` makes a PDA escrow and vault bound to both wallets, the mint, the stake and a deadline. `deposit` accepts exactly one stake per seat. `settle` (adjudicator only) pays the winner or refunds a draw. `cancel_unfunded` and `refund_unresolved` are permissionless, time-gated safety exits. Every payout can only reach the two players' token accounts.
- **Fee sponsorship:** the server builds each deposit transaction with itself as fee payer. The wallet signs only its transfer, and the server co-signs only the byte-identical message it issued. Players never need SOL.
- **Verified gameplay:** browsers propose moves. The server checks identity, seat, turn, sequence number, legality (chess.js) and an authoritative clock, then broadcasts over Socket.IO. Refreshing rejoins the same game.
- **Settlement:** the result, the Elo update and a settlement job are written in one DB transaction. A worker sends `settle`, verifies the escrow state onchain and retries idempotently after failures or restarts.

### What makes it unique?

The combination: a consumer-grade game UX where crypto stays in the background (no SOL needed, a one-click demo wallet, plain-language wallet prompts), skill-aware matchmaking, results computed natively from the game the platform hosts rather than self-reported, and noncustodial escrow with settlement anyone can verify on Explorer. The escrow and settlement layer isn't specific to chess. Any game that can produce a verifiable result can plug into it.

### What would you build next?

- More original or properly licensed skill games on the same settlement layer
- Fair-play analysis (engine-assistance detection) and signed move transcripts that players countersign
- Challenge-a-friend links, clubs, and seasonal non-financial tournaments
- Portable onchain player reputation
- Decentralized or multi-party result attestation with a dispute window
- An independent security audit and a legal and regulatory review **before** any feature involving assets of value

### Built with

Solana (devnet), Anchor 1.2, SPL Token, Program Derived Addresses, @solana/kit, Wallet Standard (@wallet-standard/react, @solana/react), LiteSVM, TypeScript, React 19, Vite, Tailwind CSS v4, Radix UI, Motion, TanStack Query, react-chessboard, chess.js, Node.js, Fastify, Socket.IO, Zod, PostgreSQL, Drizzle ORM, PGlite (tests), Vitest, Playwright.

### Links

- GitHub: _add public repo URL_
- Demo video: _add YouTube / Google Drive URL (2–3 min)_
- Live demo: _add URL, or "run locally — see README"_
- Program ID (devnet): `4CGHpkEjVe6PAZC5V2cpNH2u1kakXQUxru4CSpnarCZL`. **Verify it's deployed on Explorer before submitting.**

### Truthful bounty checklist

| Bounty | Eligible? | Reason |
|---|---|---|
| QuickNode Streams | No | We don't use Streams. Program events (`MatchCreated`, `StakeDeposited`, `MatchClosed`) are emitted and could feed a Stream into the reconciler later. |
| ElevenLabs | No | No audio features. |
| Gemini Prediction Markets | No | Head-to-head escrow isn't a prediction market, and we don't use Gemini's APIs. |
| Grok Bot | No | Not used. |
