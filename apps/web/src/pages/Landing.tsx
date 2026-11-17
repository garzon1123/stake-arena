import { Chess } from 'chess.js';
import { motion } from 'motion/react';
import { ArrowRight, Gavel, Lock, Scale, Swords, Timer, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Board } from '../components/Board';
import { useShell } from '../components/AppShell';
import { Badge, Button, PlayerAvatar } from '../components/ui';
import { useSignedIn } from '../lib/hooks';
import { useSession } from '../wallet/WalletContext';

// A short, legal miniature replayed on loop for the hero preview (not a live game).
const PREVIEW = ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'];

function PreviewBoard() {
  const [ply, setPly] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setPly((p) => (p >= PREVIEW.length + 3 ? 0 : p + 1)), ply === 0 ? 1400 : 1100);
    return () => clearTimeout(id);
  }, [ply]);
  const c = new Chess();
  let last: { from: string; to: string } | null = null;
  for (const san of PREVIEW.slice(0, Math.min(ply, PREVIEW.length))) {
    const m = c.move(san);
    last = { from: m.from, to: m.to };
  }
  const done = ply >= PREVIEW.length;
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[28px] bg-gradient-to-br from-accent/25 via-transparent to-win/10 blur-2xl" aria-hidden />
      <div className="relative rounded-2xl border border-line-strong bg-surface/80 p-3 backdrop-blur">
        <div className="mb-3 flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <PlayerAvatar avatar="bishop" color="rose" size={28} />
            <div className="leading-tight">
              <div className="text-[13px] font-medium">black_bishop</div>
              <div className="font-mono text-[11px] text-fg-muted">1240</div>
            </div>
          </div>
          <span className="rounded-md bg-surface-2 px-2 py-1 font-mono text-sm tabular text-fg-muted">2:41</span>
        </div>
        <Board fen={c.fen()} lastMove={last} id="preview-board" />
        <div className="mt-3 flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <PlayerAvatar avatar="knight" color="violet" size={28} />
            <div className="leading-tight">
              <div className="text-[13px] font-medium">legal_eagle</div>
              <div className="font-mono text-[11px] text-fg-muted">1215</div>
            </div>
          </div>
          <span className="rounded-md bg-white px-2 py-1 font-mono text-sm font-medium tabular text-bg">2:58</span>
        </div>
      </div>
      <motion.div
        initial={false}
        animate={{ opacity: done ? 1 : 0, y: done ? 0 : 8 }}
        className="absolute -bottom-2 -right-3 rounded-xl border border-win/30 bg-bg-raised/95 px-4 py-3 shadow-2xl backdrop-blur sm:-right-8"
      >
        <div className="flex items-center gap-2 text-[13px] font-medium text-win">
          <Trophy className="size-4" /> Checkmate · pot settled
        </div>
        <div className="mt-1 font-mono text-xs text-fg-muted">+20 TEST → legal_eagle · 2 signatures</div>
      </motion.div>
      <div className="absolute -left-3 -top-5 hidden rounded-xl border border-line-strong bg-bg-raised/95 px-4 py-3 shadow-2xl backdrop-blur sm:block sm:-left-8">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Lock className="size-3.5 text-accent" /> Escrow funded
        </div>
        <div className="mt-1 font-mono text-xs text-fg-muted">2 × 10 TEST in program vault</div>
      </div>
      <div className="mt-3 text-center text-[11px] text-fg-subtle">Animated preview · not a live game</div>
    </div>
  );
}

const STEPS = [
  {
    icon: Swords,
    title: 'Get matched by skill',
    body: 'Pick a stake tier. Our queue pairs you with someone within ±150 Elo, widening gradually only if nobody is around.',
  },
  {
    icon: Lock,
    title: 'Both stakes go into escrow',
    body: 'Each player deposits the same test-token stake into a Solana program vault. No one — including us — can redirect it.',
  },
  {
    icon: Gavel,
    title: 'Win on the board, get paid onchain',
    body: 'The server validates every move and clock tick. Checkmate triggers settlement: the program sends the full pot to the winner.',
  },
];

