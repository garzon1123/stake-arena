import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Droplets, History, Info, Radar, Swords, Wallet, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  MATCHMAKING,
  STAKE_TIERS,
  TIME_CONTROLS,
  formatTokenAmount,
  ratingTolerance,
  toBaseUnits,
  type StakeTierId,
  type TimeControlId,
} from '@stake-arena/shared';
import { useShell } from '../components/AppShell';
import { Badge, Button, Card, CardHeader, EmptyState, PlayerAvatar, Segmented, Skeleton, Stat } from '../components/ui';
import { api, type MatchHistoryItem } from '../lib/api';
import { cn, timeAgo, winRate } from '../lib/format';
import { useBalance, useNow, useQueueStatus, useSignedIn } from '../lib/hooks';
import { getSocket } from '../lib/socket';
import { useSession } from '../wallet/WalletContext';

function SignInGate() {
  const { openWallet } = useShell();
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-line-strong bg-surface text-accent">
        <Wallet className="size-6" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Connect to enter the Arena</h1>
      <p className="mt-2 text-fg-muted">Your Solana wallet is your player identity. Connecting is free and nothing is sent onchain until you choose to stake.</p>
      <Button size="lg" className="mt-8" onClick={openWallet}>
        <Wallet className="size-4" /> Connect wallet
      </Button>
    </div>
  );
}

