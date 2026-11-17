import { useQueryClient } from '@tanstack/react-query';
import { Chess } from 'chess.js';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  Flag,
  Handshake,
  History,
  Loader2,
  Lock,
  RotateCw,
  Trophy,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { END_REASON_LABEL, formatTokenAmount, TIME_CONTROLS, type Color, type MatchSnapshot, type PublicPlayer } from '@stake-arena/shared';
import { useShell } from '../components/AppShell';
import { Board } from '../components/Board';
import { Badge, Button, Card, PlayerAvatar, Skeleton, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { cn, explorerUrl, formatClock, shortAddress } from '../lib/format';
import { useMatch, useNow } from '../lib/hooks';
import { getSocket } from '../lib/socket';
import { useSession, useWallet } from '../wallet/WalletContext';

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

function TxLink({ sig, label }: { sig: string; label?: string }) {
  const { config } = useSession();
  return (
    <a
      href={explorerUrl('tx', sig, config?.cluster ?? 'devnet')}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline"
    >
      {label ?? shortAddress(sig, 6)} <ExternalLink className="size-3" />
    </a>
  );
}

// ───────────────────────── Funding

function DepositButton({ snap, myColor }: { snap: MatchSnapshot; myColor: Color }) {
  const { account, signTransaction, wallet } = useWallet();
  const { me } = useSession();
  const { openWallet } = useShell();
  const qc = useQueryClient();
  const [stage, setStage] = useState<'idle' | 'preparing' | 'signing' | 'confirming'>('idle');
  const stake = formatTokenAmount(snap.stakeBaseUnits);
  const mine = snap.deposits.find((d) => d.color === myColor)!;

  if (mine.status === 'confirmed') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-win/25 bg-win-soft px-4 py-3 text-sm text-win">
        <Check className="size-4" /> Your {stake} TEST is locked in escrow. Waiting for your opponent.
      </div>
    );
  }
  if (!account || account.address !== me?.player.wallet) {
    return (
      <Button size="lg" className="w-full" onClick={openWallet}>
        Connect {shortAddress(me?.player.wallet ?? '')} to deposit
      </Button>
    );
  }

  const deposit = async () => {
    if (!signTransaction) return;
    try {
      setStage('preparing');
      const { transaction } = await api<{ transaction: string }>(`/api/matches/${snap.id}/deposit/prepare`, { body: {} });
      setStage('signing');
      let signed: Uint8Array;
      try {
        signed = await signTransaction(b64ToBytes(transaction));
      } catch (e) {
        toast.message('Deposit not signed', { description: 'You declined the request in your wallet. Nothing was sent.' });
        void e;
        return;
      }
      setStage('confirming');
      const r = await api<{ signature: string }>(`/api/matches/${snap.id}/deposit/submit`, { body: { transaction: bytesToB64(signed) } });
      toast.success(`${stake} TEST deposited to escrow`, { description: `Confirmed onchain · ${shortAddress(r.signature, 6)}` });
      void qc.invalidateQueries({ queryKey: ['balance'] });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'expired') toast.error('That request expired', { description: 'Blockhashes are short-lived. Please sign again.' });
      else if (err.code === 'pending') toast.message('Deposit sent — waiting for the escrow to reflect it', { description: err.message });
      else toast.error('Deposit failed', { description: err.message });
    } finally {
      setStage('idle');
    }
  };

  const label =
    stage === 'preparing'
      ? 'Preparing transaction…'
      : stage === 'signing'
        ? `Approve in ${wallet?.name ?? 'your wallet'}…`
        : stage === 'confirming'
          ? 'Confirming on Solana…'
          : `Deposit ${stake} TEST`;
  return (
    <div>
      <Button size="lg" className="w-full" onClick={deposit} loading={stage !== 'idle'} disabled={mine.status === 'pending'}>
        {stage === 'idle' && <Lock className="size-4" />} {mine.status === 'pending' && stage === 'idle' ? 'Deposit pending confirmation…' : label}
      </Button>
      <p className="mt-2 text-center text-xs text-fg-subtle">
        One signature. The transfer goes into a program-owned vault, never to a person. Network fee sponsored.
      </p>
    </div>
  );
}

