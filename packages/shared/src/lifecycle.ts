export const MATCH_STATUSES = [
  'CREATED',
  'AWAITING_DEPOSITS',
  'FUNDED',
  'ACTIVE',
  'RESULT_RECORDED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

const TRANSITIONS: Record<MatchStatus, readonly MatchStatus[]> = {
  CREATED: ['AWAITING_DEPOSITS', 'CANCELLED'],
  AWAITING_DEPOSITS: ['FUNDED', 'CANCELLED'],
  FUNDED: ['ACTIVE', 'REFUNDED'],
  ACTIVE: ['RESULT_RECORDED', 'REFUNDED'],
  RESULT_RECORDED: ['SETTLEMENT_PENDING'],
  SETTLEMENT_PENDING: ['SETTLED', 'REFUNDED'],
  SETTLED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: MatchStatus, to: MatchStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid match transition ${from} -> ${to}`);
  }
}

/** Statuses during which a player is "busy" and cannot queue or join another match. */
export const OCCUPYING_STATUSES: readonly MatchStatus[] = [
  'CREATED',
  'AWAITING_DEPOSITS',
  'FUNDED',
  'ACTIVE',
];

export const TERMINAL_STATUSES: readonly MatchStatus[] = ['SETTLED', 'CANCELLED', 'REFUNDED'];

export const GAME_END_REASONS = [
  'checkmate',
  'resignation',
  'timeout',
  'stalemate',
  'threefold_repetition',
  'fifty_move_rule',
  'insufficient_material',
  'draw_agreement',
] as const;
export type GameEndReason = (typeof GAME_END_REASONS)[number];

export type Outcome = 'white' | 'black' | 'draw';
export type Color = 'white' | 'black';

export const END_REASON_LABEL: Record<GameEndReason, string> = {
  checkmate: 'Checkmate',
  resignation: 'Resignation',
  timeout: 'Time expired',
  stalemate: 'Stalemate',
  threefold_repetition: 'Threefold repetition',
  fifty_move_rule: 'Fifty-move rule',
  insufficient_material: 'Insufficient material',
  draw_agreement: 'Draw agreed',
};
