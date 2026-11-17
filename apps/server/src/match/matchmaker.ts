import { randomInt, randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Chess } from 'chess.js';
import {
  MATCHMAKING,
  ratingTolerance,
  stakeTier,
  timeControl,
  toBaseUnits,
  type QueueJoin,
  type QueueStatus,
  type StakeTierId,
  type TimeControlId,
} from '@stake-arena/shared';
import type { Db } from '../db/client.ts';
import * as t from '../db/schema.ts';
import type { ChainService } from '../solana/chain.ts';
import { ServiceError, type Hub, type Logger, type MatchService } from './service.ts';

type QueueRow = typeof t.matchmakingQueue.$inferSelect;

/** Pure pairing decision, exported for unit tests. Oldest entries get priority. */
export function findPairs(entries: QueueRow[], now: number): [QueueRow, QueueRow][] {
  const sorted = [...entries].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  const taken = new Set<string>();
  const pairs: [QueueRow, QueueRow][] = [];
  for (const a of sorted) {
    if (taken.has(a.id)) continue;
    let best: QueueRow | null = null;
    for (const b of sorted) {
      if (b.id === a.id || taken.has(b.id)) continue;
      if (b.playerId === a.playerId || b.wallet === a.wallet) continue;
      if (b.stakeTier !== a.stakeTier || b.timeControl !== a.timeControl) continue;
      const tol = Math.max(
        ratingTolerance(now - a.joinedAt.getTime(), MATCHMAKING),
        ratingTolerance(now - b.joinedAt.getTime(), MATCHMAKING),
      );
      const diff = Math.abs(a.elo - b.elo);
      if (diff > tol) continue;
      if (!best || diff < Math.abs(a.elo - best.elo)) best = b;
    }
    if (best) {
      taken.add(a.id).add(best.id);
      pairs.push([a, best]);
    }
  }
  return pairs;
}

export class Matchmaker {
  private ticking = false;
  private loop: NodeJS.Timeout | null = null;

  constructor(
    private db: Db,
    private chain: ChainService,
    private matches: MatchService,
    private hub: Hub,
    private log: Logger,
    private now: () => number = Date.now,
  ) {}

  start() {
    this.loop = setInterval(() => void this.tick(), 1000);
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
  }

