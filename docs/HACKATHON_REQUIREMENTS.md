# UBC Hackathon 2026 — Verified Requirements

Sources checked on 2026‑11‑16:

| Source | Status |
|---|---|
| `Hackathon Guide UBC 26.pdf` (organizer guide) | ✅ Read in full |
| https://www.universityblockchain.org/programs/hackathon | ✅ Read; consistent with the guide |
| https://ubc-hackathon-2026.devpost.com/ | ⚠️ Not verified — returned HTTP 403 to automated fetch. **Check it manually before submitting.** |

## Key dates (CST)

| | |
|---|---|
| Hacking started | Thu Nov 12, 6:00 PM |
| Workshops / office hours (Solana, Circle, sponsors) | Nov 16–19 |
| **Submission deadline (Devpost)** | **Fri Nov 20, 12:00 PM CST** |
| Finalists notified | Fri Nov 20, 11:59 PM |
| Judging + final presentations (in person, UT Austin) | Sat Nov 21 |

## Our entry

| Field | Choice |
|---|---|
| Main track (exactly one) | **Consumer Applications** |
| Chain award (one or none) | **Best use of Solana** (cannot also enter Arc) |
| Bounties | **None claimed** (see checklist below) |
| Official UBC Winner | Automatic for every submission |

## Consumer Applications — technical requirements

- [x] Interact with the blockchain in some way — Anchor escrow program, SPL token deposits/payouts, wallet auth.
- [x] Working, user-facing frontend (web) — React app in `apps/web`.
- Objectives (soft): abstract crypto complexity (we sponsor all network fees; players never need SOL; built-in demo wallet), daily-use potential, intentional design.

## Best use of Solana — technical requirements

- [x] Core onchain functionality on Solana (devnet is fine) — escrow + settlement is the product's core.
- [ ] **Include the program ID(s) deployed or used in the README** — program ID `4CGHpkEjVe6PAZC5V2cpNH2u1kakXQUxru4CSpnarCZL` is reserved; **devnet deployment pending devnet SOL** (see README → Devnet deployment). Do not submit until deployed and the README address is verified on Explorer.
- [x] Explain in README how the project uses Solana.
- [x] Submitted to a main track.
- Objectives met: Anchor program, SPL Token program, PDAs, Solana wallets via Wallet Standard, low-fee settlement.

## "What to Submit" checklist (all required for eligibility and the participation prize)

- [ ] Project name, short description, all team members (Devpost form)
- [ ] Main track, chain award, bounties selected on Devpost
- [x] Written answers drafted → `docs/submission.md`
- [x] Technologies / sponsor tools list → `docs/submission.md`
- [ ] **Public GitHub repository** with source + setup instructions (repo is local only; you must create and push it)
- [ ] Working demo or deployed application (runs locally today; public deployment needs hosting — see README)
- [ ] **2–3 minute demo video** on Google Drive or YouTube, accessible to judges → script in `docs/demo-script.md`
- [x] Technical documentation / architecture overview in README
- [ ] Track-specific: devnet program address in README (pending deploy)

## Eligibility risks

1. **Pre-existing work** — "Projects must be substantially built during the hackathon." All code in this repo was created on Nov 16, 2026 (after the Nov 12 start). Keep git history as evidence.
2. **AI tools** — allowed and encouraged; the build must still be working and substantive. Team members should understand and be able to explain every part of the code in Q&A.
3. **In-person presence** — the guide states: *"Teams must be present in person for the closing ceremony to qualify for any prize, including both main track and bounty prizes."* The UBC website describes online hacking with in-person finals in Austin and doesn't spell this out. **Treat in-person attendance on Nov 21 as required** and confirm with organizers (Telegram).
4. **Missing devnet deployment** would weaken the Solana award claim (README must list the program ID).
5. **Bounties** — none claimed. QuickNode Streams, ElevenLabs, Gemini Prediction Markets and Grok Bot all require the sponsor product to be *core*; we do not use them, so selecting them would be untruthful.
6. **Legal** — testnet-only, valueless tokens, prominent demo-mode notice, no real-money mode. Keep it that way.
