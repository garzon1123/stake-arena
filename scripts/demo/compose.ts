/**
 * Builds deliverables/stake-arena-demo.mp4 from the real footage recorded by record.spec.ts.
 * - Frames, captions and title cards are rendered as HTML (Playwright) at 1920x1080.
 * - Footage is overlaid unmodified (scaled) — no UI is faked.
 * - Narration is generated locally with macOS `say` (no third-party audio, no music).
 * Usage: npx tsx scripts/demo/compose.ts deliverables/raw
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const RAW = resolve(process.argv[2] ?? 'deliverables/raw');
const WORK = resolve(RAW, '../build');
const OUT = resolve(RAW, '../stake-arena-demo.mp4');
mkdirSync(WORK, { recursive: true });
const m = JSON.parse(readFileSync(`${RAW}/markers.json`, 'utf8'));
const proof = JSON.parse(readFileSync(`${RAW}/proof.json`, 'utf8'));
const s = (k: string) => m.marks[k] / 1000;
const winnerVideo = m.winner === 'a' ? m.videoA : m.videoB;
const winnerName = m.winner === 'a' ? m.names.a : m.names.b;

type Seg =
  | { kind: 'card'; html: string; say: string; min?: number }
  | { kind: 'solo'; video: string; from: number; to: number; caption: string; label: string; say: string }
  | { kind: 'duo'; from: number; to: number; caption: string; say: string };

const SEGMENTS: Seg[] = [
  {
    kind: 'card',
    min: 5,
    html: `<div class="center"><div class="logo">${LOGO()}<span>STAKE <em>Arena</em></span></div>
      <h1>Prove your skill.<br/><span class="grad">Own your victory.</span></h1>
      <p class="sub">Skill-matched chess with stakes held and paid out by a Solana program.</p>
      <div class="pill">Recorded live on a local Solana validator · valueless test tokens</div></div>`,
    say: 'This is STAKE Arena. Prove your skill. Own your victory.',
  },
  {
    kind: 'card',
    html: `<div class="center narrow"><div class="eyebrow">The problem</div>
      <h2>Playing for stakes today means trusting a stranger.</h2>
      <div class="three"><div><b>Matching</b><span>Finding a fair opponent at your level</span></div>
      <div><b>Results</b><span>Self-reported, easy to dispute</span></div>
      <div><b>Payouts</b><span>A separate app, and you hope they pay</span></div></div></div>`,
    say: 'Competitive players want to play for something real. But matching skill, verifying the result, and paying the winner are three separate, trust heavy steps. STAKE Arena brings them into one flow.',
  },
  {
    kind: 'solo',
    video: m.videoA,
    from: s('landing'),
    to: s('onboard'),
    label: 'Player A',
    caption: 'Head-to-head blitz chess · skill matchmaking · Solana escrow settlement',
    say: 'Players compete head to head in blitz chess, matched by skill, with their stakes held by a Solana escrow program.',
  },
  {
    kind: 'duo',
    from: s('onboard'),
    to: s('matchmaking'),
    caption: 'Two browser profiles · two separate wallets · sign-in by message signature · free test tokens',
    say: 'Two players, in two separate browser profiles, connect their own wallets. Each signs a one time message to prove ownership, creates a player card, and claims free test tokens. Network fees are sponsored, so neither player needs SOL.',
  },
  {
    kind: 'duo',
    from: s('matchmaking'),
    to: s('funding'),
    caption: 'Same stake tier + time control · paired within ±150 Elo',
    say: 'Both choose a ten token stake. The matchmaking engine pairs them by stake tier, time control, and Elo rating.',
  },
  {
    kind: 'duo',
    from: s('funding'),
    to: s('game'),
    caption: 'create_match opens a PDA escrow · each player signs one deposit into the program vault',
    say: 'The escrow program opens a dedicated account for this match. Each player approves one deposit into a program owned vault. The board only unlocks after the server reads both deposits back from the chain.',
  },
  {
    kind: 'duo',
    from: s('game'),
    to: s('result'),
    caption: 'Server-authoritative moves and clocks · synced live to both players',
    say: "Now they play. Every move is validated and timed by the server, and synced live to both players. Here's a quick, legal checkmate.",
  },
  {
    kind: 'duo',
    from: s('result'),
    to: s('profile'),
    caption: 'Checkmate verified by the server → adjudicator signs settle → 20 TEST pot to the winner',
    say: 'Checkmate. The server derives the result from the moves themselves and updates both ratings exactly once. The adjudicator then submits the settle instruction, and the escrow pays the full twenty token pot to the winner. The payout is only shown as confirmed after the validator confirms it.',
  },
  {
    kind: 'card',
    html: PROOF_HTML(),
    say: 'This is the real settlement transaction from our local Solana validator. The STAKE Arena program executes settle, the vault owned by the escrow address is emptied and closed, and the winner receives the twenty token pot.',
  },
  {
    kind: 'solo',
    video: winnerVideo,
    from: s('profile'),
    to: s('end'),
    label: `Winner · ${winnerName}`,
    caption: 'Ratings, statistics, match history and leaderboard update from real results',
    say: 'Ratings, statistics, and match history update automatically, and the leaderboard reflects real results.',
  },
  {
    kind: 'card',
    min: 6,
    html: `<div class="center narrow"><div class="logo small">${LOGO()}<span>STAKE <em>Arena</em></span></div>
      <h2>Chess first. Any skill game with a verifiable result next.</h2>
      <ul class="next"><li>✓ Verified today on a local Solana validator</li><li>→ Next: public devnet deployment, fair-play analysis, more games, independent audit</li></ul>
      <div class="pill">Demo mode · test tokens have no cash value · not audited</div></div>`,
    say: 'STAKE Arena runs today on a local Solana validator with valueless test tokens, and public devnet deployment is next. Chess is our first game. The same escrow and settlement layer can power any skill game with a verifiable result.',
  },
];

function LOGO() {
  return `<svg viewBox="0 0 32 32" width="56" height="56"><rect width="32" height="32" rx="8" fill="#16161e" stroke="rgba(255,255,255,.1)"/><path d="M9 22h14M11 22l1.5-8L16 9l3.5 5 1.5 8" fill="none" stroke="#8b7cff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="9" r="1.8" fill="#3ddc97"/></svg>`;
}

function PROOF_HTML() {
  const short = (x: string, n = 6) => `${x.slice(0, n)}…${x.slice(-n)}`;
  const rows = proof.tokenChanges
    .map(
      (r: { label: string; account: string; before: string; after: string }) =>
        `<tr><td>${r.label}</td><td class="mono dim">${short(r.account)}</td><td class="mono">${r.before}</td><td class="mono">→</td><td class="mono ${r.after === 'closed' || r.after === r.before ? 'dim' : 'win'}">${r.after}</td></tr>`,
    )
    .join('');
  const logs = proof.logs.map((l: string) => `<div>${l.replace(/</g, '&lt;')}</div>`).join('');
  return `<div class="proof"><div class="eyebrow">Onchain proof · local Solana validator (not devnet)</div>
    <h2>settle — confirmed in slot ${proof.slot}</h2>
    <div class="kv"><span>Signature</span><code>${proof.signature}</code></div>
    <div class="kv"><span>Program</span><code>${proof.programId}</code></div>
    <div class="cols"><table><thead><tr><th>Token account</th><th></th><th>Before</th><th></th><th>After</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="logs">${logs}</div></div>
    <div class="foot">Output of <code>getTransaction</code> / <code>solana confirm -v</code> for match ${proof.matchId.slice(0, 8)}… · TEST is a valueless test token</div></div>`;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0}
body{width:1920px;height:1080px;background:#0a0a0d;color:#ededf3;font-family:Geist,sans-serif;overflow:hidden;
 background-image:radial-gradient(1100px 520px at 72% -8%,rgba(114,98,255,.22),transparent 60%),radial-gradient(700px 400px at -5% 10%,rgba(61,220,151,.06),transparent 60%)}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:28px;padding:0 160px}
.narrow{padding:0 260px}
.logo{display:flex;align-items:center;gap:16px;font-size:34px;font-weight:600}.logo em{font-style:normal;color:#a1a1b5;font-weight:500}
.logo.small{font-size:26px}
h1{font-size:104px;line-height:1.02;letter-spacing:-.035em;font-weight:600}
h2{font-size:64px;line-height:1.08;letter-spacing:-.03em;font-weight:600}
.grad{background:linear-gradient(90deg,#b7adff,#8b7cff,#6d5cff);-webkit-background-clip:text;color:transparent}
.sub{font-size:30px;color:#a1a1b5}
.pill{margin-top:12px;padding:12px 22px;border-radius:999px;border:1px solid rgba(245,185,74,.35);background:rgba(245,185,74,.08);color:#f5b94a;font-size:22px;font-weight:500;letter-spacing:.02em}
.eyebrow{font-size:22px;letter-spacing:.18em;text-transform:uppercase;color:#8b7cff;font-weight:500}
.three{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;width:100%;margin-top:12px}
.three div{border:1px solid rgba(255,255,255,.09);background:#13131a;border-radius:18px;padding:28px;text-align:left;display:flex;flex-direction:column;gap:8px}
.three b{font-size:30px}.three span{font-size:22px;color:#a1a1b5}
.next{list-style:none;padding:0;font-size:28px;color:#a1a1b5;display:flex;flex-direction:column;gap:10px}
.frame .label{position:absolute;top:44px;font-size:22px;color:#a1a1b5;font-weight:500;letter-spacing:.02em}
.frame .shot{position:absolute;border-radius:14px;border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 80px -30px rgba(0,0,0,.8)}
.caption{position:absolute;left:0;right:0;bottom:44px;text-align:center;font-size:30px;font-weight:500;padding:0 120px}
.caption span{background:rgba(19,19,26,.92);border:1px solid rgba(255,255,255,.1);padding:14px 28px;border-radius:14px;display:inline-block}
.badge{position:absolute;top:36px;right:48px;font-size:18px;color:#f5b94a;border:1px solid rgba(245,185,74,.35);border-radius:999px;padding:8px 16px;background:rgba(245,185,74,.08)}
.brand{position:absolute;top:30px;left:48px;display:flex;gap:12px;align-items:center;font-size:22px;font-weight:600}.brand svg{width:34px;height:34px}
.proof{position:absolute;inset:90px 110px 70px;display:flex;flex-direction:column;gap:30px}
.proof h2{font-size:68px}
.kv{display:flex;gap:18px;font-size:26px;align-items:center}.kv span{color:#6c6c80;width:120px}
code,.mono{font-family:'Geist Mono',monospace}
.kv code{font-size:24px;color:#b7adff;word-break:break-all}
.cols{display:grid;grid-template-columns:1.1fr 1fr;gap:28px;margin-top:8px}
table{border-collapse:collapse;font-size:32px;background:#13131a;border:1px solid rgba(255,255,255,.09);border-radius:16px;overflow:hidden;align-self:start}
th{font-size:16px;letter-spacing:.12em;text-transform:uppercase;color:#6c6c80;text-align:left;padding:16px 18px;font-weight:500}
td{padding:24px 22px;border-top:1px solid rgba(255,255,255,.06)}
.win{color:#3ddc97}.dim{color:#6c6c80}
.logs{background:#0f0f14;border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:20px 22px;font-family:'Geist Mono',monospace;font-size:21px;line-height:1.7;color:#a1a1b5}
.logs div:nth-child(2){color:#3ddc97}
.foot{font-size:22px;color:#6c6c80;margin-top:auto}
`;

// Layout for footage segments
const SOLO = { x: 240, y: 92, w: 1440, h: 900 };
const DUO = [
  { x: 24, y: 170, w: 924, h: 578 },
  { x: 972, y: 170, w: 924, h: 578 },
];

function frameHtml(seg: Seg): string {
  const brand = `<div class="brand">${LOGO()}STAKE Arena</div><div class="badge">Live recording · local Solana validator · test tokens</div>`;
  if (seg.kind === 'card') return `<div>${seg.html}</div>`;
  if (seg.kind === 'solo') {
    return `<div class="frame">${brand}<div class="caption" style="bottom:20px"><span>${seg.caption}</span></div></div>`;
  }
  const [l, r] = DUO;
  return `<div class="frame">${brand}
    <div class="label" style="left:${l!.x}px;top:${l!.y - 40}px">Player A · ${m.names.a} · Browser profile 1</div>
    <div class="label" style="left:${r!.x}px;top:${r!.y - 40}px">Player B · ${m.names.b} · Browser profile 2</div>
    <div class="caption" style="bottom:150px"><span>${seg.caption}</span></div></div>`;
}

const run = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const duration = (f: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const parts: string[] = [];
for (const [i, seg] of SEGMENTS.entries()) {
  const id = String(i).padStart(2, '0');
  await page.setContent(`<html><head><style>${CSS}</style></head><body>${frameHtml(seg)}</body></html>`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${WORK}/${id}-bg.png` });

  const aiff = `${WORK}/${id}.aiff`;
  execFileSync('say', ['-v', 'Samantha', '-r', '178', '-o', aiff, seg.say]);
  const voice = duration(aiff);
  const out = `${WORK}/${id}.mp4`;
  const audio = ['-i', aiff];
  const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k'];

  if (seg.kind === 'card') {
    const len = Math.max(seg.min ?? 0, voice + 1.2);
    run(['-loop', '1', '-t', `${len}`, '-i', `${WORK}/${id}-bg.png`, ...audio, '-filter_complex', `[1:a]adelay=400|400,apad[a]`, '-map', '0:v', '-map', '[a]', '-t', `${len}`, ...enc, out]);
  } else {
    const clip = seg.to - seg.from;
    const len = Math.max(clip, voice + 1.0);
    const hold = Math.max(0, len - clip);
    const sources =
      seg.kind === 'solo'
        ? ['-ss', `${seg.from}`, '-t', `${clip}`, '-i', seg.video]
        : ['-ss', `${seg.from}`, '-t', `${clip}`, '-i', m.videoA, '-ss', `${seg.from - m.offsetB / 1000}`, '-t', `${clip}`, '-i', m.videoB];
    const pad = `tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)},setpts=PTS-STARTPTS`;
    const filter =
      seg.kind === 'solo'
        ? `[1:v]scale=${SOLO.w}:${SOLO.h},${pad}[v1];[0:v][v1]overlay=${SOLO.x}:${SOLO.y}[v];[2:a]adelay=300|300,apad[a]`
        : `[1:v]scale=${DUO[0]!.w}:${DUO[0]!.h},${pad}[v1];[2:v]scale=${DUO[1]!.w}:${DUO[1]!.h},${pad}[v2];[0:v][v1]overlay=${DUO[0]!.x}:${DUO[0]!.y}[t];[t][v2]overlay=${DUO[1]!.x}:${DUO[1]!.y}[v];[3:a]adelay=300|300,apad[a]`;
    run(['-loop', '1', '-t', `${len}`, '-i', `${WORK}/${id}-bg.png`, ...sources, ...audio, '-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-t', `${len}`, ...enc, out]);
  }
  parts.push(out);
  console.log(`segment ${id}: ${duration(out).toFixed(1)}s`);
}
await browser.close();

writeFileSync(`${WORK}/list.txt`, parts.map((p) => `file '${p}'`).join('\n'));
run(['-f', 'concat', '-safe', '0', '-i', `${WORK}/list.txt`, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', OUT]);
console.log(`\n${OUT}  ${duration(OUT).toFixed(1)}s`);