  async activeMatchId(playerId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ matchId: t.matchParticipants.matchId })
      .from(t.matchParticipants)
      .where(and(eq(t.matchParticipants.playerId, playerId), eq(t.matchParticipants.active, true)));
    return row?.matchId ?? null;
  }

  async join(playerId: string, req: QueueJoin): Promise<QueueStatus> {
    const [player] = await this.db.select().from(t.players).where(eq(t.players.id, playerId));
    if (!player) throw new ServiceError('Unknown player', 'forbidden');
    if (!player.username) throw new ServiceError('Create your player profile first');
    if (await this.activeMatchId(playerId)) throw new ServiceError('You already have a match in progress');
    try {
      await this.db.insert(t.matchmakingQueue).values({
        playerId,
        wallet: player.wallet,
        elo: player.elo,
        stakeTier: req.stakeTier,
        timeControl: req.timeControl,
      });
    } catch {
      throw new ServiceError('You are already in a queue');
    }
    void this.tick();
    return this.status(playerId);
  }

  async leave(playerId: string) {
    await this.db
      .update(t.matchmakingQueue)
      .set({ status: 'CANCELLED', updatedAt: new Date(this.now()) })
      .where(and(eq(t.matchmakingQueue.playerId, playerId), eq(t.matchmakingQueue.status, 'WAITING')));
  }

  async status(playerId: string): Promise<QueueStatus> {
    const [row] = await this.db
      .select()
      .from(t.matchmakingQueue)
      .where(and(eq(t.matchmakingQueue.playerId, playerId), eq(t.matchmakingQueue.status, 'WAITING')));
    if (!row) return { inQueue: false };
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.matchmakingQueue)
      .where(
        and(
          eq(t.matchmakingQueue.status, 'WAITING'),
          eq(t.matchmakingQueue.stakeTier, row.stakeTier),
          eq(t.matchmakingQueue.timeControl, row.timeControl),
        ),
      );
    return {
      inQueue: true,
      stakeTier: row.stakeTier,
      timeControl: row.timeControl,
      joinedAt: row.joinedAt.getTime(),
      tolerance: ratingTolerance(this.now() - row.joinedAt.getTime(), MATCHMAKING),
      waitingInTier: n,
    };
  }

  /** One matchmaking pass. Pairing + match creation is a single DB transaction. */
  async tick(): Promise<string[]> {
    if (this.ticking) return [];
    this.ticking = true;
    const created: { id: string; white: string; black: string }[] = [];
    const waitingPlayers: string[] = [];
    try {
      await this.db.transaction(async (tx) => {
        const waiting = await tx
          .select()
          .from(t.matchmakingQueue)
          .where(eq(t.matchmakingQueue.status, 'WAITING'))
          .for('update', { skipLocked: true });
        waitingPlayers.push(...waiting.map((w) => w.playerId));
        for (const [a, b] of findPairs(waiting, this.now())) {
          const matchId = randomUUID();
          const [white, black] = randomInt(2) === 0 ? [a, b] : [b, a];
          const tier = stakeTier(a.stakeTier as StakeTierId);
          const tc = timeControl(a.timeControl as TimeControlId);
          const { escrow, vault } = await this.chain.derive(matchId);
          const reserved = await tx
            .update(t.matchmakingQueue)
            .set({ status: 'MATCHED', matchId, updatedAt: new Date(this.now()) })
            .where(and(inArray(t.matchmakingQueue.id, [a.id, b.id]), eq(t.matchmakingQueue.status, 'WAITING')))
            .returning({ id: t.matchmakingQueue.id });
          if (reserved.length !== 2) throw new Error('queue reservation conflict');
          await tx.insert(t.matches).values({
            id: matchId,
            status: 'CREATED',
            stakeTier: tier.id,
            stakeBaseUnits: toBaseUnits(tier.amount),
            timeControl: tc.id,
            initialMs: tc.initialMs,
            incrementMs: tc.incrementMs,
            whitePlayerId: white.playerId,
            blackPlayerId: black.playerId,
            escrowAddress: escrow,
            vaultAddress: vault,
            mint: this.chain.mint,
            adjudicator: this.chain.adjudicator,
            // provisional; replaced by the onchain deadline once the escrow exists
            fundingDeadline: new Date(this.now() + 180_000),
            fen: new Chess().fen(),
            whiteMs: tc.initialMs,
            blackMs: tc.initialMs,
          });
          // The partial unique index on active participants rejects a player in two matches.
          await tx.insert(t.matchParticipants).values([
            { matchId, playerId: white.playerId, color: 'white', wallet: white.wallet },
            { matchId, playerId: black.playerId, color: 'black', wallet: black.wallet },
          ]);
          created.push({ id: matchId, white: white.playerId, black: black.playerId });
        }
      });
    } catch (e) {
      this.log.warn({ err: String(e) }, 'matchmaking tick rolled back');
      created.length = 0;
    } finally {
      this.ticking = false;
    }
    for (const m of created) {
      this.log.info({ matchId: m.id }, 'match created');
      await this.matches.audit('match.paired', { matchId: m.id, white: m.white, black: m.black });
      this.hub.toPlayer(m.white, 'match:found', { matchId: m.id });
      this.hub.toPlayer(m.black, 'match:found', { matchId: m.id });
      this.hub.toPlayer(m.white, 'queue:status', { inQueue: false });
      this.hub.toPlayer(m.black, 'queue:status', { inQueue: false });
      void this.matches.openEscrow(m.id).catch((e) => this.log.error({ matchId: m.id, err: String(e) }, 'openEscrow failed'));
    }
    const pairedIds = new Set(created.flatMap((m) => [m.white, m.black]));
    for (const pid of waitingPlayers) {
      if (!pairedIds.has(pid)) this.hub.toPlayer(pid, 'queue:status', await this.status(pid));
    }
    return created.map((m) => m.id);
  }
}
