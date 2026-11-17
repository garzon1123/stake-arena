# Security & Trust Model

> STAKE Arena is a **devnet/localnet-only prototype** that uses a valueless test token. The program is **not audited**. Any version involving assets of value would need independent legal review, regulatory compliance and a professional security audit first.

## Trust assumptions

| Party | Can | Cannot |
|---|---|---|
| **Adjudicator key** (server) | Choose the outcome of a *funded* match (P1 / P2 / draw); cancel an unfunded match early; refund a funded match early | Send funds to anyone except the two bound players' token accounts; settle twice; settle an unfunded match; withdraw vault funds arbitrarily |
| **Any wallet** | Cancel an unfunded match after its funding deadline; refund a funded match after `funded_at + resolution_window` (1 h) | Do either earlier; deposit into someone else's seat |
| **Player** | Deposit exactly one stake into their own seat | Change the amount or mint; deposit twice; fund both seats (seats must be distinct wallets); trigger an early refund |
| **Mint authority** (demo faucet) | Mint new TEST to anyone | Touch tokens already in a vault or a player's account |

**The adjudicator is a trusted oracle.** A compromised server could misreport a winner. Mitigations: result records and the full move list are stored and auditable; the adjudicator can't be a player (enforced onchain); and funds can only ever go to the two players. Stronger designs would use multi-party attestation, signed move transcripts that players countersign, a dispute window, or onchain verification of the move list.

## Onchain program checks (`programs/stake_arena`)

- PDA seeds and bumps validated on every instruction (`match` + match id, `vault` + escrow).
- `has_one = mint, vault, creator`. Token accounts are constrained by `token::mint` and `token::authority = player`.
- `transfer_checked` (mint + decimals verified) for every movement.
- Distinct players; adjudicator ≠ player; stake > 0; windows bounded; `stake * 2` overflow-checked; all clock math uses `checked_add`.
- Terminal states (`Settled`, `Cancelled`, `Refunded`) reject every further payout. Match ids can't be reused because the PDA already exists.
- Vault closes only when empty, so donated dust can't block a payout (tested).
- Tests: `programs/stake_arena/tests/escrow.rs`, 19 cases covering deposit, mint/amount/duplicate/outsider/late rejection, winner payout, draw refund, double settlement, wrong adjudicator, redirected payout, time-gated cancel and refund, and dust.

## Server

- **Auth:** server-issued sign-in message with a 128-bit nonce. The nonce expires after 5 min and is consumed atomically (`UPDATE … WHERE used_at IS NULL`). The ed25519 signature is verified with WebCrypto. Sessions are random 256-bit tokens in an `httpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS); only the SHA-256 hash is stored, and logout revokes.
- **WebSocket:** the handshake is authenticated with the same cookie. Payloads are Zod-validated, rate-limited per socket (token bucket) and acked. Moves carry a ply number, so replayed or out-of-order events are rejected.
- **Authoritative game:** the browser can't submit a FEN or a result. The server derives results from chess.js and its own clocks.
- **Deposits:** the server co-signs only the exact message it issued (byte comparison) and verifies the player's signature first. Funding status comes from reading the escrow account, never from a client-supplied signature.
- **Idempotency:** DB unique keys on `match_results`, `rating_history (match_id, player_id)`, `escrow_transactions.signature` and `settlement_jobs.match_id`, plus status-guarded transitions.
- **Input:** Zod on every body; usernames are `^[a-zA-Z0-9_]{3,20}$`; the bio strips control characters and `<>`, and React escapes output.
- **HTTP:** CORS restricted to `WEB_ORIGIN`; global rate limit, tighter on auth, faucet and deposit; body limit 64 KB.
- **Secrets:** keypairs come from env or gitignored files (`keys/`) and are never bundled into the frontend (only `VITE_SOLANA_CHAIN` is exposed).
- **Audit log:** `audit_logs` records sign-ins, faucet mints, pairings, escrow events, results and settlements.

## Fair play — what we do *not* claim

The server prevents illegal moves and clock manipulation. It **can't detect engine assistance** (a player consulting Stockfish in another tab). Fair-play analysis (move-accuracy vs rating, timing patterns, account reputation) is future work, and the platform is not "cheat-proof".

## Disconnect policy

Clocks are authoritative and keep running while a player is disconnected or the server is down. Reconnecting resubscribes to the same match and reloads state from the server. Disconnecting can't cancel a funded game or force a win; the absent player simply flags.

## Known limitations

- Single server instance (in-memory game rooms).
- Demo wallet keys live in browser `localStorage`. It's intended only for valueless devnet use and is labelled as such.
- The adjudicator pays escrow rent (~0.003 SOL per match; the vault's rent is reclaimed on close).
- No independent audit.