function FundingSeat({ player, deposit, label }: { player: PublicPlayer; deposit: MatchSnapshot['deposits'][number]; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-bg/50 p-4">
      <PlayerAvatar avatar={player.avatar} color={player.avatarColor} size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{player.username}</div>
        <div className="text-xs text-fg-subtle">
          {label} · <span className="font-mono">{player.elo}</span>
        </div>
      </div>
      {deposit.status === 'confirmed' ? (
        <Badge tone="win">
          <Check className="size-3" /> Funded
        </Badge>
      ) : deposit.status === 'pending' ? (
        <Badge tone="warn" dot>
          Confirming
        </Badge>
      ) : (
        <Badge>Awaiting deposit</Badge>
      )}
    </div>
  );
}

function FundingView({ snap, myColor }: { snap: MatchSnapshot; myColor: Color | null }) {
  const { config } = useSession();
  const now = useNow(500);
  const left = Math.max(0, new Date(snap.fundingDeadline).getTime() - now);
  const stake = formatTokenAmount(snap.stakeBaseUnits);
  const pot = formatTokenAmount(BigInt(snap.stakeBaseUnits) * 2n);
  const opening = snap.status === 'CREATED';
  const confirmed = snap.deposits.filter((d) => d.status === 'confirmed').length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="text-center">
        <Badge tone="accent" className="mb-4">
          Match found · {TIME_CONTROLS.find((t) => t.id === snap.timeControl)?.label}
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Fund the match</h1>
        <p className="mx-auto mt-2 max-w-md text-fg-muted">
          Both players lock {stake} TEST into the match escrow. The board unlocks the moment both deposits are confirmed onchain.
        </p>
      </div>

      <Card className="mt-8 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">Prize pool</div>
            <div className="mt-0.5 font-mono text-2xl font-medium tabular">
              {pot} <span className="text-sm text-fg-muted">TEST</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">Funding window</div>
            <div className={cn('mt-0.5 font-mono text-2xl font-medium tabular', left < 30_000 && 'text-warn')}>{opening ? '—' : formatClock(left)}</div>
          </div>
        </div>
        <div className="h-1 bg-surface-2">
          <motion.div className="h-full bg-gradient-to-r from-accent to-win" animate={{ width: `${(confirmed / 2) * 100}%` }} />
        </div>
        <div className="space-y-3 p-5">
          <FundingSeat player={snap.white} deposit={snap.deposits[0]!} label="White" />
          <FundingSeat player={snap.black} deposit={snap.deposits[1]!} label="Black" />
        </div>
        <div className="border-t border-line p-5">
          {opening ? (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-fg-muted">
              <Spinner /> Opening the escrow account on Solana…
            </div>
          ) : myColor ? (
            <DepositButton snap={snap} myColor={myColor} />
          ) : (
            <div className="text-center text-sm text-fg-muted">Spectating · waiting for both players to fund.</div>
          )}
        </div>
      </Card>

      <dl className="mt-6 grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface/60 px-4 py-3">
          <dt className="text-fg-subtle">Escrow account</dt>
          <dd className="mt-1">
            <a className="inline-flex items-center gap-1 font-mono text-accent hover:underline" href={explorerUrl('address', snap.escrowAddress, config?.cluster ?? 'devnet')} target="_blank" rel="noreferrer">
              {shortAddress(snap.escrowAddress, 6)} <ExternalLink className="size-3" />
            </a>
          </dd>
        </div>
        <div className="rounded-xl border border-line bg-surface/60 px-4 py-3">
          <dt className="text-fg-subtle">If funding doesn’t complete</dt>
          <dd className="mt-1 text-fg-muted">The match is cancelled and any deposit is refunded by the program.</dd>
        </div>
      </dl>
    </div>
  );
}

// ───────────────────────── Live game

