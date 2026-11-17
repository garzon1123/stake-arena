import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  assertTransition,
  eloUpdate,
  type Color,
  type DepositState,
  type GameEndReason,
  type MatchSnapshot,
  type MatchStatus,
  type Outcome,
  type PublicPlayer,
  type ServerToClientEvents,
} from '@stake-arena/shared';
import type { Db } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { ChessGame, type GameEnd } from '../game/engine.ts';
import { ChainError, type ChainService, type EscrowState, type PreparedDeposit } from '../solana/chain.ts';

export interface Hub {
  toPlayer<E extends keyof ServerToClientEvents>(playerId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
  toMatch<E extends keyof ServerToClientEvents>(matchId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly code = 'bad_request',
  ) {
    super(message);
  }
}

type MatchRow = typeof t.matches.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

interface Room {
  game: ChessGame;
  white: string;
  black: string;
  timer: NodeJS.Timeout | null;
}

const OUTCOME_CODE: Record<Outcome, number> = { white: 1, black: 2, draw: 3 };
const PREPARED_TTL_MS = 90_000;

export function toPublicPlayer(p: typeof t.players.$inferSelect): PublicPlayer {
  return {
    id: p.id,
    wallet: p.wallet,
    username: p.username,
    avatar: p.avatar,
    avatarColor: p.avatarColor,
    bio: p.bio,
    elo: p.elo,
    wins: p.wins,
    losses: p.losses,
    draws: p.draws,
  };
}

export class MatchService {
  private rooms = new Map<string, Room>();
  private locks = new Map<string, Promise<unknown>>();
  private prepared = new Map<string, { expected: Pick<PreparedDeposit, 'messageBytes' | 'lifetime'>; expires: number }>();
  private presence = new Map<string, { white: number; black: number }>();
  private loops: NodeJS.Timeout[] = [];
  private settling = false;
  private reconciling = false;

  constructor(
    private db: Db,
    private chain: ChainService,
    private hub: Hub,
    private log: Logger,
    private now: () => number = Date.now,
  ) {}

  // ------------------------------------------------------------------ infra

  /** Serializes all state changes for one match within this process. */
  private withLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(matchId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.locks.set(matchId, next);
    void next.finally(() => {
      if (this.locks.get(matchId) === next) this.locks.delete(matchId);
    }).catch(() => {});
    return next;
  }

  async audit(event: string, data: { playerId?: string; matchId?: string; [k: string]: unknown }) {
    const { playerId, matchId, ...rest } = data;
    await this.db.insert(t.auditLogs).values({ event, playerId, matchId, data: rest });
  }

  /** Optimistic, typed state transition: fails if the row is no longer in `from`. */
  private async transition(db: Db | Tx, matchId: string, from: MatchStatus, to: MatchStatus, extra: Partial<MatchRow> = {}) {
    assertTransition(from, to);
    const rows = await db
      .update(t.matches)
      .set({ ...extra, status: to, updatedAt: new Date(this.now()) })
      .where(and(eq(t.matches.id, matchId), eq(t.matches.status, from)))
      .returning({ id: t.matches.id });
    if (rows.length !== 1) throw new ServiceError(`Match is no longer ${from}`, 'conflict');
  }

  private async getMatch(matchId: string): Promise<MatchRow> {
    const [m] = await this.db.select().from(t.matches).where(eq(t.matches.id, matchId));
    if (!m) throw new ServiceError('Match not found', 'not_found');
    return m;
  }

  private colorOf(m: MatchRow, playerId: string): Color {
    if (m.whitePlayerId === playerId) return 'white';
    if (m.blackPlayerId === playerId) return 'black';
    throw new ServiceError('You are not a player in this match', 'forbidden');
  }

  start() {
    this.loops.push(setInterval(() => void this.reconcileAllFunding(), 3000));
    this.loops.push(setInterval(() => void this.runSettlementJobs(), 2000));
  }

  stop() {
    for (const l of this.loops) clearInterval(l);
    for (const r of this.rooms.values()) if (r.timer) clearTimeout(r.timer);
  }

  // ------------------------------------------------------------------ escrow creation

