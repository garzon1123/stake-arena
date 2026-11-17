import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { Card, EmptyState, PlayerAvatar, Skeleton } from '../components/ui';
import { api, type PublicPlayer } from '../lib/api';
import { cn, winRate } from '../lib/format';
import { useSession } from '../wallet/WalletContext';

export function LeaderboardPage() {
  const { me } = useSession();
  const q = useQuery({ queryKey: ['leaderboard'], queryFn: () => api<{ players: PublicPlayer[] }>('/api/leaderboard'), refetchInterval: 15_000 });
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Leaderboard</h1>
          <p className="mt-1 text-sm text-fg-muted">Every registered player, ranked by Elo. Real accounts only — no seeded profiles.</p>
        </div>
      </div>
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !q.data?.players.length ? (
          <EmptyState icon={<Trophy className="size-5" />} title="No ranked players yet" body="Play the first rated match to claim the top spot." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.12em] text-fg-subtle">
                  <th className="w-16 px-5 py-3 font-medium">Rank</th>
                  <th className="px-2 py-3 font-medium">Player</th>
                  <th className="px-2 py-3 text-right font-medium">Elo</th>
                  <th className="px-2 py-3 text-right font-medium">W</th>
                  <th className="px-2 py-3 text-right font-medium">L</th>
                  <th className="px-2 py-3 text-right font-medium">D</th>
                  <th className="px-5 py-3 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {q.data.players.map((p, i) => (
                  <tr key={p.id} className={cn('border-b border-line/60 transition hover:bg-white/[0.02]', me?.player.id === p.id && 'bg-accent-soft/50')}>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          'grid size-7 place-items-center rounded-lg font-mono text-xs font-semibold',
                          i === 0 ? 'bg-warn-soft text-warn' : i < 3 ? 'bg-white/[0.06] text-fg' : 'text-fg-subtle',
                        )}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      <Link to={`/players/${p.id}`} className="flex items-center gap-3 hover:underline">
                        <PlayerAvatar avatar={p.avatar} color={p.avatarColor} size={30} />
                        <span className="font-medium">{p.username}</span>
                        {me?.player.id === p.id && <span className="text-xs text-accent">you</span>}
                      </Link>
                    </td>
                    <td className="px-2 py-3 text-right font-mono font-medium tabular">{p.elo}</td>
                    <td className="px-2 py-3 text-right font-mono tabular text-win">{p.wins}</td>
                    <td className="px-2 py-3 text-right font-mono tabular text-loss">{p.losses}</td>
                    <td className="px-2 py-3 text-right font-mono tabular text-fg-muted">{p.draws}</td>
                    <td className="px-5 py-3 text-right font-mono tabular">{winRate(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
