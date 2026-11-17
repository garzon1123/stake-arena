/**
 * Database-level guards (in-memory Postgres via PGlite, real migrations).
 * The ChainService here is a STUB: these tests cover auth and matchmaking only,
 * no escrow behaviour. Escrow is covered by the Anchor tests and localnet-flow.test.ts.
 */
import { generateKeyPairSigner, signBytes } from '@solana/kit';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb, type Db } from '../src/db/client.ts';
import * as t from '../src/db/schema.ts';
import { AuthService } from '../src/http/auth.ts';
import { Matchmaker } from '../src/match/matchmaker.ts';
import { MatchService, type Hub } from '../src/match/service.ts';
import type { ChainService } from '../src/solana/chain.ts';

const silent = { info() {}, warn() {}, error() {} };
const hub: Hub = { toPlayer() {}, toMatch() {} };
const stubChain = {
  cluster: 'stub',
  programId: 'stub',
  mint: 'StubMint1111111111111111111111111111111111',
  adjudicator: 'StubAdj11111111111111111111111111111111111',
  derive: async (id: string) => ({ escrow: `escrow-${id}`, vault: `vault-${id}` }),
} as unknown as ChainService;

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await connectTestDb());
});
afterEach(async () => close());

describe('wallet auth', () => {
  it('accepts a valid signature once and rejects nonce replay', async () => {
    const auth = new AuthService(db, 'http://localhost:5173');
    const kp = await generateKeyPairSigner();
    const { nonce, message } = await auth.createNonce(kp.address);
    expect(message).toContain(kp.address);
    expect(message).toContain(nonce);
    const sig = Buffer.from(await signBytes(kp.keyPair.privateKey, new TextEncoder().encode(message))).toString('base64');
    const res = await auth.verify(kp.address, nonce, sig);
    expect(res.player.wallet).toBe(kp.address);
    expect(await auth.playerIdForToken(res.token)).toBe(res.player.id);
    await expect(auth.verify(kp.address, nonce, sig)).rejects.toThrow(/expired or already used/);
  });

  it('rejects a signature from a different wallet', async () => {
    const auth = new AuthService(db, 'http://localhost:5173');
    const victim = await generateKeyPairSigner();
    const attacker = await generateKeyPairSigner();
    const { nonce, message } = await auth.createNonce(victim.address);
    const sig = Buffer.from(await signBytes(attacker.keyPair.privateKey, new TextEncoder().encode(message))).toString('base64');
    await expect(auth.verify(victim.address, nonce, sig)).rejects.toThrow(/verification failed/);
  });

  it('revoked sessions stop authenticating', async () => {
    const auth = new AuthService(db, 'http://localhost:5173');
    const kp = await generateKeyPairSigner();
    const { nonce, message } = await auth.createNonce(kp.address);
    const sig = Buffer.from(await signBytes(kp.keyPair.privateKey, new TextEncoder().encode(message))).toString('base64');
    const { token } = await auth.verify(kp.address, nonce, sig);
    await auth.revoke(token);
    expect(await auth.playerIdForToken(token)).toBeNull();
  });
});

describe('matchmaking (database guards)', () => {
  async function player(name: string, elo = 1200) {
    const [p] = await db.insert(t.players).values({ wallet: `W_${name}`, username: name, elo }).returning();
    return p!;
  }
  const mm = () => {
    const matches = new MatchService(db, stubChain, hub, silent);
    // escrow opening is out of scope for this test
    matches.openEscrow = async () => {};
    return new Matchmaker(db, stubChain, matches, hub, silent);
  };

  it('concurrent ticks (even from two matchmaker instances) create exactly one match', async () => {
    const [a, b] = [await player('a'), await player('b')];
    const m1 = mm();
    const m2 = mm();
    await m1.join(a.id, { stakeTier: 'tier_10', timeControl: 'blitz_3_0' });
    await m2.join(b.id, { stakeTier: 'tier_10', timeControl: 'blitz_3_0' });
    await Promise.all([m1.tick(), m1.tick(), m2.tick(), m2.tick()]);
    const all = await db.select().from(t.matches);
    expect(all).toHaveLength(1);
    const parts = await db.select().from(t.matchParticipants);
    expect(parts.map((p) => p.playerId).sort()).toEqual([a.id, b.id].sort());
  });

  it('a player cannot hold two waiting queue entries or queue during a match', async () => {
    const [a, b] = [await player('a'), await player('b')];
    const m = mm();
    await m.join(a.id, { stakeTier: 'tier_5', timeControl: 'blitz_3_0' });
    await expect(m.join(a.id, { stakeTier: 'tier_25', timeControl: 'blitz_3_0' })).rejects.toThrow(/already in a queue/);
    await m.join(b.id, { stakeTier: 'tier_5', timeControl: 'blitz_3_0' });
    await m.tick();
    await expect(m.join(a.id, { stakeTier: 'tier_5', timeControl: 'blitz_3_0' })).rejects.toThrow(/match in progress/);
  });

  it('cancelled queue entries are never matched', async () => {
    const [a, b] = [await player('a'), await player('b')];
    const m = mm();
    await m.join(a.id, { stakeTier: 'tier_10', timeControl: 'blitz_3_0' });
    await m.leave(a.id);
    await m.join(b.id, { stakeTier: 'tier_10', timeControl: 'blitz_3_0' });
    expect(await m.tick()).toEqual([]);
    const [row] = await db.select().from(t.matchmakingQueue).where(eq(t.matchmakingQueue.playerId, a.id));
    expect(row?.status).toBe('CANCELLED');
  });

  it('players without a profile cannot queue', async () => {
    const [p] = await db.insert(t.players).values({ wallet: 'W_anon' }).returning();
    await expect(mm().join(p!.id, { stakeTier: 'tier_10', timeControl: 'blitz_3_0' })).rejects.toThrow(/profile/);
  });
});
