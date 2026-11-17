import { describe, expect, it } from 'vitest';
import { ChessGame } from '../src/game/engine.ts';

const T0 = 1_000_000;
const newGame = (initialMs = 180_000) => {
  const g = new ChessGame({ initialMs, incrementMs: 0 });
  g.start(T0);
  return g;
};

/** Plays SAN-free coordinate moves alternating colors, 1s apart. */
function play(g: ChessGame, moves: string[], start = T0) {
  let now = start;
  for (const mv of moves) {
    now += 1000;
    const color = g.turn();
    const r = g.move(color, g.ply, mv.slice(0, 2), mv.slice(2, 4), mv[4], now);
    if (!r.ok) throw new Error(`${mv}: ${r.error}`);
  }
  return now;
}

describe('ChessGame (server-authoritative rules)', () => {
  it('accepts a legal move and updates the position', () => {
    const g = newGame();
    const r = g.move('white', 0, 'e2', 'e4', undefined, T0 + 1500);
    expect(r).toMatchObject({ ok: true, ply: 1, san: 'e4' });
    expect(g.turn()).toBe('black');
    expect(g.whiteMs).toBe(180_000 - 1500);
  });

  it('rejects illegal moves', () => {
    const g = newGame();
    expect(g.move('white', 0, 'e2', 'e5', undefined, T0 + 1)).toEqual({ ok: false, error: 'Illegal move' });
    expect(g.ply).toBe(0);
  });

  it('rejects moves by the wrong player / out of turn', () => {
    const g = newGame();
    expect(g.move('black', 0, 'e7', 'e5', undefined, T0 + 1)).toEqual({ ok: false, error: 'Not your turn' });
  });

  it('rejects out-of-sequence (replayed) moves', () => {
    const g = newGame();
    play(g, ['e2e4']);
    expect(g.move('black', 0, 'e7', 'e5', undefined, T0 + 5000)).toEqual({ ok: false, error: 'Out-of-sequence move' });
  });

  it("detects Fool's mate as checkmate for black", () => {
    const g = newGame();
    play(g, ['f2f3', 'e7e5', 'g2g4']);
    const r = g.move('black', 3, 'd8', 'h4', undefined, T0 + 10_000);
    expect(r).toMatchObject({ ok: true, san: 'Qh4#', end: { outcome: 'black', reason: 'checkmate' } });
    expect(g.move('white', 4, 'e2', 'e4', undefined, T0 + 11_000)).toEqual({ ok: false, error: 'Game is over' });
  });

  it('detects stalemate', () => {
    // Known shortest stalemate (Sam Loyd, 10 moves)
    const g = newGame();
    const end = play(g, ['e2e3', 'a7a5', 'd1h5', 'a8a6', 'h5a5', 'h7h5', 'h2h4', 'a6h6', 'a5c7', 'f7f6', 'c7d7', 'e8f7', 'd7b7', 'd8d3', 'b7b8', 'd3h7', 'b8c8', 'f7g6']);
    const r = g.move('white', g.ply, 'c8', 'e6', undefined, end + 1000);
    expect(r).toMatchObject({ ok: true, end: { outcome: 'draw', reason: 'stalemate' } });
  });

  it('detects threefold repetition', () => {
    const g = newGame();
    const end = play(g, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1']);
    const r = g.move('black', g.ply, 'f6', 'g8', undefined, end + 1000);
    expect(r).toMatchObject({ ok: true, end: { outcome: 'draw', reason: 'threefold_repetition' } });
  });

  it('detects insufficient material after a capture', () => {
    const g = new ChessGame({ initialMs: 60_000, incrementMs: 0 });
    g.chess.load('8/8/8/4k3/8/8/3p4/3NK3 w - - 0 1'); // black pawn on d2 checks the white king
    g.start(T0);
    const r = g.move('white', 0, 'e1', 'd2', undefined, T0 + 10); // Kxd2 leaves K+N vs K
    expect(r).toMatchObject({ ok: true, san: 'Kxd2', end: { outcome: 'draw', reason: 'insufficient_material' } });
  });

  it('handles promotion', () => {
    const g = new ChessGame({ initialMs: 60_000, incrementMs: 0 });
    g.chess.load('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    g.start(T0);
    const r = g.move('white', 0, 'a7', 'a8', 'q', T0 + 10);
    expect(r).toMatchObject({ ok: true, san: 'a8=Q' });
  });

  it('handles castling and en passant', () => {
    const g = newGame();
    play(g, ['e2e4', 'a7a6', 'e4e5', 'd7d5']);
    const ep = g.move('white', 4, 'e5', 'd6', undefined, T0 + 6000);
    expect(ep).toMatchObject({ ok: true, san: 'exd6' });
    const g2 = newGame();
    play(g2, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6']);
    expect(g2.move('white', 6, 'e1', 'g1', undefined, T0 + 8000)).toMatchObject({ ok: true, san: 'O-O' });
  });

  it('flags on time: the side to move loses when the opponent can mate', () => {
    const g = newGame(60_000);
    play(g, ['e2e4']); // black to move at T0+1000
    expect(g.checkTimeout(T0 + 1000 + 59_999)).toBeNull();
    expect(g.checkTimeout(T0 + 1000 + 60_000)).toEqual({ outcome: 'white', reason: 'timeout' });
  });

  it('timeout against bare king is a draw', () => {
    const g = new ChessGame({ initialMs: 1000, incrementMs: 0 });
    g.chess.load('8/8/8/4k3/8/8/4P3/4K3 b - - 0 1');
    g.start(T0);
    // white has a pawn: black flagging loses
    expect(g.checkTimeout(T0 + 1000)).toEqual({ outcome: 'white', reason: 'timeout' });
    const g2 = new ChessGame({ initialMs: 1000, incrementMs: 0 });
    g2.chess.load('8/8/8/4k3/8/8/4p3/4K3 w - - 0 1');
    g2.start(T0);
    // white flags, but black (K+P) can still mate -> black wins; reverse with bare king:
    expect(g2.checkTimeout(T0 + 1000)).toEqual({ outcome: 'black', reason: 'timeout' });
    const g3 = new ChessGame({ initialMs: 1000, incrementMs: 0 });
    g3.chess.load('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1');
    g3.start(T0);
    expect(g3.checkTimeout(T0 + 1000)).toEqual({ outcome: 'draw', reason: 'insufficient_material' });
  });

  it('a move submitted after the flag fell ends the game on time', () => {
    const g = newGame(5000);
    const r = g.move('white', 0, 'e2', 'e4', undefined, T0 + 5001);
    expect(r).toMatchObject({ ok: false, error: 'Time expired', end: { outcome: 'black', reason: 'timeout' } });
  });

  it('resignation awards the opponent', () => {
    const g = newGame();
    expect(g.resign('white')).toEqual({ outcome: 'black', reason: 'resignation' });
  });

  it('restores identical state from persisted moves (reconnect / restart)', () => {
    const g = newGame();
    play(g, ['e2e4', 'e7e5', 'g1f3']);
    const restored = new ChessGame({
      initialMs: 180_000,
      incrementMs: 0,
      moves: g.history().map((m) => ({ from: m.from, to: m.to })),
      whiteMs: g.whiteMs,
      blackMs: g.blackMs,
      turnStartedAt: g.turnStartedAt,
    });
    expect(restored.fen).toBe(g.fen);
    expect(restored.turn()).toBe('black');
    expect(restored.remaining('black', T0 + 10_000)).toBe(g.remaining('black', T0 + 10_000));
  });
});