function Clock({ ms, running, low }: { ms: number; running: boolean; low: boolean }) {
  return (
    <div
      className={cn(
        'min-w-[92px] rounded-lg px-3 py-1.5 text-right font-mono text-xl font-medium tabular transition-colors',
        running ? (low ? 'bg-loss text-white' : 'bg-fg text-bg') : 'bg-surface-2 text-fg-muted',
      )}
      role="timer"
      aria-live="off"
    >
      {formatClock(ms)}
    </div>
  );
}

function PlayerBar({
  player,
  color,
  ms,
  running,
  online,
  isYou,
  delta,
}: {
  player: PublicPlayer;
  color: Color;
  ms: number;
  running: boolean;
  online: boolean;
  isYou: boolean;
  delta?: number | null;
}) {
  return (
    <div className={cn('flex items-center gap-3 rounded-xl px-2 py-2 transition', running && 'bg-white/[0.03]')}>
      <div className="relative">
        <PlayerAvatar avatar={player.avatar} color={player.avatarColor} size={38} />
        <span className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-bg', online ? 'bg-win' : 'bg-fg-subtle')} title={online ? 'Connected' : 'Disconnected'} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link to={`/players/${player.id}`} className="truncate text-sm font-medium hover:underline">
            {player.username}
          </Link>
          {isYou && <Badge tone="accent">You</Badge>}
          <span className={cn('size-2.5 rounded-sm ring-1 ring-white/20', color === 'white' ? 'bg-[#eee]' : 'bg-[#222]')} aria-label={color} />
        </div>
        <div className="font-mono text-xs text-fg-muted tabular">
          {player.elo}
          {delta != null && (
            <span className={cn('ml-1.5', delta > 0 ? 'text-win' : delta < 0 ? 'text-loss' : '')}>
              {delta > 0 ? '+' : ''}
              {delta}
            </span>
          )}
        </div>
      </div>
      <Clock ms={ms} running={running} low={ms < 20_000} />
    </div>
  );
}

