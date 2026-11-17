import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatTokenAmount } from '@stake-arena/shared';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const shortAddress = (a: string, n = 4) => (a.length > 2 * n + 2 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

export const tokens = (base: string | bigint) => formatTokenAmount(base);

export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSec = Math.floor(clamped / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (clamped < 10_000) return `${m}:${String(s).padStart(2, '0')}.${Math.floor((clamped % 1000) / 100)}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function winRate(p: { wins: number; losses: number; draws: number }): string {
  const games = p.wins + p.losses + p.draws;
  if (!games) return '—';
  return `${Math.round(((p.wins + p.draws * 0.5) / games) * 100)}%`;
}

export function explorerUrl(kind: 'tx' | 'address', value: string, cluster: string): string {
  const q =
    cluster === 'localnet'
      ? `?cluster=custom&customUrl=${encodeURIComponent('http://localhost:8899')}`
      : `?cluster=${cluster}`;
  return `https://explorer.solana.com/${kind}/${value}${q}`;
}

export function timeAgo(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
