import { ELO_K_FACTOR } from './constants.ts';

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** score: 1 = win, 0.5 = draw, 0 = loss. Returns the integer rating delta. */
export function eloDelta(rating: number, opponent: number, score: 0 | 0.5 | 1, k = ELO_K_FACTOR): number {
  return Math.round(k * (score - expectedScore(rating, opponent)));
}

export function eloUpdate(white: number, black: number, outcome: 'white' | 'black' | 'draw') {
  const whiteScore = outcome === 'white' ? 1 : outcome === 'draw' ? 0.5 : 0;
  const blackScore = (1 - whiteScore) as 0 | 0.5 | 1;
  const whiteDelta = eloDelta(white, black, whiteScore);
  const blackDelta = eloDelta(black, white, blackScore);
  return { whiteDelta, blackDelta, white: white + whiteDelta, black: black + blackDelta };
}

/** Rating tolerance for a queue entry that has waited `waitedMs`. */
export function ratingTolerance(
  waitedMs: number,
  cfg: { baseTolerance: number; widenStep: number; widenEveryMs: number; maxTolerance: number },
): number {
  const steps = Math.floor(Math.max(0, waitedMs) / cfg.widenEveryMs);
  return Math.min(cfg.maxTolerance, cfg.baseTolerance + steps * cfg.widenStep);
}