function BalanceCard() {
  const { config } = useSession();
  const balance = useBalance();
  const qc = useQueryClient();
  const faucet = useMutation({
    mutationFn: () => api<{ signature: string }>('/api/faucet', { body: {} }),
    onSuccess: () => {
      toast.success(`${config?.faucetAmount ?? 100} TEST minted to your wallet`, { description: 'Valueless devnet test tokens.' });
      void qc.invalidateQueries({ queryKey: ['balance'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const low = balance.data && BigInt(balance.data.token) < toBaseUnits(25);
  return (
    <div className="rounded-xl border border-line bg-bg/50 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">Test-token balance</div>
          <div className="mt-1 font-mono text-2xl font-medium tabular">
            {balance.isLoading ? <Skeleton className="h-7 w-24" /> : `${formatTokenAmount(balance.data?.token ?? '0')}`}
            <span className="ml-1.5 text-sm text-fg-muted">TEST</span>
          </div>
        </div>
        <Button size="sm" variant={low ? 'primary' : 'secondary'} loading={faucet.isPending} onClick={() => faucet.mutate()}>
          <Droplets className="size-3.5" /> Faucet
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">Free, valueless devnet token. Network fees are sponsored — you never need SOL.</p>
    </div>
  );
}

function ProfileCard() {
  const { me } = useSession();
  if (!me) return null;
  const p = me.player;
  const games = p.wins + p.losses + p.draws;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3.5">
        <PlayerAvatar avatar={p.avatar} color={p.avatarColor} size={52} />
        <div className="min-w-0">
          <Link to={`/players/${p.id}`} className="block truncate text-lg font-semibold tracking-tight hover:underline">
            {p.username ?? 'New player'}
          </Link>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="font-mono text-sm text-accent tabular">{p.elo}</span>
            <span className="text-xs text-fg-subtle">Elo · {games} games</span>
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-4 gap-3 border-t border-line pt-4">
        <Stat label="Wins" value={<span className="text-win">{p.wins}</span>} />
        <Stat label="Losses" value={<span className="text-loss">{p.losses}</span>} />
        <Stat label="Draws" value={p.draws} />
        <Stat label="Score" value={winRate(p)} />
      </div>
      <div className="mt-5">
        <BalanceCard />
      </div>
    </Card>
  );
}

function QuickPlay() {
  const { me } = useSession();
  const balance = useBalance();
  const navigate = useNavigate();
  const [tier, setTier] = useState<StakeTierId>('tier_10');
  const [tc, setTc] = useState<TimeControlId>('blitz_3_0');
  const [queue, setQueue] = useQueueStatus();
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);

  useEffect(() => {
    const s = getSocket();
    const onFound = ({ matchId }: { matchId: string }) => {
      toast.success('Opponent found', { description: 'Opening the match escrow on Solana…' });
      navigate(`/match/${matchId}`);
    };
    s.on('match:found', onFound);
    return () => void s.off('match:found', onFound);
  }, [navigate]);

  const stake = STAKE_TIERS.find((t) => t.id === tier)!;
  const elo = me?.player.elo ?? 1200;
  const insufficient = balance.data ? BigInt(balance.data.token) < toBaseUnits(stake.amount) : false;
  const waitedMs = queue.inQueue && queue.joinedAt ? now - queue.joinedAt : 0;
  const tol = queue.inQueue ? ratingTolerance(waitedMs, MATCHMAKING) : MATCHMAKING.baseTolerance;

  const join = () => {
    setBusy(true);
    getSocket().emit('queue:join', { stakeTier: tier, timeControl: tc }, (r) => {
      setBusy(false);
      if (r.ok) setQueue(r.status);
      else toast.error(r.error);
    });
  };
  const leave = () => {
    getSocket().emit('queue:leave', (r) => {
      if (r.ok) setQueue({ inQueue: false });
    });
  };

  if (me?.activeMatchId) {
    return (
      <Card className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
        <div className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">
          <Swords className="size-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">You have a match in progress</div>
          <div className="text-sm text-fg-muted">Your clock may be running. Jump back in.</div>
        </div>
        <Button onClick={() => navigate(`/match/${me.activeMatchId}`)}>
          Return to match <ArrowRight className="size-4" />
        </Button>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader eyebrow="Quick play" title="Find a rated match" />
      <AnimatePresence mode="wait" initial={false}>
        {!queue.inQueue ? (
          <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6 p-5">
            <div>
              <div className="mb-2 text-xs font-medium text-fg-muted">Stake</div>
              <Segmented
                label="Stake tier"
                value={tier}
                onChange={setTier}
                options={STAKE_TIERS.map((t) => ({ value: t.id, label: `${t.amount} TEST`, sub: `Win ${t.amount * 2} TEST` }))}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-fg-muted">Time control</div>
              <Segmented
                label="Time control"
                value={tc}
                onChange={setTc}
                options={TIME_CONTROLS.map((t) => ({
                  value: t.id,
                  label: t.label.split(' ')[0],
                  sub: t.demo ? 'Short demo mode' : 'Blitz · no increment',
                }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-bg/50 p-4 sm:grid-cols-4">
              <Stat label="Your stake" value={`${stake.amount}`} hint="TEST into escrow" />
              <Stat label="Winner payout" value={<span className="text-win">{stake.amount * 2}</span>} hint="Entire pot" />
              <Stat label="Draw" value={`${stake.amount}`} hint="Stake returned" />
              <Stat label="Opponents" value={`${elo - tol}–${elo + tol}`} hint="Elo range" />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button size="lg" className="sm:min-w-56" onClick={join} loading={busy} disabled={insufficient}>
                <Radar className="size-4" /> Find opponent
              </Button>
              {insufficient ? (
                <span className="text-sm text-warn">Not enough TEST for this tier — use the faucet.</span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
                  <Info className="size-3.5" /> You’ll approve one deposit in your wallet once matched.
                </span>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div key="queue" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-5">
            <div className="flex flex-col items-center gap-6 rounded-xl border border-line bg-bg/50 px-6 py-10 text-center">
              <div className="relative grid size-24 place-items-center">
                <div className="absolute inset-0 rounded-full border border-accent/20" />
                <div className="absolute inset-3 rounded-full border border-accent/30" />
                <div className="absolute inset-0 animate-scan rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgb(139_124_255/0.45)_60deg,transparent_90deg)]" />
                <Radar className="relative size-7 text-accent" />
              </div>
              <div>
                <div className="text-lg font-semibold">Searching for an opponent</div>
                <div className="mt-1 text-sm text-fg-muted">
                  {STAKE_TIERS.find((t) => t.id === queue.stakeTier)?.label} · {TIME_CONTROLS.find((t) => t.id === queue.timeControl)?.label}
                </div>
              </div>
              <div className="grid w-full max-w-md grid-cols-3 gap-4">
                <Stat label="Waiting" value={`${Math.floor(waitedMs / 1000)}s`} />
                <Stat label="Elo range" value={`±${tol}`} hint={tol > MATCHMAKING.baseTolerance ? 'widening' : undefined} />
                <Stat label="In this queue" value={queue.waitingInTier ?? 1} hint="incl. you" />
              </div>
              <Button variant="secondary" onClick={leave}>
                <X className="size-4" /> Cancel search
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function RecentMatches({ playerId }: { playerId: string }) {
  const q = useQuery({
    queryKey: ['matches', playerId],
    queryFn: () => api<{ matches: MatchHistoryItem[] }>(`/api/players/${playerId}/matches`),
  });
  return (
    <Card>
      <CardHeader
        eyebrow="History"
        title="Recent matches"
        action={
          <Link to={`/players/${playerId}`} className="text-xs text-fg-muted hover:text-fg">
            View all
          </Link>
        }
      />
      <div className="p-2">
        {q.isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : q.data?.matches.length ? (
          <MatchList matches={q.data.matches.slice(0, 6)} />
        ) : (
          <EmptyState icon={<History className="size-5" />} title="No matches yet" body="Your games, results and settlement receipts will show up here." />
        )}
      </div>
    </Card>
  );
}

export function MatchList({ matches }: { matches: MatchHistoryItem[] }) {
  return (
    <ul className="divide-y divide-line">
      {matches.map((m) => (
        <li key={m.id}>
          <Link to={`/match/${m.id}`} className="flex items-center gap-3 rounded-lg px-3 py-3 transition hover:bg-white/[0.03]">
            <span
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-lg font-mono text-xs font-semibold',
                m.result === 'win' ? 'bg-win-soft text-win' : m.result === 'loss' ? 'bg-loss-soft text-loss' : 'bg-white/5 text-fg-muted',
              )}
            >
              {m.result === 'win' ? 'W' : m.result === 'loss' ? 'L' : m.result === 'draw' ? 'D' : '·'}
            </span>
            <PlayerAvatar avatar={m.opponent.avatar} color={m.opponent.avatarColor} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">vs {m.opponent.username ?? 'player'}</div>
              <div className="text-xs text-fg-subtle">
                {formatTokenAmount(m.stakeBaseUnits)} TEST · {m.reason ? m.reason.replace(/_/g, ' ') : m.status.toLowerCase().replace(/_/g, ' ')} · {timeAgo(m.createdAt)}
              </div>
            </div>
            {m.ratingDelta !== null && (
              <span className={cn('font-mono text-sm tabular', m.ratingDelta > 0 ? 'text-win' : m.ratingDelta < 0 ? 'text-loss' : 'text-fg-muted')}>
                {m.ratingDelta > 0 ? '+' : ''}
                {m.ratingDelta}
              </span>
            )}
            {m.status === 'CANCELLED' && <Badge>Cancelled</Badge>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ArenaPage() {
  const signedIn = useSignedIn();
  const { me, meLoading } = useSession();
  if (meLoading) {
    return (
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[360px_1fr]">
        <Skeleton className="h-80" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!signedIn || !me) return <SignInGate />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Arena</h1>
        <p className="mt-1 text-sm text-fg-muted">Choose your stake, get matched, play.</p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <ProfileCard />
        </div>
        <div className="space-y-6">
          <QuickPlay />
          <RecentMatches playerId={me.player.id} />
        </div>
      </div>
    </div>
  );
}