  /** Called right after the matchmaker atomically created the match row (status CREATED). */
  async openEscrow(matchId: string) {
    return this.withLock(matchId, async () => {
      const m = await this.getMatch(matchId);
      if (m.status !== 'CREATED') return;
      const [white, black] = await Promise.all([
        this.db.select().from(t.players).where(eq(t.players.id, m.whitePlayerId)),
        this.db.select().from(t.players).where(eq(t.players.id, m.blackPlayerId)),
      ]);
      try {
        await this.chain.createMatch(
          { matchId, playerOne: white[0]!.wallet, playerTwo: black[0]!.wallet, stake: m.stakeBaseUnits },
          async (sig) => {
            await this.db.insert(t.escrowTransactions).values({ signature: sig, matchId, kind: 'create' });
          },
        );
      } catch (e) {
        this.log.error({ matchId, err: String(e) }, 'escrow creation failed');
      }
      await this.syncCreated(m);
    });
  }

  /** Resolves a CREATED match from chain truth (used after creation and on restart). */
  private async syncCreated(m: MatchRow) {
    const escrow = await this.chain.fetchEscrow(m.id).catch(() => undefined);
    if (escrow === undefined) return; // RPC trouble: retry on next reconcile pass
    if (escrow) {
      await this.db
        .update(t.escrowTransactions)
        .set({ status: 'confirmed', confirmedAt: new Date(this.now()) })
        .where(and(eq(t.escrowTransactions.matchId, m.id), eq(t.escrowTransactions.kind, 'create')));
      await this.transition(this.db, m.id, 'CREATED', 'AWAITING_DEPOSITS', {
        fundingDeadline: escrow.fundingDeadline,
      });
      await this.audit('escrow.created', { matchId: m.id });
    } else {
      await this.db
        .update(t.escrowTransactions)
        .set({ status: 'failed' })
        .where(and(eq(t.escrowTransactions.matchId, m.id), eq(t.escrowTransactions.kind, 'create')));
      await this.db.transaction(async (tx) => {
        await this.transition(tx, m.id, 'CREATED', 'CANCELLED', { endedAt: new Date(this.now()) });
        await tx.update(t.matchParticipants).set({ active: false }).where(eq(t.matchParticipants.matchId, m.id));
      });
      await this.audit('escrow.create_failed', { matchId: m.id });
      this.notifyPlayers(m, 'error', 'Could not open the match escrow on Solana. No funds were moved.');
    }
    await this.broadcast(m.id);
  }

  // ------------------------------------------------------------------ deposits

  async prepareDeposit(matchId: string, playerId: string) {
    const m = await this.getMatch(matchId);
    this.colorOf(m, playerId);
    if (m.status !== 'AWAITING_DEPOSITS') throw new ServiceError('This match is not accepting deposits');
    if (m.fundingDeadline.getTime() <= this.now()) throw new ServiceError('The funding window has closed');
    const [part] = await this.db
      .select()
      .from(t.matchParticipants)
      .where(and(eq(t.matchParticipants.matchId, matchId), eq(t.matchParticipants.playerId, playerId)));
    if (!part) throw new ServiceError('Not a participant', 'forbidden');
    if (part.depositConfirmed) throw new ServiceError('Your stake is already deposited');
    const { token } = await this.chain.balances(part.wallet);
    if (token < m.stakeBaseUnits) {
      throw new ServiceError('Insufficient TEST balance. Use the faucet to get free test tokens.', 'insufficient_balance');
    }
    const prepared = await this.chain.prepareDeposit(matchId, part.wallet);
    this.prepared.set(`${matchId}:${playerId}`, {
      expected: { messageBytes: prepared.messageBytes, lifetime: prepared.lifetime },
      expires: this.now() + PREPARED_TTL_MS,
    });
    return { transaction: prepared.transaction };
  }

