# Demo Video Script — target 2:30

Record the **real product**. Don't use mocked transactions or pre-recorded "live" footage.

## Setup (before recording)

1. Stack running against **devnet** (preferred) or localnet: `npm run dev:server`, `npm run dev:web`.
2. Open two **separate browser profiles** side by side (e.g. Chrome profile "Player A" and a Chrome incognito/second profile "Player B"). Each gets its own wallet:
   - Phantom/Solflare/Backpack set to **Devnet** in one, and the built-in **STAKE Demo Wallet** in the other; or
   - the STAKE Demo Wallet in both (separate profiles = separate keys).
3. In both: connect, sign in, create profiles (e.g. `nimzo_fan`, `queen_sac`), press **Faucet** once. Reset the Arena screen.
4. Choose **10 TEST** and the **1+0 Demo** time control in both windows.
5. Screen recorder at 1440×900+, system audio off, mic on.

## Shot list & narration

| Time | Shot | Narration |
|---|---|---|
| 0:00–0:20 | Landing page, slow scroll over hero + animated board | "Competitive players love putting something on the line, but organizing a fair, skill-matched challenge and actually getting paid is messy. STAKE Arena fixes that: real-time chess against players at your level, with the stake held and paid out by a Solana program." |
| 0:20–0:40 | Window A: Connect wallet → sign message → Arena dashboard; hover stake tiers, payout, Elo range, balance | "Your wallet is your identity, verified with a one-time signature. No transaction. Pick a stake, see exactly what you can win and who you'll be matched against. Test tokens come from a faucet, and we sponsor network fees, so players never need SOL." |
| 0:40–1:05 | A clicks Find opponent (searching radar) → B clicks → both jump to **Fund the match**. A deposits (wallet popup), B deposits; badges flip to Funded | "The queue pairs players with the same stake and similar rating. Once paired, our Anchor program creates an escrow account for this exact match. Each player approves one deposit straight into a program-owned vault. Not to us, not to the opponent. The board only unlocks after the server reads both deposits back from the chain." |
| 1:05–1:35 | Split screen: play f3 / e5 / g4, show moves appearing instantly in both windows, clocks ticking, move list | "Moves are validated and timed by the server, not the browser. Each one is checked for turn, legality and sequence, then synced to both players in real time. If you refresh, you rejoin the same game with the same clocks." |
| 1:35–2:00 | Black plays **Qh4#**. Victory / Defeat panels, rating +16/−16, "Settlement pending" → **Confirmed**. Click **View settlement on Explorer**, show the settle instruction + token transfer | "Checkmate. The server derives the result itself, records it with the Elo update exactly once, and the adjudicator signs the program's settle instruction. The whole pot moves from the vault to the winner. You only see 'Confirmed' after Solana confirms it, and anyone can verify the transfer on Explorer." |
| 2:00–2:20 | Leaderboard → winner's profile (rating chart, history with W/L) → How it works trust section | "Ratings, history and leaderboards are built from real results. And we're explicit about trust: the adjudicator can only pay one of the two players, and if it ever disappears, anyone can refund both stakes after a timeout." |
| 2:20–2:30 | Back to landing hero | "STAKE Arena: prove your skill, own your victory. Chess today; any skill game with a verifiable result tomorrow." |

## Backup plan

- If devnet RPC is slow, record on localnet and say so. Show the Explorer link for a devnet transaction captured earlier and say it was captured earlier.
- Keep a second take of the deposit step; wallet popups occasionally need a second click.
