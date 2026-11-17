import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  wallet: text('wallet').notNull().unique(),
  username: text('username').unique(),
  avatar: text('avatar').notNull().default('knight'),
  avatarColor: text('avatar_color').notNull().default('violet'),
  bio: text('bio').notNull().default(''),
  elo: integer('elo').notNull().default(1200),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  draws: integer('draws').notNull().default(0),
  lastFaucetAt: ts('last_faucet_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const walletAuthNonces = pgTable('wallet_auth_nonces', {
  nonce: text('nonce').primaryKey(),
  wallet: text('wallet').notNull(),
  message: text('message').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** sha256(token) — the raw token only ever lives in the httpOnly cookie. */
    tokenHash: text('token_hash').primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_player_idx').on(t.playerId)],
);

export const matchmakingQueue = pgTable(
  'matchmaking_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    wallet: text('wallet').notNull(),
    elo: integer('elo').notNull(),
    stakeTier: text('stake_tier').notNull(),
    timeControl: text('time_control').notNull(),
    /** WAITING | MATCHED | CANCELLED */
    status: text('status').notNull().default('WAITING'),
    matchId: uuid('match_id'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('queue_one_waiting_per_player').on(t.playerId).where(sql`${t.status} = 'WAITING'`),
    index('queue_waiting_idx').on(t.stakeTier, t.timeControl, t.joinedAt).where(sql`${t.status} = 'WAITING'`),
  ],
);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey(),
    status: text('status').notNull(),
    stakeTier: text('stake_tier').notNull(),
    stakeBaseUnits: bigint('stake_base_units', { mode: 'bigint' }).notNull(),
    timeControl: text('time_control').notNull(),
    initialMs: integer('initial_ms').notNull(),
    incrementMs: integer('increment_ms').notNull(),
    whitePlayerId: uuid('white_player_id')
      .notNull()
      .references(() => players.id),
    blackPlayerId: uuid('black_player_id')
      .notNull()
      .references(() => players.id),
    /** Onchain seat binding: player_one = white, player_two = black. */
    escrowAddress: text('escrow_address').notNull().unique(),
    vaultAddress: text('vault_address').notNull(),
    mint: text('mint').notNull(),
    adjudicator: text('adjudicator').notNull(),
    fundingDeadline: ts('funding_deadline').notNull(),
    fen: text('fen').notNull(),
    whiteMs: integer('white_ms').notNull(),
    blackMs: integer('black_ms').notNull(),
    turnStartedAt: ts('turn_started_at'),
    drawOfferBy: text('draw_offer_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('matches_status_idx').on(t.status)],
);

export const matchParticipants = pgTable(
  'match_participants',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    color: text('color').notNull(),
    wallet: text('wallet').notNull(),
    /** true while the match occupies the player (prevents simultaneous matches). */
    active: boolean('active').notNull().default(true),
    depositConfirmed: boolean('deposit_confirmed').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.playerId] }),
    uniqueIndex('participants_one_active_match').on(t.playerId).where(sql`${t.active}`),
  ],
);

export const moves = pgTable(
  'moves',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    ply: integer('ply').notNull(),
    san: text('san').notNull(),
    fromSq: text('from_sq').notNull(),
    toSq: text('to_sq').notNull(),
    promotion: text('promotion'),
    fenAfter: text('fen_after').notNull(),
    whiteMs: integer('white_ms').notNull(),
    blackMs: integer('black_ms').notNull(),
    playedAt: ts('played_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.ply] })],
);

export const matchResults = pgTable('match_results', {
  matchId: uuid('match_id')
    .primaryKey()
    .references(() => matches.id),
  outcome: text('outcome').notNull(),
  reason: text('reason').notNull(),
  whiteRatingBefore: integer('white_rating_before').notNull(),
  whiteRatingAfter: integer('white_rating_after').notNull(),
  blackRatingBefore: integer('black_rating_before').notNull(),
  blackRatingAfter: integer('black_rating_after').notNull(),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
});

export const ratingHistory = pgTable(
  'rating_history',
  {
    id: serial('id').primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    before: integer('before').notNull(),
    after: integer('after').notNull(),
    delta: integer('delta').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('rating_once_per_match').on(t.matchId, t.playerId)],
);

export const escrowTransactions = pgTable(
  'escrow_transactions',
  {
    signature: text('signature').primaryKey(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    /** create | deposit | settle | cancel | refund */
    kind: text('kind').notNull(),
    playerId: uuid('player_id').references(() => players.id),
    /** pending | confirmed | failed */
    status: text('status').notNull().default('pending'),
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    confirmedAt: ts('confirmed_at'),
  },
  (t) => [index('escrow_tx_match_idx').on(t.matchId)],
);

export const settlementJobs = pgTable('settlement_jobs', {
  matchId: uuid('match_id')
    .primaryKey()
    .references(() => matches.id),
  /** settle | cancel | refund */
  kind: text('kind').notNull(),
  /** onchain outcome code for settle: 1 white, 2 black, 3 draw */
  outcome: integer('outcome'),
  /** pending | confirmed */
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  signature: text('signature'),
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    at: ts('at').notNull().defaultNow(),
    event: text('event').notNull(),
    playerId: uuid('player_id'),
    matchId: uuid('match_id'),
    data: jsonb('data'),
  },
  (t) => [index('audit_match_idx').on(t.matchId)],
);