  async submitDeposit(matchId: string, playerId: string, signedTx: string) {
    const key = `${matchId}:${playerId}`;
    const prep = this.prepared.get(key);
    if (!prep || prep.expires < this.now()) {
      this.prepared.delete(key);
      throw new ServiceError('Deposit request expired. Please try again.', 'expired');
    }
    const m = await this.getMatch(matchId);
    const color = this.colorOf(m, playerId);
    const [part] = await this.db
      .select()
      .from(t.matchParticipants)
      .where(and(eq(t.matchParticipants.matchId, matchId), eq(t.matchParticipants.playerId, playerId)));
    if (!part || part.depositConfirmed) throw new ServiceError('Deposit already confirmed');
    this.prepared.delete(key); // single use

    let signature: string | null = null;
    try {
      signature = await this.chain.submitDeposit(signedTx, prep.expected, part.wallet, async (sig) => {
        signature = sig;
        await this.db
          .insert(t.escrowTransactions)
          .values({ signature: sig, matchId, kind: 'deposit', playerId })
          .onConflictDoNothing();
        await this.broadcast(matchId);
      });
    } catch (e) {
      if (signature) {
        await this.db
          .update(t.escrowTransactions)
          .set({ status: 'failed', error: String(e instanceof Error ? e.message : e).slice(0, 500) })
          .where(eq(t.escrowTransactions.signature, signature));
      }
      await this.broadcast(matchId);
      if (e instanceof ChainError) {
        throw new ServiceError(
          e.code === 'blockhash_expired' ? 'The transaction expired before it landed. Please sign again.' : `Deposit failed: ${e.message}`,
          e.code === 'blockhash_expired' ? 'expired' : 'chain_error',
        );
      }
      throw e;
    }
    // Never trust the signature alone: verify the escrow account now shows this seat funded.
    await this.reconcileFunding(matchId);
    const after = await this.db
      .select()
      .from(t.matchParticipants)
      .where(and(eq(t.matchParticipants.matchId, matchId), eq(t.matchParticipants.playerId, playerId)));
    if (!after[0]?.depositConfirmed) {
      throw new ServiceError('Transaction sent but the escrow does not show your deposit yet. It will update automatically.', 'pending');
    }
    await this.audit('escrow.deposit', { matchId, playerId, signature, color });
    return { signature };
  }

