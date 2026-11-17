import { z } from 'zod';
import { AVATARS, AVATAR_COLORS, STAKE_TIER_IDS, TIME_CONTROL_IDS, USERNAME_RE } from './constants.ts';
import type { Color, GameEndReason, MatchStatus, Outcome } from './lifecycle.ts';

// ---------- REST payloads ----------

export const NonceRequest = z.object({ wallet: z.string().min(32).max(44) });
export const VerifyRequest = z.object({
  wallet: z.string().min(32).max(44),
  nonce: z.string().min(16).max(64),
  /** base64 ed25519 signature over the server-issued sign-in message */
  signature: z.string().max(200),
});

export const ProfileUpdate = z.object({
  username: z.string().regex(USERNAME_RE, '3–20 letters, numbers or underscores'),
  avatar: z.enum(AVATARS),
  avatarColor: z.enum(AVATAR_COLORS),
  bio: z
    .string()
    .max(160)
    .transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim())
    .optional()
    .default(''),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export const DepositSubmit = z.object({
  /** base64 wire transaction signed by the player's wallet */
  transaction: z.string().max(4096),
});

// ---------- Socket events ----------

export const QueueJoin = z.object({
  stakeTier: z.enum(STAKE_TIER_IDS),
  timeControl: z.enum(TIME_CONTROL_IDS),
});
export type QueueJoin = z.infer<typeof QueueJoin>;

export const MoveSubmit = z.object({
  matchId: z.string().uuid(),
  /** ply the client believes it is submitting (0-based count of moves already played) */
  ply: z.number().int().min(0).max(2000),
  from: z.string().regex(/^[a-h][1-8]$/),
  to: z.string().regex(/^[a-h][1-8]$/),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
});
export type MoveSubmit = z.infer<typeof MoveSubmit>;

export const MatchAction = z.object({ matchId: z.string().uuid() });

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface PublicPlayer {
  id: string;
  wallet: string;
  username: string | null;
  avatar: string;
  avatarColor: string;
  bio: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface DepositState {
  color: Color;
  status: 'none' | 'pending' | 'confirmed';
  signature: string | null;
}

export interface MatchSnapshot {
  id: string;
  status: MatchStatus;
  stakeTier: string;
  stakeBaseUnits: string;
  timeControl: string;
  white: PublicPlayer;
  black: PublicPlayer;
  escrowAddress: string;
  vaultAddress: string;
  mint: string;
  fundingDeadline: string;
  deposits: DepositState[];
  createSignature: string | null;
  // game
  fen: string;
  moves: { ply: number; san: string; from: string; to: string; color: Color }[];
  whiteMs: number;
  blackMs: number;
  /** server time the current turn started (ms epoch); null when clock not running */
  turnStartedAt: number | null;
  serverNow: number;
  turn: Color;
  drawOfferBy: Color | null;
  connected: { white: boolean; black: boolean };
  // result
  outcome: Outcome | null;
  endReason: GameEndReason | null;
  ratingChange: { white: number; black: number } | null;
  settlementSignature: string | null;
  refundSignature: string | null;
  settlementError: string | null;
}

export interface QueueStatus {
  inQueue: boolean;
  stakeTier?: string;
  timeControl?: string;
  joinedAt?: number;
  tolerance?: number;
  waitingInTier?: number;
}

export interface ServerToClientEvents {
  'queue:status': (s: QueueStatus) => void;
  'match:found': (m: { matchId: string }) => void;
  'match:state': (m: MatchSnapshot) => void;
  'match:move': (m: {
    matchId: string;
    ply: number;
    san: string;
    from: string;
    to: string;
    fen: string;
    whiteMs: number;
    blackMs: number;
    turnStartedAt: number;
    serverNow: number;
  }) => void;
  'match:presence': (m: { matchId: string; white: boolean; black: boolean }) => void;
  'match:drawOffer': (m: { matchId: string; by: Color | null }) => void;
  'notice': (m: { level: 'info' | 'error' | 'success'; message: string }) => void;
}

export interface ClientToServerEvents {
  'queue:join': (p: QueueJoin, ack: (r: Ack<{ status: QueueStatus }>) => void) => void;
  'queue:leave': (ack: (r: Ack) => void) => void;
  'match:subscribe': (p: { matchId: string }, ack: (r: Ack<{ snapshot: MatchSnapshot }>) => void) => void;
  'match:move': (p: MoveSubmit, ack: (r: Ack<{ ply: number }>) => void) => void;
  'match:resign': (p: { matchId: string }, ack: (r: Ack) => void) => void;
  'match:offerDraw': (p: { matchId: string }, ack: (r: Ack) => void) => void;
  'match:respondDraw': (p: { matchId: string; accept: boolean }, ack: (r: Ack) => void) => void;
}
