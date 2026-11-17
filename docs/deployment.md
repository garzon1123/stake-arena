# Public Hosting Plan

## Recommendation: one Render web service + Neon Postgres

```
Browser ──HTTPS/WSS──▶ Render Web Service (Docker: Fastify API + Socket.IO + built web app)
                              │                         │
                              ▼                         ▼
                       Neon Postgres (TLS)      Solana devnet RPC (QuickNode/Helius free tier, or public)
```

Why this setup:
- **One origin.** The server already serves `apps/web/dist` when `NODE_ENV=production`. The session cookie and the WebSocket share a domain, so there's no cross-site cookie or CORS trouble.
- **Persistent WebSockets.** Render web services support them; serverless platforms (Vercel/Netlify functions) don't.
- **Single instance**, which our in-memory game rooms require. If the server restarts, it rebuilds active games from Postgres.
- **Docker**: the `Dockerfile` in the repo builds as-is.

| Component | Plan | Est. cost | Notes |
|---|---|---|---|
| Render Web Service | **Starter** (always on) | ~$7/month, prorated | Use Starter for the demo. The free tier sleeps when idle (cold start ≈ 1 min during judging). |
| Neon Postgres | Free tier | $0 | Connection string with `sslmode=require` |
| Devnet RPC | QuickNode (hackathon credits) or Helius free | $0 | The public `api.devnet.solana.com` works but is rate-limited |
| Domain | `*.onrender.com` | $0 | |
| **Total** | | **≈ $7 for the hackathon month** | Check current prices before purchase. These are estimates, not quotes. |

Alternative: Fly.io (one shared-cpu machine, ~$2–5/month, card required) with Neon. It's equivalent but needs `flyctl` and a `fly.toml`.

## Secrets (set in the Render dashboard, never committed)

| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `WEB_ORIGIN` | `https://<service>.onrender.com` (exact, no trailing slash) |
| `DATABASE_URL` | Neon connection string (`…?sslmode=require`) |
| `SOLANA_CLUSTER` | `devnet` |
| `SOLANA_RPC_URL` / `SOLANA_WS_URL` | devnet RPC http(s) and ws(s) URLs |
| `PROGRAM_ID` | `4CGHpkEjVe6PAZC5V2cpNH2u1kakXQUxru4CSpnarCZL` |
| `TEST_MINT` | devnet mint from `npm run deploy:devnet` |
| `ADJUDICATOR_KEYPAIR` | JSON byte array: `cat keys/adjudicator.json` pasted as a **secret** |
| `MINT_AUTHORITY_KEYPAIR` | JSON byte array from `keys/mint-authority.json` (secret) |
| `VITE_SOLANA_CHAIN` | `solana:devnet` (build-time) |

Fund the adjudicator with ≥0.5 devnet SOL. It pays the sponsored fees and escrow rent (~0.0035 SOL per match).

## Steps (after the devnet deploy and your approval to spend)

1. Push the repo to GitHub.
2. Neon: create a project and copy the pooled connection string.
3. Render: New → Blueprint → select the repo (uses `render.yaml`), or New → Web Service → Docker. Fill in the secrets above.
4. Deploy. Migrations run on boot. Check `GET /api/health` → `{"ok":true,"cluster":"devnet"}`.
5. Smoke test: `E2E_BASE_URL=https://<service>.onrender.com npm run e2e` (two real browser contexts, real devnet transactions).

## What works publicly, and why

- **Wallet auth**: the sign-in message embeds `WEB_ORIGIN`, and cookies get `Secure` automatically over https.
- **WebSockets**: same-origin `wss://`; `trustProxy` is enabled for Render's proxy.
- **Demo faucet**: mints valueless TEST via the server-held mint authority, rate-limited (2-minute cooldown, max 5/min per IP).
- **Phantom/Solflare**: users must switch the wallet to **Devnet**. The built-in demo wallet needs no setup.