  private async reconcileAllFunding() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const open = await this.db
        .select({ id: t.matches.id })
        .from(t.matches)
        .where(inArray(t.matches.status, ['CREATED', 'AWAITING_DEPOSITS', 'FUNDED']));
      for (const { id } of open) {
        await this.reconcileFunding(id).catch((e) => this.log.warn({ matchId: id, err: String(e) }, 'reconcile failed'));
      }
    } finally {
      this.reconciling = false;
    }
  }

  /** Pulls deposit truth from the escrow account and advances the lifecycle. */
  async reconcileFunding(matchId: string) {
    return this.withLock(matchId, async () => {
      const m = await this.getMatch(matchId);
      if (m.status === 'CREATED') {
        // creation still in flight or crashed mid-way: only resolve once it is clearly stale
        if (this.now() - m.createdAt.getTime() > 60_000) await this.syncCreated(m);
        return;
      }
      if (m.status === 'FUNDED') return this.startGame(m);
      if (m.status !== 'AWAITING_DEPOSITS') return;

      const escrow = await this.chain.fetchEscrow(matchId);
      if (!escrow) return;
      this.assertEscrowBinding(m, escrow);
      let changed = false;
      for (const [color, deposited] of [
        ['white', escrow.playerOneDeposited],
        ['black', escrow.playerTwoDeposited],
      ] as const) {
        if (!deposited) continue;
        const playerId = color === 'white' ? m.whitePlayerId : m.blackPlayerId;
        const rows = await this.db
          .update(t.matchParticipants)
          .set({ depositConfirmed: true })
          .where(
            and(
              eq(t.matchParticipants.matchId, matchId),
              eq(t.matchParticipants.playerId, playerId),
              eq(t.matchParticipants.depositConfirmed, false),
            ),
          )
          .returning();
        if (rows.length) {
          changed = true;
          await this.db
            .update(t.escrowTransactions)
            .set({ status: 'confirmed', confirmedAt: new Date(this.now()) })
            .where(
              and(
                eq(t.escrowTransactions.matchId, matchId),
                eq(t.escrowTransactions.playerId, playerId),
                eq(t.escrowTransactions.kind, 'deposit'),
                eq(t.escrowTransactions.status, 'pending'),
              ),
            );
        }
      }

      if (escrow.state === 'Funded') {
        await this.transition(this.db, matchId, 'AWAITING_DEPOSITS', 'FUNDED');
        await this.audit('escrow.funded', { matchId });
        return this.startGame(await this.getMatch(matchId));
      }
      if (this.now() >= m.fundingDeadline.getTime()) {
        await this.cancelUnfunded(m, escrow);
        return;
      }
      if (changed) await this.broadcast(matchId);
    });
  }

  private assertEscrowBinding(m: MatchRow, e: EscrowState) {
    if (e.stake !== m.stakeBaseUnits || e.mint !== m.mint || e.adjudicator !== m.adjudicator) {
      throw new Error(`Escrow ${m.id} does not match the database record`);
    }
  }

  private async cancelUnfunded(m: MatchRow, escrow: EscrowState) {
    const anyDeposit = escrow.playerOneDeposited || escrow.playerTwoDeposited;
    await this.db.transaction(async (tx) => {
      await this.transition(tx, m.id, 'AWAITING_DEPOSITS', 'CANCELLED', { endedAt: new Date(this.now()) });
      await tx.update(t.matchParticipants).set({ active: false }).where(eq(t.matchParticipants.matchId, m.id));
      // Always close the escrow onchain: refunds any single deposit and reclaims rent.
      await tx.insert(t.settlementJobs).values({ matchId: m.id, kind: 'cancel' }).onConflictDoNothing();
    });
    await this.audit('match.cancelled_unfunded', { matchId: m.id, anyDeposit });
    this.notifyPlayers(
      m,
      'info',
      anyDeposit
        ? 'Match cancelled: your opponent did not fund in time. Your stake is being refunded onchain.'
        : 'Match cancelled: funding window expired.',
    );
    await this.broadcast(m.id);
    void this.runSettlementJobs();
  }

  // ------------------------------------------------------------------ gameplay

  private async startGame(m: MatchRow) {
    const now = this.now();
    await this.transition(this.db, m.id, 'FUNDED', 'ACTIVE', {
      startedAt: new Date(now),
      turnStartedAt: new Date(now),
    });
    const game = new ChessGame({ initialMs: m.initialMs, incrementMs: m.incrementMs, turnStartedAt: now });
    this.rooms.set(m.id, { game, white: m.whitePlayerId, black: m.blackPlayerId, timer: null });
    this.armClock(m.id);
    await this.audit('match.started', { matchId: m.id });
    await this.broadcast(m.id);
  }

  /** Rebuilds an ACTIVE match's in-memory room from persisted moves and clocks. */
  private async loadRoom(matchId: string): Promise<Room> {
    const existing = this.rooms.get(matchId);
    if (existing) return existing;
    const m = await this.getMatch(matchId);
    if (m.status !== 'ACTIVE') throw new ServiceError('Match is not in progress');
    const mv = await this.db.select().from(t.moves).where(eq(t.moves.matchId, matchId)).orderBy(t.moves.ply);
    const game = new ChessGame({
      initialMs: m.initialMs,
      incrementMs: m.incrementMs,
      moves: mv.map((x) => ({ from: x.fromSq, to: x.toSq, promotion: x.promotion })),
      whiteMs: m.whiteMs,
      blackMs: m.blackMs,
      turnStartedAt: m.turnStartedAt?.getTime() ?? this.now(),
    });
    if (game.fen !== m.fen) throw new Error(`Replayed position mismatch for ${matchId}`);
    const room: Room = { game, white: m.whitePlayerId, black: m.blackPlayerId, timer: null };
    this.rooms.set(matchId, room);
    this.armClock(matchId);
    return room;
  }

  private armClock(matchId: string) {
    const room = this.rooms.get(matchId);
    if (!room || room.game.ended) return;
    if (room.timer) clearTimeout(room.timer);
    const side = room.game.turn();
    const ms = Math.max(0, room.game.remaining(side, this.now())) + 25;
    room.timer = setTimeout(() => {
      void this.withLock(matchId, async () => {
        const r = this.rooms.get(matchId);
        if (!r || r.game.ended) return;
        const end = r.game.checkTimeout(this.now());
        if (end) await this.finish(matchId, end);
        else this.armClock(matchId);
      }).catch((e) => this.log.error({ matchId, err: String(e) }, 'clock handler failed'));
    }, ms);
  }

  async move(playerId: string, p: { matchId: string; ply: number; from: string; to: string; promotion?: string }) {
    return this.withLock(p.matchId, async () => {
      const room = await this.loadRoom(p.matchId);
      const color: Color = room.white === playerId ? 'white' : room.black === playerId ? 'black' : (() => {
        throw new ServiceError('You are not a player in this match', 'forbidden');
      })();
      const now = this.now();
      const res = room.game.move(color, p.ply, p.from, p.to, p.promotion, now);
      if (!res.ok) {
        if (res.end) await this.finish(p.matchId, res.end);
        throw new ServiceError(res.error, 'illegal_move');
      }
      const g = room.game;
      await this.db.transaction(async (tx) => {
        await tx.insert(t.moves).values({
          matchId: p.matchId,
          ply: res.ply,
          san: res.san,
          fromSq: p.from,
          toSq: p.to,
          promotion: p.promotion ?? null,
          fenAfter: res.fen,
          whiteMs: g.whiteMs,
          blackMs: g.blackMs,
        });
        await tx
          .update(t.matches)
          .set({
            fen: res.fen,
            whiteMs: g.whiteMs,
            blackMs: g.blackMs,
            turnStartedAt: new Date(now),
            drawOfferBy: null,
            updatedAt: new Date(now),
          })
          .where(and(eq(t.matches.id, p.matchId), eq(t.matches.status, 'ACTIVE')));
      });
      this.hub.toMatch(p.matchId, 'match:move', {
        matchId: p.matchId,
        ply: res.ply,
        san: res.san,
        from: p.from,
        to: p.to,
        fen: res.fen,
        whiteMs: g.whiteMs,
        blackMs: g.blackMs,
        turnStartedAt: now,
        serverNow: now,
      });
      this.hub.toMatch(p.matchId, 'match:drawOffer', { matchId: p.matchId, by: null });
      if (res.end) await this.finish(p.matchId, res.end);
      else this.armClock(p.matchId);
      return { ply: res.ply };
    });
  }

  async resign(playerId: string, matchId: string) {
    return this.withLock(matchId, async () => {
      const room = await this.loadRoom(matchId);
      const color = this.roomColor(room, playerId);
      await this.finish(matchId, room.game.resign(color));
    });
  }

  async offerDraw(playerId: string, matchId: string) {
    return this.withLock(matchId, async () => {
      const room = await this.loadRoom(matchId);
      const color = this.roomColor(room, playerId);
      await this.db.update(t.matches).set({ drawOfferBy: color }).where(eq(t.matches.id, matchId));
      this.hub.toMatch(matchId, 'match:drawOffer', { matchId, by: color });
    });
  }

  async respondDraw(playerId: string, matchId: string, accept: boolean) {
    return this.withLock(matchId, async () => {
      const room = await this.loadRoom(matchId);
      const color = this.roomColor(room, playerId);
      const m = await this.getMatch(matchId);
      if (!m.drawOfferBy || m.drawOfferBy === color) throw new ServiceError('No draw offer to respond to');
      if (accept) return this.finish(matchId, room.game.agreeDraw());
      await this.db.update(t.matches).set({ drawOfferBy: null }).where(eq(t.matches.id, matchId));
      this.hub.toMatch(matchId, 'match:drawOffer', { matchId, by: null });
    });
  }

  private roomColor(room: Room, playerId: string): Color {
    if (room.white === playerId) return 'white';
    if (room.black === playerId) return 'black';
    throw new ServiceError('You are not a player in this match', 'forbidden');
  }

  /**
   * Records the verified result exactly once: result row, rating history and player stats
   * are written in one transaction guarded by the ACTIVE -> RESULT_RECORDED transition and
   * primary/unique keys, then the onchain settlement job is queued.
   */
  private async finish(matchId: string, end: GameEnd) {
    const room = this.rooms.get(matchId);
    if (room?.timer) clearTimeout(room.timer);
    const g = room?.game;
    await this.db.transaction(async (tx) => {
      const [m] = await tx.select().from(t.matches).where(eq(t.matches.id, matchId)).for('update');
      if (!m || m.status !== 'ACTIVE') return;
      const [w] = await tx.select().from(t.players).where(eq(t.players.id, m.whitePlayerId)).for('update');
      const [b] = await tx.select().from(t.players).where(eq(t.players.id, m.blackPlayerId)).for('update');
      if (!w || !b) throw new Error('players missing');
      const elo = eloUpdate(w.elo, b.elo, end.outcome);
      const nowD = new Date(this.now());
      await this.transition(tx, matchId, 'ACTIVE', 'RESULT_RECORDED', {
        endedAt: nowD,
        whiteMs: Math.max(0, g?.whiteMs ?? m.whiteMs),
        blackMs: Math.max(0, g?.blackMs ?? m.blackMs),
        turnStartedAt: null,
        drawOfferBy: null,
      });
      await tx.insert(t.matchResults).values({
        matchId,
        outcome: end.outcome,
        reason: end.reason,
        whiteRatingBefore: w.elo,
        whiteRatingAfter: elo.white,
        blackRatingBefore: b.elo,
        blackRatingAfter: elo.black,
      });
      await tx.insert(t.ratingHistory).values([
        { playerId: w.id, matchId, before: w.elo, after: elo.white, delta: elo.whiteDelta },
        { playerId: b.id, matchId, before: b.elo, after: elo.black, delta: elo.blackDelta },
      ]);
      const stat = (won: boolean, lost: boolean) => ({
        wins: sql`${t.players.wins} + ${won ? 1 : 0}`,
        losses: sql`${t.players.losses} + ${lost ? 1 : 0}`,
        draws: sql`${t.players.draws} + ${!won && !lost ? 1 : 0}`,
      });
      await tx
        .update(t.players)
        .set({ elo: elo.white, ...stat(end.outcome === 'white', end.outcome === 'black'), updatedAt: nowD })
        .where(eq(t.players.id, w.id));
      await tx
        .update(t.players)
        .set({ elo: elo.black, ...stat(end.outcome === 'black', end.outcome === 'white'), updatedAt: nowD })
        .where(eq(t.players.id, b.id));
      await tx.update(t.matchParticipants).set({ active: false }).where(eq(t.matchParticipants.matchId, matchId));
      await this.transition(tx, matchId, 'RESULT_RECORDED', 'SETTLEMENT_PENDING');
      await tx.insert(t.settlementJobs).values({ matchId, kind: 'settle', outcome: OUTCOME_CODE[end.outcome] });
    });
    this.rooms.delete(matchId);
    await this.audit('match.result', { matchId, outcome: end.outcome, reason: end.reason });
    await this.broadcast(matchId);
    void this.runSettlementJobs();
  }

  // ------------------------------------------------------------------ settlement worker

  async runSettlementJobs() {
    if (this.settling) return;
    this.settling = true;
    try {
      const jobs = await this.db
        .select()
        .from(t.settlementJobs)
        .where(and(eq(t.settlementJobs.status, 'pending'), lte(t.settlementJobs.nextAttemptAt, new Date(this.now()))));
      for (const job of jobs) {
        await this.withLock(job.matchId, () => this.processJob(job)).catch((e) =>
          this.log.error({ matchId: job.matchId, err: String(e) }, 'settlement job crashed'),
        );
      }
    } finally {
      this.settling = false;
    }
  }

  private async processJob(job: typeof t.settlementJobs.$inferSelect) {
    const m = await this.getMatch(job.matchId);
    const [white] = await this.db.select().from(t.players).where(eq(t.players.id, m.whitePlayerId));
    const [black] = await this.db.select().from(t.players).where(eq(t.players.id, m.blackPlayerId));
    const kind = job.kind === 'settle' ? 'settle' : job.kind === 'cancel' ? 'cancel' : 'refund';
    try {
      let escrow = await this.chain.fetchEscrow(m.id);
      const done = (e: EscrowState | null) =>
        kind === 'settle'
          ? e?.state === 'Settled' || e?.state === 'Refunded'
          : kind === 'cancel'
            ? e === null || e.state === 'Cancelled'
            : e?.state === 'Refunded';
      if (!done(escrow)) {
        const ixKind = kind === 'settle' ? 'settle' : kind === 'cancel' ? 'cancel_unfunded' : 'refund_unresolved';
        await this.chain.payout(
          ixKind,
          { matchId: m.id, playerOne: white!.wallet, playerTwo: black!.wallet, outcome: job.outcome ?? undefined },
          async (sig) => {
            await this.db.insert(t.escrowTransactions).values({ signature: sig, matchId: m.id, kind }).onConflictDoNothing();
            await this.db
              .update(t.settlementJobs)
              .set({ signature: sig, attempts: job.attempts + 1, updatedAt: new Date(this.now()) })
              .where(eq(t.settlementJobs.matchId, m.id));
          },
        );
        escrow = await this.chain.fetchEscrow(m.id);
      }
      if (!done(escrow)) throw new Error(`Escrow state after ${kind} is ${escrow?.state ?? 'missing'}`);

      const [fresh] = await this.db.select().from(t.settlementJobs).where(eq(t.settlementJobs.matchId, m.id));
      await this.db.transaction(async (tx) => {
        await tx
          .update(t.settlementJobs)
          .set({ status: 'confirmed', lastError: null, updatedAt: new Date(this.now()) })
          .where(eq(t.settlementJobs.matchId, m.id));
        if (fresh?.signature) {
          await tx
            .update(t.escrowTransactions)
            .set({ status: 'confirmed', confirmedAt: new Date(this.now()) })
            .where(eq(t.escrowTransactions.signature, fresh.signature));
        }
        if (kind === 'settle' && m.status === 'SETTLEMENT_PENDING') {
          await this.transition(tx, m.id, 'SETTLEMENT_PENDING', escrow?.state === 'Refunded' ? 'REFUNDED' : 'SETTLED');
        }
      });
      await this.audit(`escrow.${kind}_confirmed`, { matchId: m.id, signature: fresh?.signature });
      if (kind === 'settle') {
        this.notifyPlayers(m, 'success', 'Settlement confirmed on Solana.');
      }
    } catch (e) {
      const attempts = job.attempts + 1;
      const delay = Math.min(60_000, 2000 * 2 ** Math.min(attempts, 5));
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      this.log.warn({ matchId: m.id, attempts, err: msg }, 'settlement attempt failed');
      await this.db
        .update(t.settlementJobs)
        .set({ attempts, lastError: msg, nextAttemptAt: new Date(this.now() + delay), updatedAt: new Date(this.now()) })
        .where(eq(t.settlementJobs.matchId, m.id));
    }
    await this.broadcast(m.id);
  }

  /** Manual retry trigger (from the results screen); safe because jobs are idempotent. */
  async retrySettlement(matchId: string) {
    await this.db
      .update(t.settlementJobs)
      .set({ nextAttemptAt: new Date(this.now()) })
      .where(and(eq(t.settlementJobs.matchId, matchId), eq(t.settlementJobs.status, 'pending')));
    void this.runSettlementJobs();
  }

  // ------------------------------------------------------------------ recovery & presence

  /** Restores in-flight matches after a restart. Chain state is the source of truth for funds. */
  async recover() {
    const active = await this.db.select().from(t.matches).where(eq(t.matches.status, 'ACTIVE'));
    for (const m of active) {
      await this.withLock(m.id, async () => {
        const room = await this.loadRoom(m.id);
        // Clocks keep running while the server is down (documented policy).
        const end = room.game.checkTimeout(this.now());
        if (end) await this.finish(m.id, end);
      }).catch((e) => this.log.error({ matchId: m.id, err: String(e) }, 'recover failed'));
    }
    await this.reconcileAllFunding();
    await this.runSettlementJobs();
    this.log.info({ active: active.length }, 'match recovery complete');
  }

  setPresence(matchId: string, color: Color, delta: 1 | -1) {
    const p = this.presence.get(matchId) ?? { white: 0, black: 0 };
    p[color] = Math.max(0, p[color] + delta);
    this.presence.set(matchId, p);
    this.hub.toMatch(matchId, 'match:presence', { matchId, white: p.white > 0, black: p.black > 0 });
  }

  private notifyPlayers(m: MatchRow, level: 'info' | 'error' | 'success', message: string) {
    this.hub.toPlayer(m.whitePlayerId, 'notice', { level, message });
    this.hub.toPlayer(m.blackPlayerId, 'notice', { level, message });
  }

  async broadcast(matchId: string) {
    const snap = await this.snapshot(matchId);
    this.hub.toMatch(matchId, 'match:state', snap);
    this.hub.toPlayer(snap.white.id, 'match:state', snap);
    this.hub.toPlayer(snap.black.id, 'match:state', snap);
  }

  async snapshot(matchId: string): Promise<MatchSnapshot> {
    const m = await this.getMatch(matchId);
    const [w, b, parts, mv, txs, result, job] = await Promise.all([
      this.db.select().from(t.players).where(eq(t.players.id, m.whitePlayerId)),
      this.db.select().from(t.players).where(eq(t.players.id, m.blackPlayerId)),
      this.db.select().from(t.matchParticipants).where(eq(t.matchParticipants.matchId, matchId)),
      this.db.select().from(t.moves).where(eq(t.moves.matchId, matchId)).orderBy(t.moves.ply),
      this.db.select().from(t.escrowTransactions).where(eq(t.escrowTransactions.matchId, matchId)).orderBy(desc(t.escrowTransactions.createdAt)),
      this.db.select().from(t.matchResults).where(eq(t.matchResults.matchId, matchId)),
      this.db.select().from(t.settlementJobs).where(eq(t.settlementJobs.matchId, matchId)),
    ]);
    const deposits: DepositState[] = (['white', 'black'] as const).map((color) => {
      const pid = color === 'white' ? m.whitePlayerId : m.blackPlayerId;
      const part = parts.find((p) => p.playerId === pid);
      const tx = txs.find((x) => x.kind === 'deposit' && x.playerId === pid && x.status !== 'failed');
      return {
        color,
        status: part?.depositConfirmed ? 'confirmed' : tx ? 'pending' : 'none',
        signature: tx?.signature ?? null,
      };
    });
    const room = this.rooms.get(matchId);
    const res = result[0];
    const settleTx = txs.find((x) => x.kind === 'settle' && x.status === 'confirmed');
    const refundTx = txs.find((x) => (x.kind === 'cancel' || x.kind === 'refund') && x.status === 'confirmed');
    const pres = this.presence.get(matchId) ?? { white: 0, black: 0 };
    return {
      id: m.id,
      status: m.status as MatchStatus,
      stakeTier: m.stakeTier,
      stakeBaseUnits: m.stakeBaseUnits.toString(),
      timeControl: m.timeControl,
      white: toPublicPlayer(w[0]!),
      black: toPublicPlayer(b[0]!),
      escrowAddress: m.escrowAddress,
      vaultAddress: m.vaultAddress,
      mint: m.mint,
      fundingDeadline: m.fundingDeadline.toISOString(),
      deposits,
      createSignature: txs.find((x) => x.kind === 'create' && x.status !== 'failed')?.signature ?? null,
      fen: room?.game.fen ?? m.fen,
      moves: mv.map((x) => ({
        ply: x.ply,
        san: x.san,
        from: x.fromSq,
        to: x.toSq,
        color: (x.ply % 2 === 1 ? 'white' : 'black') as Color,
      })),
      whiteMs: room?.game.whiteMs ?? m.whiteMs,
      blackMs: room?.game.blackMs ?? m.blackMs,
      turnStartedAt: m.status === 'ACTIVE' ? (room?.game.turnStartedAt ?? m.turnStartedAt?.getTime() ?? null) : null,
      serverNow: this.now(),
      turn: mv.length % 2 === 0 ? 'white' : 'black',
      drawOfferBy: (m.drawOfferBy as Color | null) ?? null,
      connected: { white: pres.white > 0, black: pres.black > 0 },
      outcome: (res?.outcome as Outcome | undefined) ?? null,
      endReason: (res?.reason as GameEndReason | undefined) ?? null,
      ratingChange: res
        ? { white: res.whiteRatingAfter - res.whiteRatingBefore, black: res.blackRatingAfter - res.blackRatingBefore }
        : null,
      settlementSignature: settleTx?.signature ?? null,
      refundSignature: refundTx?.signature ?? null,
      settlementError: job[0]?.status === 'pending' ? (job[0].lastError ?? null) : null,
    };
  }
}