function MoveList({ moves }: { moves: MatchSnapshot['moves'] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [moves.length]);
  const rows: { n: number; w?: string; b?: string }[] = [];
  for (const m of moves) {
    const n = Math.ceil(m.ply / 2);
    if (m.color === 'white') rows.push({ n, w: m.san });
    else if (rows.length && rows[rows.length - 1]!.n === n) rows[rows.length - 1]!.b = m.san;
    else rows.push({ n, b: m.san });
  }
  return (
    <div ref={ref} className="max-h-64 min-h-32 overflow-y-auto font-mono text-[13px] lg:max-h-none lg:flex-1" aria-label="Move history">
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center font-sans text-xs text-fg-subtle">White to move. Clocks are running.</div>
      ) : (
        <table className="w-full">
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.n} className={i % 2 ? 'bg-white/[0.02]' : ''}>
                <td className="w-10 py-1 pl-4 text-fg-subtle">{r.n}.</td>
                <td className={cn('py-1', i === rows.length - 1 && !r.b && 'text-accent')}>{r.w ?? '…'}</td>
                <td className={cn('py-1', i === rows.length - 1 && r.b && 'text-accent')}>{r.b ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ResultPanel({ snap, myColor }: { snap: MatchSnapshot; myColor: Color | null }) {
  const navigate = useNavigate();
  const { me } = useSession();
  const pot = formatTokenAmount(BigInt(snap.stakeBaseUnits) * 2n);
  const stake = formatTokenAmount(snap.stakeBaseUnits);
  const won = myColor && snap.outcome === myColor;
  const draw = snap.outcome === 'draw';
  const title = !myColor
    ? draw
      ? 'Draw'
      : `${snap.outcome === 'white' ? snap.white.username : snap.black.username} wins`
    : draw
      ? 'Draw'
      : won
        ? 'Victory'
        : 'Defeat';
  const delta = myColor && snap.ratingChange ? snap.ratingChange[myColor] : null;
  const settled = snap.status === 'SETTLED';
  const refunded = snap.status === 'REFUNDED';
  const [retrying, setRetrying] = useState(false);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className={cn('rounded-xl border p-5', won ? 'border-win/30 bg-win-soft' : draw || !myColor ? 'border-line-strong bg-surface-2' : 'border-loss/25 bg-loss-soft')}>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-fg-muted">
          {won ? <Trophy className="size-3.5 text-win" /> : <Flag className="size-3.5" />}
          {snap.endReason ? END_REASON_LABEL[snap.endReason] : 'Game over'}
        </div>
        <div className={cn('mt-1 text-3xl font-semibold tracking-tight', won ? 'text-win' : !draw && myColor ? 'text-loss' : '')}>{title}</div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle">Rating</div>
            <div className="font-mono text-lg tabular">
              {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}`}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle">Payout</div>
            <div className="font-mono text-lg tabular">
              {myColor ? (draw ? `${stake} back` : won ? `+${pot}` : `−${stake}`) : draw ? 'Refund' : `${pot} TEST`}
              {myColor && <span className="ml-1 text-xs text-fg-muted">TEST</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-bg/50 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Onchain settlement</span>
          {settled ? (
            <Badge tone="win">
              <Check className="size-3" /> Confirmed
            </Badge>
          ) : refunded ? (
            <Badge tone="warn">Refunded</Badge>
          ) : (
            <Badge tone="warn" dot>
              Settlement pending
            </Badge>
          )}
        </div>
        <p className="mt-2 text-xs text-fg-muted">
          {settled
            ? draw
              ? 'The escrow returned each stake to its owner.'
              : 'The escrow program transferred the full pot to the winner.'
            : refunded
              ? 'The escrow was refunded to both players.'
              : 'Result recorded. Submitting the settle instruction to Solana — payouts are only shown once confirmed.'}
        </p>
        {snap.settlementSignature && (
          <div className="mt-3">
            <TxLink sig={snap.settlementSignature} label="View settlement on Explorer" />
          </div>
        )}
        {snap.settlementError && !settled && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-warn-soft p-2.5 text-xs text-warn">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <div className="flex-1">
              Retrying automatically. Last error: {snap.settlementError.slice(0, 140)}
              <button
                className="ml-2 inline-flex items-center gap-1 font-medium underline"
                disabled={retrying}
                onClick={async () => {
                  setRetrying(true);
                  await api(`/api/matches/${snap.id}/settlement/retry`, { body: {} }).catch(() => {});
                  setTimeout(() => setRetrying(false), 2000);
                }}
              >
                <RotateCw className="size-3" /> Retry now
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => navigate('/arena')}>
          Play again <ArrowRight className="size-4" />
        </Button>
        <Button variant="secondary" onClick={() => navigate(me ? `/players/${me.player.id}` : '/leaderboard')}>
          <History className="size-4" /> History
        </Button>
        <Button variant="ghost" className="col-span-2" onClick={() => navigate('/leaderboard')}>
          View leaderboard
        </Button>
      </div>
    </motion.div>
  );
}

function GameView({ snap, myColor, connected, skew }: ReturnType<typeof useMatch> & { snap: MatchSnapshot; myColor: Color | null }) {
  const { config } = useSession();
  const now = useNow(100);
  const [pendingFen, setPendingFen] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const live = snap.status === 'ACTIVE';
  const orientation: Color = myColor ?? 'white';
  const opp: Color = orientation === 'white' ? 'black' : 'white';
  const serverNow = now + skew.current;

  useEffect(() => setPendingFen(null), [snap.moves.length, snap.status]);
  useEffect(() => {
    if (!confirmResign) return;
    const id = setTimeout(() => setConfirmResign(false), 3000);
    return () => clearTimeout(id);
  }, [confirmResign]);

  const remaining = (c: Color) => {
    const base = c === 'white' ? snap.whiteMs : snap.blackMs;
    if (!live || snap.turn !== c || !snap.turnStartedAt) return base;
    return base - (serverNow - snap.turnStartedAt);
  };

  const lastMove = snap.moves.length ? snap.moves[snap.moves.length - 1]! : null;
  const pot = formatTokenAmount(BigInt(snap.stakeBaseUnits) * 2n);

  const onMove = (from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n') => {
    const c = new Chess(snap.fen);
    try {
      c.move({ from, to, promotion });
    } catch {
      return false;
    }
    setPendingFen(c.fen());
    getSocket().emit('match:move', { matchId: snap.id, ply: snap.moves.length, from, to, promotion }, (r) => {
      if (!r.ok) {
        setPendingFen(null);
        toast.error(r.error);
      }
    });
    return true;
  };

  const act = (event: 'match:resign' | 'match:offerDraw') =>
    getSocket().emit(event, { matchId: snap.id }, (r) => !r.ok && toast.error(r.error));
  const respondDraw = (accept: boolean) =>
    getSocket().emit('match:respondDraw', { matchId: snap.id, accept }, (r) => !r.ok && toast.error(r.error));

  const players = { white: snap.white, black: snap.black };
  const turnLabel = live ? (myColor ? (snap.turn === myColor ? 'Your move' : 'Opponent’s move') : `${snap.turn === 'white' ? 'White' : 'Black'} to move`) : 'Game over';

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-8">
      <div className="mx-auto w-full max-w-[max(300px,min(680px,calc(100dvh-290px)))] min-w-0 lg:max-w-[max(360px,min(720px,calc(100dvh-280px)))]">
        <PlayerBar
          player={players[opp]}
          color={opp}
          ms={remaining(opp)}
          running={live && snap.turn === opp}
          online={snap.connected[opp]}
          isYou={false}
          delta={snap.ratingChange?.[opp]}
        />
        <div className="relative my-2">
          <Board
            fen={pendingFen ?? snap.fen}
            orientation={orientation}
            myColor={myColor ?? undefined}
            interactive={live && !!myColor && !pendingFen}
            lastMove={lastMove}
            onMove={onMove}
          />
          <AnimatePresence>
            {!live && snap.outcome && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-bg/45 backdrop-blur-[2px]"
              >
                <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="rounded-2xl border border-line-strong bg-bg-raised/95 px-8 py-5 text-center shadow-2xl">
                  <div className="text-xs uppercase tracking-[0.14em] text-fg-muted">{snap.endReason ? END_REASON_LABEL[snap.endReason] : ''}</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {snap.outcome === 'draw' ? '½ – ½' : snap.outcome === 'white' ? '1 – 0' : '0 – 1'}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <PlayerBar
          player={players[orientation]}
          color={orientation}
          ms={remaining(orientation)}
          running={live && snap.turn === orientation}
          online={snap.connected[orientation]}
          isYou={!!myColor}
          delta={snap.ratingChange?.[orientation]}
        />
      </div>

      <aside className="flex flex-col gap-4 lg:max-h-[calc(100dvh-140px)]">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">Prize pool</div>
              <div className="mt-0.5 font-mono text-2xl font-medium tabular">
                {pot} <span className="text-sm text-fg-muted">TEST</span>
              </div>
            </div>
            <div className="text-right">
              <Badge tone={live ? 'win' : 'neutral'} dot={live}>
                {live ? 'Live' : snap.status.replace(/_/g, ' ').toLowerCase()}
              </Badge>
              <div className="mt-1.5 flex items-center justify-end gap-1 text-[11px] text-fg-subtle">
                {connected ? <Wifi className="size-3 text-win" /> : <WifiOff className="size-3 text-loss" />}
                {connected ? 'Connected' : 'Reconnecting…'}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-xs text-fg-muted">
            <Lock className="size-3.5 text-accent" /> Escrowed in
            <a
              className="font-mono text-accent hover:underline"
              href={explorerUrl('address', snap.escrowAddress, config?.cluster ?? 'devnet')}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddress(snap.escrowAddress)}
            </a>
          </div>
        </Card>

        {live || snap.status === 'RESULT_RECORDED' ? (
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className={cn('text-sm font-medium', myColor && snap.turn === myColor && live && 'text-accent')}>{turnLabel}</span>
              <span className="text-xs text-fg-subtle">{TIME_CONTROLS.find((t) => t.id === snap.timeControl)?.label}</span>
            </div>
            <MoveList moves={snap.moves} />
            {snap.drawOfferBy && myColor && snap.drawOfferBy !== myColor && live && (
              <div className="flex items-center gap-2 border-t border-line bg-accent-soft px-4 py-3 text-sm">
                <Handshake className="size-4 text-accent" />
                <span className="flex-1">Opponent offers a draw</span>
                <Button size="sm" variant="secondary" onClick={() => respondDraw(false)}>
                  Decline
                </Button>
                <Button size="sm" onClick={() => respondDraw(true)}>
                  Accept
                </Button>
              </div>
            )}
            {myColor && live && (
              <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
                <Button size="sm" variant="secondary" disabled={snap.drawOfferBy === myColor} onClick={() => act('match:offerDraw')}>
                  <Handshake className="size-3.5" /> {snap.drawOfferBy === myColor ? 'Draw offered' : 'Offer draw'}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => (confirmResign ? (setConfirmResign(false), act('match:resign')) : setConfirmResign(true))}
                >
                  <Flag className="size-3.5" /> {confirmResign ? 'Confirm resign' : 'Resign'}
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <>
            <ResultPanel snap={snap} myColor={myColor} />
            <Card className="overflow-hidden">
              <div className="border-b border-line px-4 py-2.5 text-xs font-medium text-fg-muted">Moves</div>
              <MoveList moves={snap.moves} />
            </Card>
          </>
        )}
        {live && myColor && (
          <p className="px-1 text-[11px] leading-relaxed text-fg-subtle">
            Moves are validated and timed by the server. If you disconnect, your clock keeps running — reconnecting resumes the same game.
          </p>
        )}
      </aside>
    </div>
  );
}

function CancelledView({ snap }: { snap: MatchSnapshot }) {
  const navigate = useNavigate();
  const anyDeposit = snap.deposits.some((d) => d.status !== 'none');
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-line-strong bg-surface text-fg-muted">
        <CircleAlert className="size-6" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Match cancelled</h1>
      <p className="mt-2 text-fg-muted">
        {anyDeposit
          ? 'Funding didn’t complete in time. The escrow program returns every deposit to the wallet it came from.'
          : 'Funding didn’t complete in time. No funds were moved.'}
      </p>
      {snap.refundSignature ? (
        <div className="mt-4">
          <TxLink sig={snap.refundSignature} label="View refund / close transaction" />
        </div>
      ) : anyDeposit ? (
        <div className="mt-4 inline-flex items-center gap-2 text-sm text-warn">
          <Loader2 className="size-4 animate-spin" /> Refund pending onchain…
        </div>
      ) : null}
      <Button className="mt-8" onClick={() => navigate('/arena')}>
        Back to the Arena
      </Button>
    </div>
  );
}

export function MatchPage() {
  const { id } = useParams();
  const m = useMatch(id);
  const { me } = useSession();
  const myColor = useMemo<Color | null>(() => {
    if (!m.snap || !me) return null;
    return m.snap.white.id === me.player.id ? 'white' : m.snap.black.id === me.player.id ? 'black' : null;
  }, [m.snap, me]);

  if (m.error && !m.snap) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">Match unavailable</h1>
        <p className="mt-2 text-fg-muted">{m.error}</p>
        <Link to="/arena" className="mt-6 inline-block text-accent hover:underline">
          Back to the Arena
        </Link>
      </div>
    );
  }
  if (!m.snap) {
    return (
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="mx-auto aspect-square w-full max-w-[680px]" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  const s = m.snap;
  if (s.status === 'CREATED' || s.status === 'AWAITING_DEPOSITS' || s.status === 'FUNDED') return <FundingView snap={s} myColor={myColor} />;
  if (s.status === 'CANCELLED') return <CancelledView snap={s} />;
  return <GameView {...m} snap={s} myColor={myColor} />;
}
