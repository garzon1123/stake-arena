/** Token amounts are expressed in base units (6 decimals) as decimal strings over the wire. */
export const TOKEN_DECIMALS = 6;
export const TOKEN_SYMBOL = 'TEST';

export const STAKE_TIERS = [
  { id: 'tier_5', amount: 5, label: '5 TEST' },
  { id: 'tier_10', amount: 10, label: '10 TEST' },
  { id: 'tier_25', amount: 25, label: '25 TEST' },
] as const;
export type StakeTierId = (typeof STAKE_TIERS)[number]['id'];
export const STAKE_TIER_IDS = STAKE_TIERS.map((t) => t.id) as [StakeTierId, ...StakeTierId[]];

export const TIME_CONTROLS = [
  { id: 'blitz_3_0', label: '3+0 Blitz', initialMs: 3 * 60_000, incrementMs: 0, demo: false },
  { id: 'bullet_1_0', label: '1+0 Demo', initialMs: 60_000, incrementMs: 0, demo: true },
] as const;
export type TimeControlId = (typeof TIME_CONTROLS)[number]['id'];
export const TIME_CONTROL_IDS = TIME_CONTROLS.map((t) => t.id) as [TimeControlId, ...TimeControlId[]];

export function stakeTier(id: StakeTierId) {
  const tier = STAKE_TIERS.find((t) => t.id === id);
  if (!tier) throw new Error(`Unknown stake tier ${id}`);
  return tier;
}

export function timeControl(id: TimeControlId) {
  const tc = TIME_CONTROLS.find((t) => t.id === id);
  if (!tc) throw new Error(`Unknown time control ${id}`);
  return tc;
}

export function toBaseUnits(whole: number): bigint {
  return BigInt(whole) * 10n ** BigInt(TOKEN_DECIMALS);
}

export function formatTokenAmount(baseUnits: bigint | string, maxFraction = 2): string {
  const v = typeof baseUnits === 'string' ? BigInt(baseUnits) : baseUnits;
  const scale = 10n ** BigInt(TOKEN_DECIMALS);
  const whole = v / scale;
  const frac = (v % scale).toString().padStart(TOKEN_DECIMALS, '0').slice(0, maxFraction).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

export const STARTING_ELO = 1200;
export const ELO_K_FACTOR = 32;

/** Matchmaking: start at ±150 and widen by 50 every 10 seconds, capped at ±600. */
export const MATCHMAKING = {
  baseTolerance: 150,
  widenStep: 50,
  widenEveryMs: 10_000,
  maxTolerance: 600,
} as const;

/** Escrow lifecycle windows, enforced both by the server and the onchain program. */
export const ESCROW = {
  fundingWindowSecs: 120,
  /** After funding, if the adjudicator never settles, anyone can refund both players after this. */
  resolutionWindowSecs: 60 * 60,
} as const;

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
export const AVATARS = ['knight', 'rook', 'bishop', 'queen', 'king', 'pawn'] as const;
export type AvatarId = (typeof AVATARS)[number];
export const AVATAR_COLORS = ['violet', 'emerald', 'amber', 'sky', 'rose', 'slate'] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];
