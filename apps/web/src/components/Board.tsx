import { Chess, type Square } from 'chess.js';
import { useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';

export const BOARD_THEME = {
  light: '#d9d3ec',
  dark: '#6c62a3',
  lastMove: 'rgb(245 185 74 / 0.42)',
  selected: 'rgb(139 124 255 / 0.55)',
  check: 'radial-gradient(circle, rgb(242 85 90 / 0.95) 0%, rgb(242 85 90 / 0.45) 45%, transparent 75%)',
};

export function Board({
  fen,
  orientation = 'white',
  myColor,
  interactive = false,
  lastMove,
  onMove,
  id = 'arena-board',
}: {
  fen: string;
  orientation?: 'white' | 'black';
  myColor?: 'white' | 'black';
  interactive?: boolean;
  lastMove?: { from: string; to: string } | null;
  /** return false to reject the move locally */
  onMove?: (from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n') => boolean;
  id?: string;
}) {
  const [selected, setSelected] = useState<Square | null>(null);
  const game = useMemo(() => {
    const c = new Chess();
    try {
      c.load(fen);
    } catch {
      /* keep start position */
    }
    return c;
  }, [fen]);
  const myTurn = interactive && !!myColor && game.turn() === myColor[0];

  const tryMove = (from: string, to: string) => {
    if (!myTurn || !onMove) return false;
    const legal = game.moves({ square: from as Square, verbose: true }).find((m) => m.to === to);
    if (!legal) return false;
    // Blitz convention: auto-promote to a queen.
    return onMove(from, to, legal.isPromotion() ? 'q' : undefined);
  };

  const squareStyles = useMemo(() => {
    const st: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      st[lastMove.from] = { background: BOARD_THEME.lastMove };
      st[lastMove.to] = { background: BOARD_THEME.lastMove };
    }
    if (game.isCheck()) {
      const kingSq = game
        .board()
        .flat()
        .find((p) => p && p.type === 'k' && p.color === game.turn())?.square;
      if (kingSq) st[kingSq] = { ...st[kingSq], backgroundImage: BOARD_THEME.check };
    }
    if (selected) {
      st[selected] = { background: BOARD_THEME.selected };
      for (const m of game.moves({ square: selected, verbose: true })) {
        st[m.to] = {
          ...st[m.to],
          backgroundImage: m.captured
            ? 'radial-gradient(circle, transparent 58%, rgb(20 16 40 / 0.45) 60%)'
            : 'radial-gradient(circle, rgb(20 16 40 / 0.42) 18%, transparent 20%)',
        };
      }
    }
    return st;
  }, [lastMove, selected, game]);

  return (
    <div className="relative aspect-square w-full select-none overflow-hidden rounded-xl ring-1 ring-white/10 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)]">
      <Chessboard
        options={{
          id,
          position: fen,
          boardOrientation: orientation,
          allowDragging: myTurn,
          animationDurationInMs: 180,
          showNotation: true,
          lightSquareStyle: { backgroundColor: BOARD_THEME.light },
          darkSquareStyle: { backgroundColor: BOARD_THEME.dark },
          darkSquareNotationStyle: { color: BOARD_THEME.light, fontWeight: 600, fontSize: 11 },
          lightSquareNotationStyle: { color: BOARD_THEME.dark, fontWeight: 600, fontSize: 11 },
          squareStyles,
          canDragPiece: ({ piece }) => myTurn && piece.pieceType[0] === myColor?.[0],
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            setSelected(null);
            return !!targetSquare && tryMove(sourceSquare, targetSquare);
          },
          onSquareClick: ({ square, piece }) => {
            if (!myTurn) return;
            if (selected && selected !== square && tryMove(selected, square)) {
              setSelected(null);
              return;
            }
            setSelected(piece && piece.pieceType[0] === myColor?.[0] ? (square as Square) : null);
          },
        }}
      />
    </div>
  );
}
