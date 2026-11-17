import { useQuery } from '@tanstack/react-query';
import { ExternalLink, History } from 'lucide-react';
import { useParams } from 'react-router';
import { Card, CardHeader, EmptyState, PlayerAvatar, Skeleton, Stat } from '../components/ui';
import { api, type MatchHistoryItem, type PublicPlayer } from '../lib/api';
import { explorerUrl, shortAddress, winRate } from '../lib/format';
import { useSession } from '../wallet/WalletContext';
import { MatchList } from './Arena';

interface ProfileResp {
  player: PublicPlayer;
  ratingHistory: { matchId: string; after: number; delta: number; at: string }[];
}

function RatingChart({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <div className="grid h-32 place-items-center text-xs text-fg-subtle">Play a couple of games to chart your rating.</div>;
  }
  const w = 600;
  const h = 128;
  const pad = 8;
  const min = Math.min(...points) - 10;
  const max = Math.max(...points) + 10;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" role="img" aria-label={`Rating history from ${points[0]} to ${points[points.length - 1]}`}>
      <defs>
        <linearGradient id="rg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#8b7cff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8b7cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${x(points.length - 1)},${h} L${x(0)},${h} Z`} fill="url(#rg)" />
      <path d={d} fill="none" stroke="#8b7cff" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!)} r="4" fill="#8b7cff" />
    </svg>
  );
}

export function ProfilePage() {
  const { id } = useParams();
  const { config } = useSession();
  const profile = useQuery({ queryKey: ['player', id], queryFn: () => api<ProfileResp>(`/api/players/${id}`), enabled: !!id });
  const matches = useQuery({ queryKey: ['matches', id], queryFn: () => api<{ matches: MatchHistoryItem[] }>(`/api/players/${id}/matches`), enabled: !!id });

  if (profile.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-36" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!profile.data) return <div className="py-24 text-center text-fg-muted">Player not found.</div>;
  const p = profile.data.player;
  const points = [1200, ...profile.data.ratingHistory.map((h) => h.after)];
  const recentOpponents = [...new Map((matches.data?.matches ?? []).map((m) => [m.opponent.id, m.opponent])).values()].slice(0, 5);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Card className="p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <PlayerAvatar avatar={p.avatar} color={p.avatarColor} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{p.username ?? 'Unnamed player'}</h1>
            {p.bio && <p className="mt-1 text-sm text-fg-muted">{p.bio}</p>}
            <a
              href={explorerUrl('address', p.wallet, config?.cluster ?? 'devnet')}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 font-mono text-xs text-fg-subtle hover:text-accent"
            >
              {shortAddress(p.wallet, 6)} <ExternalLink className="size-3" />
            </a>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle">Rating</div>
            <div className="font-mono text-4xl font-medium tabular text-accent">{p.elo}</div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-5">
          <Stat label="Games" value={p.wins + p.losses + p.draws} />
          <Stat label="Wins" value={<span className="text-win">{p.wins}</span>} />
          <Stat label="Losses" value={<span className="text-loss">{p.losses}</span>} />
          <Stat label="Draws" value={p.draws} />
          <Stat label="Score" value={winRate(p)} />
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader eyebrow="Rating" title="Rating history" />
          <div className="p-5 pt-3">
            <RatingChart points={points} />
          </div>
        </Card>
        <Card>
          <CardHeader eyebrow="Opponents" title="Recent opponents" />
          <ul className="p-3">
            {recentOpponents.length ? (
              recentOpponents.map((o) => (
                <li key={o.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <PlayerAvatar avatar={o.avatar} color={o.avatarColor} size={26} />
                  <span className="flex-1 truncate text-sm">{o.username}</span>
                  <span className="font-mono text-xs text-fg-muted">{o.elo}</span>
                </li>
              ))
            ) : (
              <li className="px-2 py-6 text-center text-xs text-fg-subtle">No opponents yet</li>
            )}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader eyebrow="Matches" title="Match history" />
        <div className="p-2">
          {matches.data?.matches.length ? (
            <MatchList matches={matches.data.matches} />
          ) : (
            <EmptyState icon={<History className="size-5" />} title="No matches yet" />
          )}
        </div>
      </Card>
    </div>
  );
}
