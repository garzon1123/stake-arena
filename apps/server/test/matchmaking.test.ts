import { describe, expect, it } from 'vitest';
import { eloUpdate, ratingTolerance, MATCHMAKING } from '@stake-arena/shared';
import { findPairs } from '../src/match/matchmaker.ts';

const NOW = 10_000_000;
let n = 0;
const entry = (o: { elo?: number; tier?: string; tc?: string; waited?: number; player?: string; wallet?: string; status?: string }) => {
  n++;
  return {
    id: `q${n}`,
    playerId: o.player ?? `p${n}`,
    wallet: o.wallet ?? `w${n}`,
    elo: o.elo ?? 1200,
    stakeTier: o.tier ?? 'tier_10',
    timeControl: o.tc ?? 'blitz_3_0',
    status: o.status ?? 'WAITING',
    matchId: null,
    joinedAt: new Date(NOW - (o.waited ?? 0)),
    updatedAt: new Date(NOW),
  };
};

describe('matchmaking', () => {
  it('pairs players in the same tier and time control', () => {
    const a = entry({}), b = entry({});
    expect(findPairs([a, b], NOW)).toEqual([[a, b]]);
  });

  it('does not pair different stake tiers or time controls', () => {
    expect(findPairs([entry({ tier: 'tier_5' }), entry({ tier: 'tier_25' })], NOW)).toEqual([]);
    expect(findPairs([entry({ tc: 'blitz_3_0' }), entry({ tc: 'bullet_1_0' })], NOW)).toEqual([]);
  });

  it('respects the rating tolerance and widens it over time', () => {
    expect(findPairs([entry({ elo: 1200 }), entry({ elo: 1400 })], NOW)).toEqual([]);
    const a = entry({ elo: 1200, waited: 10_000 }), b = entry({ elo: 1400 });
    expect(findPairs([a, b], NOW)).toEqual([[a, b]]);
    expect(ratingTolerance(0, MATCHMAKING)).toBe(150);
    expect(ratingTolerance(10 * 60_000, MATCHMAKING)).toBe(600);
  });

  it('never pairs a player (or wallet) with themselves', () => {
    expect(findPairs([entry({ player: 'same' }), entry({ player: 'same' })], NOW)).toEqual([]);
    expect(findPairs([entry({ wallet: 'W' }), entry({ wallet: 'W' })], NOW)).toEqual([]);
  });

  it('prefers the closest rating and never double-books an entry', () => {
    const a = entry({ elo: 1200, waited: 5000 }), far = entry({ elo: 1340 }), close = entry({ elo: 1210 });
    const pairs = findPairs([a, far, close], NOW);
    expect(pairs).toEqual([[a, close]]);
    const ids = pairs.flat().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('elo', () => {
  it('equal ratings: winner +16, loser -16, draw 0', () => {
    expect(eloUpdate(1200, 1200, 'white')).toMatchObject({ whiteDelta: 16, blackDelta: -16 });
    expect(eloUpdate(1200, 1200, 'draw')).toMatchObject({ whiteDelta: 0, blackDelta: 0 });
  });
  it('upsets move more points', () => {
    const r = eloUpdate(1000, 1400, 'white');
    expect(r.whiteDelta).toBeGreaterThan(16);
    expect(r.whiteDelta + r.blackDelta).toBe(0);
  });
});
