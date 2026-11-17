import type { MatchSnapshot, PublicPlayer, QueueStatus } from '@stake-arena/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    credentials: 'include',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; code?: string };
    throw new ApiError(j.error ?? `Request failed (${res.status})`, res.status, j.code);
  }
  return json as T;
}

export interface AppConfig {
  cluster: 'devnet' | 'localnet';
  rpcUrl: string;
  programId: string;
  mint: string;
  adjudicator: string;
  token: { symbol: string; decimals: number };
  faucetAmount: number;
  demoMode: true;
}

export interface Me {
  player: PublicPlayer;
  activeMatchId: string | null;
  queue: QueueStatus;
}

export interface MatchHistoryItem {
  id: string;
  status: string;
  stakeTier: string;
  stakeBaseUnits: string;
  timeControl: string;
  color: 'white' | 'black';
  opponent: PublicPlayer;
  result: 'win' | 'loss' | 'draw' | null;
  reason: string | null;
  ratingDelta: number | null;
  settlementSignature: string | null;
  createdAt: string;
}

export type { MatchSnapshot, PublicPlayer, QueueStatus };
