# STAKE Arena

**Prove your skill. Own your victory.**

Skill-matched, real-time blitz chess. Each player's test-token stake is locked in a **Solana escrow program**, and the program pays the winner once the server has verified the result.

> ⚠️ **DEMO MODE — TEST TOKENS HAVE NO CASH VALUE.** Solana devnet/localnet only. There is no real-money mode, no fiat on/off-ramp and no mainnet configuration. The program has not been audited.

UBC Hackathon 2026 · **Track:** Consumer Applications · **Chain award:** Best use of Solana · **Bounties:** none

📹 Demo video: _TBD_ · 🌐 Live demo: _TBD_

---

## Contents

1. [Product](#product) · 2. [Why Solana](#why-solana) · 3. [Architecture](#architecture) · 4. [Escrow program](#escrow-program) · 5. [Matchmaking & verification](#matchmaking--result-verification) · 6. [Security & trust](#security--trust-assumptions) · 7. [Local setup](#local-setup) · 8. [Environment](#environment-variables) · 9. [Testing](#testing) · 10. [Devnet deployment](#devnet-deployment) · 11. [Deploying the app](#deploying-the-app) · 12. [Limitations & roadmap](#known-limitations)

## Product

**Problem.** Competitive players want a match with something on the line. Today that means trusting a stranger to pay, self-reporting results, and keeping identity, skill rating and payments in separate places.

**STAKE Arena** puts the whole loop in one flow:

1. **Connect** a Solana wallet (Phantom, Solflare, Backpack, or the built-in *STAKE Demo Wallet*) and sign a free message to verify ownership.
2. **Create a player card**: username, avatar, bio. Everyone starts at 1200 Elo.
3. **Pick a stake** (5 / 10 / 25 TEST) and a time control (3+0 blitz or a 1+0 demo mode). Grab free test tokens from the faucet.
4. **Get matched** with a player of similar rating.
5. **Fund the match**: each player approves one deposit into the match's program vault. Fees are sponsored, so you never need SOL.
6. **Play** live chess with server-validated moves and server clocks.
7. **Settle**: the program sends the full pot to the winner (draw → both refunded), with an Explorer link.
8. Ratings, history and the leaderboard update.

Pages: Landing · Arena dashboard · Live match (funding → game → result) · Leaderboard · Player profile · How it works / Safety.

## Why Solana

Settlement is the product, so it has to be cheap, fast and verifiable:

- **Program-owned custody.** An Anchor program and a PDA-owned SPL token vault hold the stakes, not a company wallet. Anyone can audit the rules and every transfer.
- **Fast finality and low fees.** A deposit confirms in about a second for fractions of a cent, so funding a 3-minute game doesn't feel like a bank transfer. Low fees also let the server sponsor fees so players never touch SOL.
- **Native primitives.** SPL Token `transfer_checked`, associated token accounts, PDAs as signers, Wallet Standard wallets, and events for indexing.

| Item | Address |
|---|---|
| `stake_arena` program | `4CGHpkEjVe6PAZC5V2cpNH2u1kakXQUxru4CSpnarCZL` — **devnet deployment pending** ([status](#devnet-deployment)) |
| TEST mint (devnet) | _created by `npm run deploy:devnet`; fill in_ |
| Adjudicator / fee payer | `8ytvgotQDBPgAoqUrBxasfAE3VBu7kHxDSGdHSPsG4RB` |

Only verified addresses go in this table. Explorer: `https://explorer.solana.com/address/<id>?cluster=devnet`.

## Architecture

```
React (Vite) ──REST + Socket.IO──▶ Fastify server ──Drizzle──▶ PostgreSQL
     │                                 │
     └─ wallet signs deposit ──────────┴── @solana/kit ──▶ stake_arena (Anchor) + SPL Token
```

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS v4, Radix primitives, Motion, Lucide, TanStack Query, react-chessboard, chess.js, Wallet Standard (`@wallet-standard/react`, `@solana/react`) |
| Backend | Node 22+, Fastify 5, Socket.IO 4, Zod 4, chess.js, `@solana/kit` 8, `@solana-program/token` |
| Database | PostgreSQL 16, Drizzle ORM + migrations (PGlite for tests) |
| Chain | Anchor 1.2 (Rust), SPL Token, PDAs, LiteSVM tests |
| Tests | Rust/LiteSVM, Vitest, Playwright |

```
programs/stake_arena   Anchor escrow program + tests
apps/server            API, realtime, game engine, matchmaking, Solana client
apps/web               consumer UI
packages/shared        zod schemas, typed socket events, Elo, lifecycle
tests/e2e              two-browser Playwright test
scripts                validator / keys / mint setup / devnet deploy
docs                   architecture, security, demo script, submission, requirements
```

Deep dive: [`docs/architecture.md`](docs/architecture.md).

## Escrow program

`programs/stake_arena/src`. Accounts: `MatchEscrow` PDA `["match", match_uuid]`; vault token account PDA `["vault", escrow]` with authority = escrow PDA.

| Instruction | Who | What |
|---|---|---|
| `create_match(match_id, player_one, player_two, stake, funding_window, resolution_window)` | creator + adjudicator (co-sign) | Initializes the escrow and vault and binds both wallets, mint, stake, deadline and adjudicator. Players must be distinct and neither can be the adjudicator. |
| `deposit()` | the seat's player | Moves exactly `stake` via `transfer_checked`. Rejects outsiders, duplicates, wrong mint and late deposits. The second deposit sets `Funded`. |
| `settle(outcome)` | adjudicator only | `Funded` → `Settled`: 1/2 = full pot to that player, 3 = draw refund. Can never run twice. |
| `cancel_unfunded()` | anyone after the deadline (adjudicator anytime) | Refunds whatever was deposited → `Cancelled`. |
| `refund_unresolved()` | anyone after `funded_at + 1h` (adjudicator anytime) | Refunds both stakes if a result is never settled → `Refunded`. |

Every payout destination is constrained to `token::authority = player_one/two` and `token::mint = mint`. There is no admin withdrawal path. The vault is closed (rent returned) when it's empty. Events: `MatchCreated`, `StakeDeposited`, `MatchClosed`.

## Matchmaking & result verification

- **Queue:** persistent `matchmaking_queue`. Players are paired on the same tier and time control, within ±150 Elo, widening by 50 every 10 s (max ±600), oldest first, closest rating preferred. Pairing, match creation and seat reservation happen in one transaction. Partial unique indexes enforce *one waiting entry per player* and *one active match per player*.
- **Colors** are assigned randomly (white = onchain `player_one`).
- **Game:** the server is authoritative. Clients send `{matchId, ply, from, to, promotion}`; the server checks session, seat, turn, ply sequence, legality (chess.js: castling, en passant, promotion, check) and the clock. Results: checkmate, resignation, timeout, stalemate, threefold repetition, 50-move rule, insufficient material, agreed draw. Flag fall vs a bare king (or king + one minor) is a draw.
- **Disconnects:** clocks keep running while you're away (and across server restarts). Reconnecting resumes the same game from persisted moves.
- **Elo:** standard formula, K = 32, start 1200. Applied in the same DB transaction as the result, guarded by unique keys, so exactly once.

## Security & trust assumptions

The **adjudicator** (a server key) attests results. That's a trusted-oracle MVP, not trustless gameplay: a compromised server could pick the wrong winner of a funded match, but it can't redirect funds outside the two players or settle twice. If it vanishes, anyone can refund both stakes after one hour. The server prevents illegal moves; it **can't detect engine assistance**. Full model: [`docs/security.md`](docs/security.md).

## Local setup

Prereqs: **Node 22+**, **PostgreSQL 16**, **Rust + Solana CLI (Agave) + Anchor 1.2** (`avm`). On macOS:

```bash
brew install postgresql@16 && brew services start postgresql@16
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/solana-foundation/anchor avm && avm install latest && avm use latest
```

```bash
git clone <repo> stake-arena && cd stake-arena
npm install
createdb stake_arena
cp .env.example .env
npm run keys:generate          # local, gitignored keypairs in keys/
npm run program:build          # anchor build -> target/deploy/stake_arena.so
cp target/deploy/stake_arena-keypair.json keys/stake_arena-program.json

# Option A: localnet (fully offline, recommended for development)
npm run chain:localnet                          # terminal 1: validator with program preloaded
npm run chain:setup -- --cluster localnet      # creates TEST mint, writes TEST_MINT etc. to .env

# Option B: devnet: see "Devnet deployment"

npm run db:migrate
npm run dev:server                              # terminal 2: http://localhost:8787
npm run dev:web                                 # terminal 3: http://localhost:5173
```

### Two-player demo

1. Open http://localhost:5173 in **two separate browser profiles** (or one normal + one incognito window). Each profile gets its own wallet.
2. In each: **Enter the Arena → STAKE Demo Wallet** (or Phantom/Solflare on devnet) → **Sign message** → create a profile → **Faucet**.
3. Choose the same stake and time control in both and click **Find opponent**.
4. Both: **Deposit**. The board unlocks when both deposits are verified onchain.
5. Fool's Mate: White `f3`, Black `e5`, White `g4`, Black `Qh4#`.
6. Watch **Settlement pending → Confirmed**, then open the Explorer link. Balances: winner +stake, loser −stake.

Localnet Explorer links use `cluster=custom&customUrl=http://localhost:8899`.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `NODE_ENV` | development | `production` serves `apps/web/dist` from the API server |
| `PORT` / `HOST` | 8787 / 0.0.0.0 | |
| `WEB_ORIGIN` | http://localhost:5173 | CORS origin, cookie `Secure` flag, sign-in message URI |
| `DATABASE_URL` | postgres://localhost:5432/stake_arena | |
| `SOLANA_CLUSTER` | devnet | `devnet` or `localnet` (no mainnet option by design) |
| `SOLANA_RPC_URL` / `SOLANA_WS_URL` | devnet public RPC | WS derived if omitted |
| `PROGRAM_ID` | 4CGH…arCZL | |
| `TEST_MINT` | — | set by `chain:setup` |
| `ADJUDICATOR_KEYPAIR` | keys/adjudicator.json | **secret**: path or JSON byte array; also fee payer |
| `MINT_AUTHORITY_KEYPAIR` | keys/mint-authority.json | **secret**: demo faucet; omit to disable the faucet |
| `FAUCET_AMOUNT` | 100 | TEST per faucet request (cooldown 2 min) |
| `FUNDING_WINDOW_SECS` | 120 | escrow funding window (program allows 30 s–24 h) |
| `VITE_SOLANA_CHAIN` | solana:devnet | build-time; the only value exposed to the browser |

## Testing

| Suite | Command | What it proves | Status |
|---|---|---|---|
| Escrow program (LiteSVM, real SPL Token) | `npm run program:test` | 19 cases: deposits, wrong mint, fixed amount, duplicates, outsiders, deadlines, winner payout, draw, double settlement, wrong adjudicator, redirected payout, time-gated cancel/refund, dust | ✅ 19/19 |
| Chess engine | `npm test` | legal/illegal, wrong turn, replay, checkmate, stalemate, threefold, insufficient material, promotion, castling, en passant, flag fall, resignation, restore-from-moves | ✅ |
| Matchmaking & Elo | `npm test` | tiers, time controls, tolerance and widening, self-match, closest pairing | ✅ |
| DB guards (PGlite) | `npm test` | nonce replay, wrong-wallet signature, session revocation, concurrent ticks → one match, one queue per player, cancelled entries | ✅ (chain stubbed, escrow not involved) |
| **Full stack on a real validator** | `npm run chain:localnet` then `npm run test:localnet` | auth → faucet → pairing → escrow create → 2 real deposits (players hold 0 SOL) → Fool's Mate → onchain settle → balances ±stake → Elo once → idempotent retry; and an underfunded match cancelled with the deposit refunded onchain | ✅ 2/2 on localnet |
| **Two browsers, real UI** | stack running, then `npm run e2e` | two Playwright contexts with separate demo wallets play a full staked match through the UI to "Confirmed" | ✅ on localnet |

Not yet run against **public devnet** (pending deploy): repeat `npm run e2e` with the stack pointed at devnet.

## Devnet deployment

Status: **not yet deployed.** The devnet faucet rate-limited our CLI airdrops. To deploy:

1. Fund the deployer at https://faucet.solana.com (≈2.5 SOL): `solana-keygen pubkey keys/deployer.json`.
2. `npm run deploy:devnet`. This builds, deploys with the program keypair `keys/stake_arena-program.json`, funds the adjudicator with 0.5 SOL, creates the TEST mint and updates `.env`.
3. Put the program ID, mint and a settlement transaction link in the table above.

## Deploying the app

One container (API + WebSocket + static web) plus managed Postgres. Any host with persistent WebSockets works (Fly.io, Render, Railway). Serverless functions won't work.

```bash
docker build --build-arg VITE_SOLANA_CHAIN=solana:devnet -t stake-arena .
docker run -p 8787:8787 \
  -e NODE_ENV=production -e WEB_ORIGIN=https://your.domain \
  -e DATABASE_URL=postgres://... -e SOLANA_CLUSTER=devnet -e SOLANA_RPC_URL=https://api.devnet.solana.com \
  -e TEST_MINT=... -e ADJUDICATOR_KEYPAIR='[...]' -e MINT_AUTHORITY_KEYPAIR='[...]' stake-arena
```

Migrations run automatically on boot. Health check: `GET /api/health`. Use a dedicated RPC provider for reliability, and set secrets through the host's secret manager.

## Known limitations

- Trusted adjudicator; no engine-assistance detection.
- Single server instance (in-memory game rooms).
- Promotion auto-queens in the UI (the server accepts any promotion piece).
- The demo wallet stores a burner key in `localStorage` (devnet only).
- Not audited; devnet deployment pending.

## Roadmap

More original or licensed skill games on the same escrow · fair-play analysis · countersigned move transcripts and dispute windows · challenge-a-friend links · clubs and non-financial tournaments · portable onchain reputation · independent audit and legal review before anything of value.

## Hackathon

Consumer Applications track · Best use of Solana. No sponsor bounties are claimed (see [`docs/submission.md`](docs/submission.md)). Requirements and eligibility notes: [`docs/HACKATHON_REQUIREMENTS.md`](docs/HACKATHON_REQUIREMENTS.md). Demo script: [`docs/demo-script.md`](docs/demo-script.md).

Built during UBC Hackathon 2026 (Nov 12–20) with AI coding assistance.
