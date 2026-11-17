import { Chess } from 'chess.js';
import type { Color, GameEndReason, Outcome } from '@stake-arena/shared';

export interface GameEnd {
  outcome: Outcome;
  reason: GameEndReason;
}

export interface StoredMove {
  from: string;
  to: string;
  promotion?: string | null;
}

export type MoveResult =
  | { ok: true; ply: number; san: string; fen: string; end: GameEnd | null }
  | { ok: false; error: string; end?: GameEnd };

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/**
 * Server-authoritative game state: chess rules via chess.js plus a wall-clock chess clock.
 * The clock only advances for the side to move; `turnStartedAt` is the authoritative
 * timestamp at which the current side's clock started running.
 */
export class ChessGame {
  readonly chess: Chess;
  whiteMs: number;
  blackMs: number;
  turnStartedAt: number | null;
  readonly incrementMs: number;
  ended: GameEnd | null = null;

  constructor(opts: {
    initialMs: number;
    incrementMs: number;
    moves?: StoredMove[];
    whiteMs?: number;
    blackMs?: number;
    turnStartedAt?: number | null;
  }) {
    this.chess = new Chess();
    for (const m of opts.moves ?? []) {
      this.chess.move({ from: m.from, to: m.to, promotion: m.promotion ?? undefined });
    }
    this.whiteMs = opts.whiteMs ?? opts.initialMs;
    this.blackMs = opts.blackMs ?? opts.initialMs;
    this.turnStartedAt = opts.turnStartedAt ?? null;
    this.incrementMs = opts.incrementMs;
  }

  get ply(): number {
    return this.chess.history().length;
  }

  get fen(): string {
    return this.chess.fen();
  }

  turn(): Color {
    return this.chess.turn() === 'w' ? 'white' : 'black';
  }

  start(now: number) {
    if (this.turnStartedAt === null) this.turnStartedAt = now;
  }

  /** Remaining time for `color` as of `now`, accounting for the running clock. */
  remaining(color: Color, now: number): number {
    const base = color === 'white' ? this.whiteMs : this.blackMs;
    if (this.turnStartedAt === null || this.ended || this.turn() !== color) return base;
    return base - (now - this.turnStartedAt);
  }

  /** Detects flag fall. A side that flags loses unless the opponent cannot possibly mate. */
  checkTimeout(now: number): GameEnd | null {
    if (this.ended || this.turnStartedAt === null) return null;
    const side = this.turn();
    if (this.remaining(side, now) > 0) return null;
    if (side === 'white') this.whiteMs = 0;
    else this.blackMs = 0;
    const winner = other(side);
    this.ended = this.hasMatingMaterial(winner)
      ? { outcome: winner, reason: 'timeout' }
      : { outcome: 'draw', reason: 'insufficient_material' };
    return this.ended;
  }

  move(color: Color, expectedPly: number, from: string, to: string, promotion: string | undefined, now: number): MoveResult {
    if (this.ended) return { ok: false, error: 'Game is over' };
    if (this.turnStartedAt === null) return { ok: false, error: 'Game has not started' };
    if (expectedPly !== this.ply) return { ok: false, error: 'Out-of-sequence move' };
    if (this.turn() !== color) return { ok: false, error: 'Not your turn' };
    const flagged = this.checkTimeout(now);
    if (flagged) return { ok: false, error: 'Time expired', end: flagged };

    let san: string;
    try {
      san = this.chess.move({ from, to, promotion }).san;
    } catch {
      return { ok: false, error: 'Illegal move' };
    }
    const spent = now - this.turnStartedAt;
    if (color === 'white') this.whiteMs = this.whiteMs - spent + this.incrementMs;
    else this.blackMs = this.blackMs - spent + this.incrementMs;
    this.turnStartedAt = now;
    this.ended = this.detectEnd(color);
    return { ok: true, ply: this.ply, san, fen: this.fen, end: this.ended };
  }

  resign(color: Color): GameEnd {
    this.freezeClock(Date.now());
    this.ended = { outcome: other(color), reason: 'resignation' };
    return this.ended;
  }

  agreeDraw(): GameEnd {
    this.freezeClock(Date.now());
    this.ended = { outcome: 'draw', reason: 'draw_agreement' };
    return this.ended;
  }

  private freezeClock(now: number) {
    if (this.turnStartedAt === null) return;
    const side = this.turn();
    const left = Math.max(0, this.remaining(side, now));
    if (side === 'white') this.whiteMs = left;
    else this.blackMs = left;
  }

  private detectEnd(mover: Color): GameEnd | null {
    const c = this.chess;
    if (c.isCheckmate()) return { outcome: mover, reason: 'checkmate' };
    if (c.isStalemate()) return { outcome: 'draw', reason: 'stalemate' };
    if (c.isInsufficientMaterial()) return { outcome: 'draw', reason: 'insufficient_material' };
    if (c.isThreefoldRepetition()) return { outcome: 'draw', reason: 'threefold_repetition' };
    if (c.isDrawByFiftyMoves()) return { outcome: 'draw', reason: 'fifty_move_rule' };
    return null;
  }

  /** False only for a bare king or king + a single minor piece. */
  hasMatingMaterial(color: Color): boolean {
    const code = color === 'white' ? 'w' : 'b';
    let minors = 0;
    for (const row of this.chess.board()) {
      for (const sq of row) {
        if (!sq || sq.color !== code || sq.type === 'k') continue;
        if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') return true;
        minors++;
      }
    }
    return minors >= 2;
  }

  history() {
    return this.chess.history({ verbose: true }).map((m, i) => ({
      ply: i + 1,
      san: m.san,
      from: m.from,
      to: m.to,
      color: (m.color === 'w' ? 'white' : 'black') as Color,
    }));
  }
}
