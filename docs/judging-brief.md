# Judging Brief: how to explain STAKE Arena

## 30-second pitch

"Competitive players want to put something on the line, but today that means trusting a stranger to pay and arguing over self-reported results. STAKE Arena matches you with a player at your level, locks both stakes in a Solana program, and when the game ends the program pays the winner automatically. You never need SOL, you never hand money to a person, and every payout is a transaction anyone can check."

## The smart contract in plain words

Think of each match as **a lockbox the program creates just for that game**.

- **The lockbox address is computed from the match ID** (a Program Derived Address). Nobody holds a private key for it; only our program can sign for it. That's why "the program, not a person, holds the money" is literally true.
- Inside the lockbox are **two seat assignments** (white's wallet, black's wallet), **which token**, **the exact stake**, **a funding deadline**, and **who is allowed to report the result** (the adjudicator).
- **Five instructions:**
  1. `create_match`: opens the lockbox.
  2. `deposit`: each player puts in exactly the stake. Wrong player, wrong token, a second deposit or a late deposit all fail.
  3. `settle`: the adjudicator reports the winner. The program sends the whole pot to the winner, or refunds both on a draw. It can only happen once.
  4. `cancel_unfunded`: if someone doesn't pay in time, *anyone* can close it after the deadline, and whoever paid is refunded.
  5. `refund_unresolved`: if a funded game is never settled, *anyone* can refund both players after one hour.
- **The key safety property:** every path out of the lockbox pays only the two players' own token accounts. There is no admin withdraw, and the adjudicator can't send money to itself.

## Custody: who holds the money when?

| Moment | Where the tokens are |
|---|---|
| Before the match | Player's own wallet |
| After deposit | The program-owned vault (PDA). Not our server, not the opponent |
| After settle | Winner's wallet (or each player's on a draw/refund) |

The server's key is the **fee payer** (it sponsors gas) and the **adjudicator** (it reports results). It never holds player tokens.

## Trust model: say this before they ask

"It's not fully trustless, and we're explicit about that. Our server is the adjudicator: it watches the game and reports the result. If our server were compromised it could report the wrong winner of a funded game. What it *can't* do is steal the money, pay itself, pay anyone outside the two players, or settle twice. That's enforced onchain. If our server disappears, anyone can refund both players after an hour. Next steps to reduce trust: players countersign the move list, a dispute window, and multi-party attestation."

"We also don't claim to be cheat-proof. The server stops illegal moves and clock tricks. It can't tell if someone has a chess engine open in another tab. That's fair-play analysis, which is on our roadmap."

## How the result is verified

- The browser only *proposes* a move. The server checks: is this your match, is it your turn, is this the next move number (no replays), is the move legal (chess.js), and is your clock still running?
- The server keeps the official clocks. If you disconnect, your clock keeps running. Refreshing puts you back in the same game.
- Checkmate, stalemate, repetition and so on are detected by the server from the actual moves. The browser never says who won.

## Matchmaking

Same stake tier, same time control, ratings within ±150 Elo. The window widens by 50 every 10 s if nobody is around (capped at ±600). Pairing is a single database transaction with unique constraints, so you can't be double-matched, matched with yourself, or in two games at once.

## Solana transactions in one match

1. `create_match`: server pays rent (≈0.0035 SOL) and fee.
2. `deposit` ×2: signed by each player's wallet; the fee is paid by our server (fee sponsorship), so players hold zero SOL.
3. `settle`: signed by the adjudicator; moves the pot; the vault account is closed and its rent reclaimed.

**Why Solana?** Sub-second confirmation and sub-cent fees make sponsoring every player's gas affordable and keep funding a 3-minute game from feeling slow. On top of that come native token standards and PDAs for program-owned custody.

## Why we verify deposits onchain (likely question)

"We never trust a transaction signature the browser sends us. After a deposit lands, the server reads the lockbox account itself and only starts the game when the program says both seats are funded. A background job re-checks every few seconds, so a refresh or a server restart can't desync it."

## Limitations (be upfront)

- Trusted adjudicator; no engine-assistance detection.
- One server instance (in-memory game rooms; state is persisted, so restarts recover).
- The UI auto-queens on promotion (the server supports any piece).
- The program is unaudited. Devnet with a valueless test token only. Any real-value version would need legal review and an audit first.
- Devnet deployment status: see README.

## Likely Q&A

- **"Isn't this gambling?"** It's a technology demo on devnet with a token worth nothing. There's no fiat, no withdrawals and no mainnet mode. Real-value use would require legal and regulatory review first; we built it so that switch doesn't exist.
- **"What stops the loser from disconnecting?"** Their clock keeps running and they lose on time. Disconnecting can't cancel a funded game.
- **"Why not put the whole game onchain?"** Validating every chess move onchain is possible but slow and costly for blitz. We keep play offchain, authoritative and auditable, and put custody and settlement onchain. Countersigned move transcripts are the path to verifying results onchain.
- **"How is it different from existing platforms?"** It combines a consumer-grade game UX, skill matching, results computed from the game itself, and noncustodial programmable settlement. The escrow layer is game-agnostic.
