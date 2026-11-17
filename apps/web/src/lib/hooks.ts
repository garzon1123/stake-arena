import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchSnapshot, QueueStatus } from '@stake-arena/shared';
import { useSession } from '../wallet/WalletContext';
import { api } from './api';
import { getSocket } from './socket';

export function useSignedIn() {
  const { me, needsSignIn } = useSession();
  return !!me && !needsSignIn;
}

export function useBalance() {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: ['balance'],
    queryFn: () => api<{ token: string; sol: string; hasTokenAccount: boolean }>('/api/me/balance'),
    enabled: signedIn,
    refetchInterval: 10_000,
  });
}

/** Live match state: REST snapshot + socket subscription, re-synced on every reconnect. */
export function useMatch(matchId: string | undefined) {
  const signedIn = useSignedIn();
  const qc = useQueryClient();
  const [snap, setSnap] = useState<MatchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  /** serverNow - clientNow, so clocks render against the server's timeline */
  const skew = useRef(0);

  const accept = useCallback((s: MatchSnapshot) => {
    skew.current = s.serverNow - Date.now();
    setSnap(s);
  }, []);

  useEffect(() => {
    if (!matchId) return;
    let alive = true;
    api<{ snapshot: MatchSnapshot }>(`/api/matches/${matchId}`)
      .then((r) => alive && accept(r.snapshot))
      .catch((e) => alive && setError((e as Error).message));
    if (!signedIn) return () => void (alive = false);

    const s = getSocket();
    const subscribe = () =>
      s.emit('match:subscribe', { matchId }, (r) => {
        if (!alive) return;
        if (r.ok) accept(r.snapshot);
        else setError(r.error);
      });
    const onState = (m: MatchSnapshot) => {
      if (m.id !== matchId) return;
      accept(m);
      if (['SETTLED', 'SETTLEMENT_PENDING', 'CANCELLED', 'REFUNDED'].includes(m.status)) {
        void qc.invalidateQueries({ queryKey: ['me'] });
        void qc.invalidateQueries({ queryKey: ['balance'] });
      }
    };
    const onMove: Parameters<typeof s.on<'match:move'>>[1] = (m) => {
      if (m.matchId !== matchId) return;
      skew.current = m.serverNow - Date.now();
      setSnap((prev) => {
        if (!prev || m.ply !== prev.moves.length + 1) {
          subscribe(); // gap detected: resync from server
          return prev;
        }
        return {
          ...prev,
          fen: m.fen,
          whiteMs: m.whiteMs,
          blackMs: m.blackMs,
          turnStartedAt: m.turnStartedAt,
          turn: m.ply % 2 === 0 ? 'white' : 'black',
          drawOfferBy: null,
          moves: [...prev.moves, { ply: m.ply, san: m.san, from: m.from, to: m.to, color: m.ply % 2 === 1 ? 'white' : 'black' }],
        };
      });
    };
    const onPresence = (p: { matchId: string; white: boolean; black: boolean }) =>
      p.matchId === matchId && setSnap((prev) => (prev ? { ...prev, connected: { white: p.white, black: p.black } } : prev));
    const onDraw = (p: { matchId: string; by: 'white' | 'black' | null }) =>
      p.matchId === matchId && setSnap((prev) => (prev ? { ...prev, drawOfferBy: p.by } : prev));
    const onConnect = () => {
      setConnected(true);
      subscribe();
    };
    const onDisconnect = () => setConnected(false);

    s.on('match:state', onState);
    s.on('match:move', onMove);
    s.on('match:presence', onPresence);
    s.on('match:drawOffer', onDraw);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    if (s.connected) subscribe();
    setConnected(s.connected);
    return () => {
      alive = false;
      s.off('match:state', onState);
      s.off('match:move', onMove);
      s.off('match:presence', onPresence);
      s.off('match:drawOffer', onDraw);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, [matchId, signedIn, accept, qc]);

  return { snap, setSnap, error, connected, skew };
}

export function useQueueStatus() {
  const { me } = useSession();
  const [status, setStatus] = useState<QueueStatus>(me?.queue ?? { inQueue: false });
  useEffect(() => {
    if (me?.queue) setStatus(me.queue);
  }, [me?.queue]);
  useEffect(() => {
    const s = getSocket();
    const on = (q: QueueStatus) => setStatus(q);
    s.on('queue:status', on);
    return () => void s.off('queue:status', on);
  }, []);
  return [status, setStatus] as const;
}

/** Re-renders on an interval (for clocks / countdowns). */
export function useNow(intervalMs = 200) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
