import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DepositSubmit,
  NonceRequest,
  ProfileUpdate,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
  VerifyRequest,
  toBaseUnits,
} from '@stake-arena/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import * as t from '../db/schema.ts';
import type { Matchmaker } from '../match/matchmaker.ts';
import { ServiceError, toPublicPlayer, type MatchService } from '../match/service.ts';
import type { ChainService } from '../solana/chain.ts';
import { SESSION_COOKIE, type AuthService } from './auth.ts';

declare module 'fastify' {
  interface FastifyRequest {
    playerId: string | null;
  }
}

const Uuid = z.object({ id: z.string().uuid() });
const FAUCET_COOLDOWN_MS = 2 * 60_000;

export function registerRoutes(
  app: FastifyInstance,
  deps: { config: Config; db: Db; auth: AuthService; chain: ChainService; matches: MatchService; matchmaker: Matchmaker },
) {
  const { config, db, auth, chain, matches, matchmaker } = deps;
  const secure = config.WEB_ORIGIN.startsWith('https://');

  app.decorateRequest('playerId', null);
  app.addHook('onRequest', async (req) => {
    req.playerId = await auth.playerIdForToken(req.cookies[SESSION_COOKIE]);
  });

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.playerId) return reply.code(401).send({ error: 'Sign in with your wallet first' });
  };

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ServiceError) {
      const status = { not_found: 404, forbidden: 403, conflict: 409 }[err.code] ?? 400;
      return reply.code(status).send({ error: err.message, code: err.code });
    }
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: err.issues[0]?.message ?? 'Invalid request' });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: 'Too many requests, slow down' });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong' });
  });

  app.get('/api/health', async () => {
    await db.select({ one: t.players.id }).from(t.players).limit(1);
    return { ok: true, cluster: chain.cluster };
  });

  app.get('/api/config', async () => ({
    cluster: chain.cluster,
    rpcUrl: config.SOLANA_CLUSTER === 'devnet' ? 'https://api.devnet.solana.com' : config.SOLANA_RPC_URL,
    programId: chain.programId,
    mint: chain.mint,
    adjudicator: chain.adjudicator,
    token: { symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS },
    faucetAmount: config.FAUCET_AMOUNT,
    demoMode: true,
  }));

  // ---------------- auth
  app.post('/api/auth/nonce', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { wallet } = NonceRequest.parse(req.body);
    try {
      return await auth.createNonce(wallet);
    } catch (e) {
      throw new ServiceError((e as Error).message);
    }
  });

  app.post('/api/auth/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = VerifyRequest.parse(req.body);
    let res;
    try {
      res = await auth.verify(body.wallet, body.nonce, body.signature);
    } catch (e) {
      throw new ServiceError((e as Error).message, 'forbidden');
    }
    await matches.audit('auth.sign_in', { playerId: res.player.id, wallet: body.wallet });
    reply.setCookie(SESSION_COOKIE, res.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      expires: res.expiresAt,
    });
    return { player: toPublicPlayer(res.player) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await auth.revoke(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------------- me
  app.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const [p] = await db.select().from(t.players).where(eq(t.players.id, req.playerId!));
    if (!p) throw new ServiceError('Player not found', 'not_found');
    return {
      player: toPublicPlayer(p),
      activeMatchId: await matchmaker.activeMatchId(p.id),
      queue: await matchmaker.status(p.id),
    };
  });

  app.put('/api/me/profile', { preHandler: requireAuth }, async (req) => {
    const body = ProfileUpdate.parse(req.body);
    const [taken] = await db.select({ id: t.players.id }).from(t.players).where(eq(t.players.username, body.username));
    if (taken && taken.id !== req.playerId) throw new ServiceError('That username is taken', 'conflict');
    const [p] = await db
      .update(t.players)
      .set({ username: body.username, avatar: body.avatar, avatarColor: body.avatarColor, bio: body.bio, updatedAt: new Date() })
      .where(eq(t.players.id, req.playerId!))
      .returning();
    return { player: toPublicPlayer(p!) };
  });

  app.get('/api/me/balance', { preHandler: requireAuth }, async (req) => {
    const [p] = await db.select().from(t.players).where(eq(t.players.id, req.playerId!));
    const b = await chain.balances(p!.wallet);
    return { token: b.token.toString(), sol: b.sol.toString(), hasTokenAccount: b.hasTokenAccount };
  });

  app.post(
    '/api/faucet',
    { preHandler: requireAuth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const [p] = await db.select().from(t.players).where(eq(t.players.id, req.playerId!));
      if (!p) throw new ServiceError('Player not found', 'not_found');
      if (p.lastFaucetAt && Date.now() - p.lastFaucetAt.getTime() < FAUCET_COOLDOWN_MS) {
        throw new ServiceError('Faucet cooling down — try again in a couple of minutes');
      }
      const bal = await chain.balances(p.wallet);
      if (bal.token >= toBaseUnits(100)) throw new ServiceError('You already have plenty of test tokens');
      // claim the cooldown before sending so parallel requests cannot double-mint
      const claimed = await db
        .update(t.players)
        .set({ lastFaucetAt: new Date() })
        .where(
          and(
            eq(t.players.id, p.id),
            p.lastFaucetAt ? eq(t.players.lastFaucetAt, p.lastFaucetAt) : isNull(t.players.lastFaucetAt),
          ),
        )
        .returning();
      if (!claimed.length) throw new ServiceError('Faucet request already in progress');
      try {
        const signature = await chain.faucet(p.wallet, toBaseUnits(config.FAUCET_AMOUNT));
        await matches.audit('faucet.mint', { playerId: p.id, signature });
        return { signature };
      } catch (e) {
        await db.update(t.players).set({ lastFaucetAt: p.lastFaucetAt }).where(eq(t.players.id, p.id));
        throw new ServiceError(`Faucet failed: ${(e as Error).message}`);
      }
    },
  );

  // ---------------- public data
  app.get('/api/leaderboard', async () => {
    const rows = await db
      .select()
      .from(t.players)
      .where(isNotNull(t.players.username))
      .orderBy(desc(t.players.elo), desc(t.players.wins))
      .limit(100);
    return { players: rows.map(toPublicPlayer) };
  });

  app.get('/api/players/:id', async (req) => {
    const { id } = Uuid.parse(req.params);
    const [p] = await db.select().from(t.players).where(eq(t.players.id, id));
    if (!p) throw new ServiceError('Player not found', 'not_found');
    const history = await db
      .select()
      .from(t.ratingHistory)
      .where(eq(t.ratingHistory.playerId, id))
      .orderBy(t.ratingHistory.createdAt);
    return { player: toPublicPlayer(p), ratingHistory: history.map((h) => ({ matchId: h.matchId, after: h.after, delta: h.delta, at: h.createdAt })) };
  });

  app.get('/api/players/:id/matches', async (req) => {
    const { id } = Uuid.parse(req.params);
    const rows = await db
      .select({ m: t.matches, r: t.matchResults })
      .from(t.matches)
      .leftJoin(t.matchResults, eq(t.matchResults.matchId, t.matches.id))
      .where(or(eq(t.matches.whitePlayerId, id), eq(t.matches.blackPlayerId, id)))
      .orderBy(desc(t.matches.createdAt))
      .limit(25);
    const ids = [...new Set(rows.flatMap(({ m }) => [m.whitePlayerId, m.blackPlayerId]))];
    const ps = ids.length ? await db.select().from(t.players).where(inArray(t.players.id, ids)) : [];
    const byId = new Map(ps.map((p) => [p.id, toPublicPlayer(p)]));
    const settles = rows.length
      ? await db
          .select()
          .from(t.escrowTransactions)
          .where(and(inArray(t.escrowTransactions.matchId, rows.map(({ m }) => m.id)), eq(t.escrowTransactions.status, 'confirmed')))
      : [];
    return {
      matches: rows.map(({ m, r }) => {
        const color = m.whitePlayerId === id ? 'white' : 'black';
        const opp = byId.get(color === 'white' ? m.blackPlayerId : m.whitePlayerId)!;
        const delta = r ? (color === 'white' ? r.whiteRatingAfter - r.whiteRatingBefore : r.blackRatingAfter - r.blackRatingBefore) : null;
        return {
          id: m.id,
          status: m.status,
          stakeTier: m.stakeTier,
          stakeBaseUnits: m.stakeBaseUnits.toString(),
          timeControl: m.timeControl,
          color,
          opponent: opp,
          result: r ? (r.outcome === 'draw' ? 'draw' : r.outcome === color ? 'win' : 'loss') : null,
          reason: r?.reason ?? null,
          ratingDelta: delta,
          settlementSignature: settles.find((s) => s.matchId === m.id && s.kind === 'settle')?.signature ?? null,
          createdAt: m.createdAt,
        };
      }),
    };
  });

  app.get('/api/matches/:id', async (req) => {
    const { id } = Uuid.parse(req.params);
    return { snapshot: await matches.snapshot(id) };
  });

  // ---------------- escrow funding
  app.post('/api/matches/:id/deposit/prepare', { preHandler: requireAuth }, async (req) => {
    const { id } = Uuid.parse(req.params);
    return matches.prepareDeposit(id, req.playerId!);
  });

  app.post(
    '/api/matches/:id/deposit/submit',
    { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { id } = Uuid.parse(req.params);
      const { transaction } = DepositSubmit.parse(req.body);
      return matches.submitDeposit(id, req.playerId!, transaction);
    },
  );

  app.post('/api/matches/:id/settlement/retry', { preHandler: requireAuth }, async (req) => {
    const { id } = Uuid.parse(req.params);
    await matches.retrySettlement(id);
    return { ok: true };
  });
}