export function LandingPage() {
  const signedIn = useSignedIn();
  const { config } = useSession();
  const { openWallet } = useShell();
  const navigate = useNavigate();
  const enter = () => (signedIn ? navigate('/arena') : (navigate('/arena'), openWallet()));

  return (
    <div>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 grid-lines" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <Badge tone="accent" className="mb-6">
              <span className="size-1.5 rounded-full bg-win" /> Running on Solana {config?.cluster ?? 'devnet'} · test tokens only
            </Badge>
            <h1 className="text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-[68px]">
              Prove your skill.
              <br />
              <span className="bg-gradient-to-r from-[#b7adff] via-accent to-[#6d5cff] bg-clip-text text-transparent">Own your victory.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-muted">
              Head-to-head blitz chess against players at your level. Put a stake on the line, play a real game, and the result settles
              itself — straight from a Solana escrow to the winner’s wallet.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={enter}>
                Enter the Arena <ArrowRight className="size-4" />
              </Button>
              <Link to="/how-it-works">
                <Button size="lg" variant="secondary">How it works</Button>
              </Link>
            </div>
            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-line pt-6">
              {[
                { icon: Timer, k: '3+0', v: 'Blitz, server-timed' },
                { icon: Scale, k: '±150', v: 'Elo matchmaking' },
                { icon: Lock, k: '0 SOL', v: 'Gas sponsored' },
              ].map(({ icon: Icon, k, v }) => (
                <div key={v}>
                  <dt className="flex items-center gap-1.5 text-xs text-fg-subtle">
                    <Icon className="size-3.5" /> {v}
                  </dt>
                  <dd className="mt-1 font-mono text-xl font-medium tabular">{k}</dd>
                </div>
              ))}
            </dl>
          </motion.div>
          <motion.div
            className="mx-auto w-full max-w-[460px]"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <PreviewBoard />
          </motion.div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-10 max-w-2xl">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-accent">How a match works</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Three steps from queue to payout.</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-6 transition hover:border-line-strong"
            >
              <div className="flex items-center justify-between">
                <div className="grid size-10 place-items-center rounded-xl border border-line-strong bg-surface-2 text-accent">
                  <s.icon className="size-5" />
                </div>
                <span className="font-mono text-sm text-fg-subtle">0{i + 1}</span>
              </div>
              <h3 className="mt-6 text-lg font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-6">
        <div className="grid gap-10 rounded-3xl border border-line bg-gradient-to-br from-surface to-bg-raised p-8 sm:p-12 lg:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-win">Verifiable by design</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Every stake and payout is a transaction you can inspect.</h2>
            <p className="mt-4 text-fg-muted">
              The escrow is an Anchor program with a vault owned by a program-derived address. The only ways out are a result signed by the
              match adjudicator, a refund after the funding window, or a time-locked recovery — and every path pays only the two players.
            </p>
            <Link to="/how-it-works" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              Read the trust model <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <ol className="space-y-3 font-mono text-[13px]">
            {[
              ['create_match', 'Escrow + vault PDAs bound to both wallets, mint and stake', 'accent'],
              ['deposit ×2', 'Each player moves exactly one stake into the vault', 'accent'],
              ['settle', 'Adjudicator attests the verified result → pot to winner', 'win'],
              ['cancel / refund', 'Permissionless safety exits after timeouts', 'warn'],
            ].map(([ix, d, tone]) => (
              <li key={ix} className="flex items-start gap-3 rounded-xl border border-line bg-bg/60 px-4 py-3">
                <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${tone === 'win' ? 'bg-win' : tone === 'warn' ? 'bg-warn' : 'bg-accent'}`} />
                <div>
                  <div className="text-fg">{ix}</div>
                  <div className="mt-0.5 font-sans text-xs text-fg-muted">{d}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your next opponent is in the queue.</h2>
        <p className="mt-3 text-fg-muted">Free test tokens. No SOL needed. About a minute from connect to first move.</p>
        <Button size="lg" className="mt-8" onClick={enter}>
          Enter the Arena <ArrowRight className="size-4" />
        </Button>
      </section>
    </div>
  );
}
