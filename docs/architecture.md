# Architecture

```
┌──────────────────────────────┐        HTTPS (REST)        ┌──────────────────────────────────────────┐
│  apps/web  (React + Vite)    │ ─────────────────────────▶ │  apps/server  (Fastify + Socket.IO)      │
│  • Wallet Standard discovery │ ◀───── WebSocket ────────▶ │  • wallet auth (nonce + ed25519)         │
│  • STAKE Demo Wallet (burner)│      (cookie-authed)       │  • matchmaker (atomic DB pairing)        │
│  • react-chessboard + clocks │                            │  • MatchService (lifecycle state machine)│
│  • TanStack Query            │                            │  • ChessGame (chess.js, authoritative)   │
└──────────────┬───────────────┘                            │  • settlement worker + reconciler        │
               │ signs deposit tx                           └───────┬───────────────────────┬──────────┘
               │ (wallet popup)                                     │ Drizzle               │ @solana/kit
               ▼                                                    ▼                       ▼
        player's wallet                                     PostgreSQL               Solana (devnet/localnet)
                                                                                    stake_arena Anchor program
                                                                                    + SPL Token program
```

A single Node process serves the API, the WebSocket gateway and (in production) the built web app, so cookies and sockets share one origin. No serverless functions are involved because Socket.IO needs long-lived connections.

## Packages

| Path | Purpose |
|---|---|
| `programs/stake_arena` | Anchor 1.2 escrow program + LiteSVM tests |
| `apps/server` | API, realtime, game engine, matchmaking, Solana client, DB |
| `apps/web` | Consumer UI |
| `packages/shared` | Zod schemas, typed socket events, constants, Elo, lifecycle transitions |
| `tests/e2e` | Playwright two-browser end-to-end test |
| `scripts` | Validator, key generation, mint setup, devnet deploy |

## Match lifecycle

```
CREATED ──escrow created onchain──▶ AWAITING_DEPOSITS ──both deposits verified──▶ FUNDED ──▶ ACTIVE
   │                                       │                                                   │
   └─create failed─▶ CANCELLED ◀──deadline passed (cancel job refunds any deposit)             │ game ends
                                                                                               ▼
                    SETTLED ◀──settle confirmed── SETTLEMENT_PENDING ◀────────────── RESULT_RECORDED
                    REFUNDED ◀─(recovery path)──┘
```

`packages/shared/src/lifecycle.ts` defines the allowed transitions. `MatchService.transition()` applies them with an optimistic `UPDATE … WHERE status = :from`, so a stale actor can't move a match twice.

One UUID identifies the match everywhere: the DB primary key, the socket room `match:<id>`, and the escrow PDA seed `["match", uuid_bytes]`.

## Funding flow (fee-sponsored)

1. The server builds the `deposit` instruction with the player as signer and the **adjudicator as fee payer**, compiles it, and remembers the exact message bytes (single use, 90 s).
2. The browser asks the wallet to `signTransaction` (Wallet Standard `solana:signTransaction`).
3. The server verifies that the returned message is byte-identical to the one it issued and that the player's signature is valid. Only then does it add the fee-payer signature and submit.
4. After confirmation, the server **reads the escrow account** and marks the seat funded only if `player_*_deposited == true` onchain. A reconciler loop repeats this every 3 s, which covers refreshes, crashes and transactions that confirm late.

## Gameplay

`ChessGame` wraps chess.js and adds a server clock. For each move the server checks that the session owns a seat, that it's the player's turn, the ply sequence number (replay protection), legality and flag fall. Then it persists the move (`moves` PK `(match_id, ply)`) and broadcasts it. A per-match promise lock serializes moves, timeouts, resignations and draw responses. A timer fires at the moment of flag fall. After a restart, `recover()` replays moves from the DB and checks the clocks.

## Settlement

`finish()` writes the result, the rating history (unique `(match_id, player_id)`), the stats and a `settlement_jobs` row in **one transaction**, guarded by `ACTIVE → RESULT_RECORDED`. The worker then:

- reads the escrow; if it is already `Settled`, it records success (idempotent);
- otherwise records the pending signature before sending `settle`, confirms it, re-reads the escrow to verify, and marks the match `SETTLED`;
- on failure, retries with exponential backoff (max 60 s). The UI shows "Settlement pending" and a Retry button.

## Data model

`players`, `wallet_auth_nonces`, `sessions` (token hash only), `matchmaking_queue` (partial unique: one WAITING row per player), `matches`, `match_participants` (partial unique: one active match per player), `moves`, `match_results`, `rating_history`, `escrow_transactions` (signature PK), `settlement_jobs`, `audit_logs`. Migrations live in `apps/server/drizzle/`.

## Scaling notes (post-hackathon)

The game rooms and per-match locks live in process memory, so the MVP runs as **one server instance**. Scaling out would need a Socket.IO Redis adapter plus a distributed lock or match→instance affinity. DB invariants (unique indexes, conditional updates) already protect correctness across instances.
