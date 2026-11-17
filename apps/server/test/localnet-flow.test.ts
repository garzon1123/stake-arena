/**
 * Full-stack integration test against a REAL local Solana validator running the
 * stake_arena program (see README "Testing"). No chain mocks: every escrow
 * instruction is a real transaction. Run with:
 *   LOCALNET=1 npx vitest run test/localnet-flow.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  signBytes,
  type KeyPairSigner,
} from '@solana/kit';
import { eq } from 'drizzle-orm';
import type { ClientToServerEvents, MatchSnapshot, ServerToClientEvents } from '@stake-arena/shared';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { connectTestDb, type Db } from '../src/db/client.ts';
import * as t from '../src/db/schema.ts';
import { createSolanaChain, type ChainService } from '../src/solana/chain.ts';

const root = resolve(import.meta.dirname, '../../..');
const fileEnv = Object.fromEntries(
  readFileSync(resolve(root, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
interface Player {
  kp: KeyPairSigner;
  cookie: string;
  id: string;
  socket: Client;
}

const STAKE = 10_000_000n; // 10 TEST

describe.runIf(process.env.LOCALNET === '1')('localnet end-to-end match', () => {
  let base: string;
  let db: Db;
  let chain: ChainService;
  let closeAll: () => Promise<void>;
  const players: Player[] = [];

  const api = async (path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}) => {
    const res = await fetch(base + path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as any;
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
    return { json, res };
  };

  const waitFor = async (matchId: string, pred: (s: MatchSnapshot) => boolean, ms = 60_000) => {
    const start = Date.now();
    for (;;) {
      const { json } = await api(`/api/matches/${matchId}`);
      if (pred(json.snapshot)) return json.snapshot as MatchSnapshot;
      if (Date.now() - start > ms) throw new Error(`timeout waiting; status=${json.snapshot.status} err=${json.snapshot.settlementError}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  async function signIn(name: string): Promise<Player> {
    const kp = await generateKeyPairSigner();
    const { json: n } = await api('/api/auth/nonce', { body: { wallet: kp.address } });
    const sig = await signBytes(kp.keyPair.privateKey, new TextEncoder().encode(n.message));
    const { res, json } = await api('/api/auth/verify', {
      body: { wallet: kp.address, nonce: n.nonce, signature: Buffer.from(sig).toString('base64') },
    });
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    await api('/api/me/profile', { method: 'PUT', cookie, body: { username: name, avatar: 'knight', avatarColor: 'violet', bio: 'test' } });
    await api('/api/faucet', { method: 'POST', cookie, body: {} });
    const socket: Client = ioClient(base, { extraHeaders: { cookie }, transports: ['websocket'] });
    await new Promise<void>((r, j) => {
      socket.on('connect', () => r());
      socket.on('connect_error', j);
    });
    return { kp, cookie, id: json.player.id, socket };
  }

  beforeAll(async () => {
    const config = loadConfig({ ...fileEnv, NODE_ENV: 'test', PORT: '0', WEB_ORIGIN: 'http://localhost:5173', FUNDING_WINDOW_SECS: '30' });
    expect(config.SOLANA_CLUSTER).toBe('localnet');
    ({ db } = await connectTestDb().then((x) => ((closeAll = x.close), x)));
    chain = await createSolanaChain(config);
    const built = await buildApp(config, db, chain);
    await built.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = built.app.server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;
    built.matches.start();
    built.matchmaker.start();
    const prevClose = closeAll;
    closeAll = async () => {
      built.matchmaker.stop();
      built.matches.stop();
      built.io.close();
      await built.app.close();
      await prevClose();
    };
  }, 60_000);

  afterAll(async () => {
    for (const p of players) p.socket.close();
    await closeAll?.();
  });

  it('pairs, funds escrow, plays Fool\'s mate and settles the pot onchain', async () => {
    players.push(await signIn('alice_test'), await signIn('bob_test'));
    const [a, b] = players as [Player, Player];
    const before = await Promise.all([chain.balances(a.kp.address), chain.balances(b.kp.address)]);
    expect(before[0].token).toBe(100_000_000n);
    expect(before[0].sol).toBe(0n); // players never need SOL: the server sponsors fees

    const found = new Promise<string>((r) => a.socket.once('match:found', (m) => r(m.matchId)));
    for (const p of [a, b]) {
      const ack = await p.socket.emitWithAck('queue:join', { stakeTier: 'tier_10', timeControl: 'blitz_3_0' });
      expect(ack.ok).toBe(true);
    }
    const matchId = await found;

    // A player cannot queue again while the match is in progress.
    const dup = await a.socket.emitWithAck('queue:join', { stakeTier: 'tier_5', timeControl: 'blitz_3_0' });
    expect(dup.ok).toBe(false);

    let snap = await waitFor(matchId, (s) => s.status === 'AWAITING_DEPOSITS');
    expect(snap.createSignature).toBeTruthy();
    const escrowBefore = await chain.fetchEscrow(matchId);
    expect(escrowBefore?.state).toBe('AwaitingDeposits');
    expect(escrowBefore?.stake).toBe(STAKE);

    for (const p of [a, b]) {
      const { json: prep } = await api(`/api/matches/${matchId}/deposit/prepare`, { method: 'POST', cookie: p.cookie, body: {} });
      const tx = getTransactionDecoder().decode(getBase64Encoder().encode(prep.transaction));
      const signed = await partiallySignTransaction([p.kp.keyPair], tx);
      const { json: sub } = await api(`/api/matches/${matchId}/deposit/submit`, {
        method: 'POST',
        cookie: p.cookie,
        body: { transaction: getBase64EncodedWireTransaction(signed) },
      });
      expect(sub.signature).toBeTruthy();
    }

    snap = await waitFor(matchId, (s) => s.status === 'ACTIVE');
    expect(snap.deposits.every((d) => d.status === 'confirmed')).toBe(true);
    expect((await chain.fetchEscrow(matchId))?.state).toBe('Funded');

    const white = snap.white.id === a.id ? a : b;
    const black = white === a ? b : a;
    for (const p of [white, black]) expect((await p.socket.emitWithAck('match:subscribe', { matchId })).ok).toBe(true);

    // Wrong player / illegal move are rejected by the server.
    expect((await black.socket.emitWithAck('match:move', { matchId, ply: 0, from: 'e7', to: 'e5' })).ok).toBe(false);
    expect((await white.socket.emitWithAck('match:move', { matchId, ply: 0, from: 'e2', to: 'e5' })).ok).toBe(false);

    const seen: string[] = [];
    white.socket.on('match:move', (m) => seen.push(m.san));
    const seq: [Player, string, string][] = [
      [white, 'f2', 'f3'],
      [black, 'e7', 'e5'],
      [white, 'g2', 'g4'],
      [black, 'd8', 'h4'],
    ];
    for (const [i, [p, from, to]] of seq.entries()) {
      const ack = await p.socket.emitWithAck('match:move', { matchId, ply: i, from, to });
      expect(ack).toMatchObject({ ok: true, ply: i + 1 });
    }

    snap = await waitFor(matchId, (s) => s.status === 'SETTLED', 90_000);
    expect(snap.outcome).toBe('black');
    expect(snap.endReason).toBe('checkmate');
    expect(snap.settlementSignature).toBeTruthy();
    expect(seen).toContain('Qh4#');

    const esc = await chain.fetchEscrow(matchId);
    expect(esc?.state).toBe('Settled');
    expect(esc?.outcome).toBe(2); // player_two = black

    const after = {
      white: await chain.balances(white.kp.address),
      black: await chain.balances(black.kp.address),
    };
    expect(after.black.token).toBe(100_000_000n + STAKE);
    expect(after.white.token).toBe(100_000_000n - STAKE);

    // Elo applied exactly once.
    const hist = await db.select().from(t.ratingHistory).where(eq(t.ratingHistory.matchId, matchId));
    expect(hist).toHaveLength(2);
    const [bp] = await db.select().from(t.players).where(eq(t.players.id, black.id));
    expect(bp).toMatchObject({ elo: 1216, wins: 1, losses: 0 });

    // Retrying settlement is a no-op (idempotent).
    await api(`/api/matches/${matchId}/settlement/retry`, { method: 'POST', cookie: white.cookie, body: {} });
    await new Promise((r) => setTimeout(r, 2500));
    expect((await chain.balances(black.kp.address)).token).toBe(100_000_000n + STAKE);
    const settles = await db.select().from(t.escrowTransactions).where(eq(t.escrowTransactions.matchId, matchId));
    expect(settles.filter((x) => x.kind === 'settle')).toHaveLength(1);

    // Both players are free to queue again.
    const again = await a.socket.emitWithAck('queue:join', { stakeTier: 'tier_5', timeControl: 'blitz_3_0' });
    expect(again.ok).toBe(true);
    await a.socket.emitWithAck('queue:leave');
  }, 180_000);

  it('cancels an underfunded match after the deadline and refunds the deposit onchain', async () => {
    const c = await signIn('carol_test');
    const d = await signIn('dave_test');
    players.push(c, d);
    const found = new Promise<string>((r) => c.socket.once('match:found', (m) => r(m.matchId)));
    for (const p of [c, d]) {
      expect((await p.socket.emitWithAck('queue:join', { stakeTier: 'tier_25', timeControl: 'bullet_1_0' })).ok).toBe(true);
    }
    const matchId = await found;
    await waitFor(matchId, (s) => s.status === 'AWAITING_DEPOSITS');

    // Only carol funds.
    const { json: prep } = await api(`/api/matches/${matchId}/deposit/prepare`, { method: 'POST', cookie: c.cookie, body: {} });
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(prep.transaction));
    const signed = await partiallySignTransaction([c.kp.keyPair], tx);
    await api(`/api/matches/${matchId}/deposit/submit`, { method: 'POST', cookie: c.cookie, body: { transaction: getBase64EncodedWireTransaction(signed) } });
    expect((await chain.balances(c.kp.address)).token).toBe(100_000_000n - 25_000_000n);

    // A player cannot move before the match is funded.
    const early = await c.socket.emitWithAck('match:move', { matchId, ply: 0, from: 'e2', to: 'e4' });
    expect(early.ok).toBe(false);

    const snap = await waitFor(matchId, (s) => s.status === 'CANCELLED' && !!s.refundSignature, 90_000);
    expect(snap.refundSignature).toBeTruthy();
    expect((await chain.fetchEscrow(matchId))?.state).toBe('Cancelled');
    expect((await chain.balances(c.kp.address)).token).toBe(100_000_000n);
    expect((await chain.balances(d.kp.address)).token).toBe(100_000_000n);

    // Both are free again; no rating change for a cancelled match.
    const [cp] = await db.select().from(t.players).where(eq(t.players.id, c.id));
    expect(cp).toMatchObject({ elo: 1200, wins: 0, losses: 0 });
    expect((await c.socket.emitWithAck('queue:join', { stakeTier: 'tier_5', timeControl: 'blitz_3_0' })).ok).toBe(true);
    await c.socket.emitWithAck('queue:leave');
  }, 150_000);
});
