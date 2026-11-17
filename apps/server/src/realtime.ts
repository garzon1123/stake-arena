import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import {
  MatchAction,
  MoveSubmit,
  QueueJoin,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@stake-arena/shared';
import { parseCookie, SESSION_COOKIE, type AuthService } from './http/auth.ts';
import type { Matchmaker } from './match/matchmaker.ts';
import { ServiceError, type Hub, type Logger, type MatchService } from './match/service.ts';

type IO = Server<ClientToServerEvents, ServerToClientEvents, object, { playerId: string }>;
type S = Socket<ClientToServerEvents, ServerToClientEvents, object, { playerId: string }>;

export function createHub(): Hub & { attach(io: IO): void } {
  let io: IO | null = null;
  return {
    attach(i) {
      io = i;
    },
    toPlayer(playerId, event, ...args) {
      io?.to(`player:${playerId}`).emit(event, ...args);
    },
    toMatch(matchId, event, ...args) {
      io?.to(`match:${matchId}`).emit(event, ...args);
    },
  };
}

const errMsg = (e: unknown) =>
  e instanceof ServiceError ? e.message : e instanceof z.ZodError ? 'Invalid request' : 'Something went wrong';

export function createRealtime(
  server: HttpServer,
  deps: { origin: string; auth: AuthService; matches: MatchService; matchmaker: Matchmaker; hub: ReturnType<typeof createHub>; log: Logger },
) {
  const { auth, matches, matchmaker, hub, log } = deps;
  const io: IO = new Server(server, {
    cors: { origin: deps.origin, credentials: true },
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
  hub.attach(io);

  // Authenticate the handshake with the same httpOnly session cookie as REST.
  io.use(async (socket, next) => {
    const token = parseCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
    const playerId = await auth.playerIdForToken(token).catch(() => null);
    if (!playerId) return next(new Error('unauthorized'));
    socket.data.playerId = playerId;
    next();
  });

  io.on('connection', (socket: S) => {
    const playerId = socket.data.playerId;
    void socket.join(`player:${playerId}`);
    const watching = new Map<string, 'white' | 'black' | null>();

    // Simple per-socket token bucket: 20 events burst, refills 10/s.
    let tokens = 20;
    let last = Date.now();
    const allow = () => {
      const now = Date.now();
      tokens = Math.min(20, tokens + ((now - last) / 1000) * 10);
      last = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };

    const handle =
      <P, R extends object>(schema: z.ZodType<P> | null, fn: (p: P) => Promise<R>) =>
      async (raw: unknown, ack?: (r: Ack<R>) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!allow()) return reply({ ok: false, error: 'Rate limited' });
        try {
          const p = schema ? schema.parse(raw) : (raw as P);
          reply({ ok: true, ...(await fn(p)) });
        } catch (e) {
          if (!(e instanceof ServiceError)) log.error({ err: String(e), playerId }, 'socket handler error');
          reply({ ok: false, error: errMsg(e) });
        }
      };

    socket.on('queue:join', handle(QueueJoin, async (p) => ({ status: await matchmaker.join(playerId, p) })));
    socket.on('queue:leave', (ack) =>
      void handle(null, async () => {
        await matchmaker.leave(playerId);
        socket.emit('queue:status', { inQueue: false });
        return {};
      })(undefined, ack),
    );

    socket.on(
      'match:subscribe',
      handle(z.object({ matchId: z.string().uuid() }), async ({ matchId }) => {
        const snapshot = await matches.snapshot(matchId);
        if (!watching.has(matchId)) {
          await socket.join(`match:${matchId}`);
          const color = snapshot.white.id === playerId ? 'white' : snapshot.black.id === playerId ? 'black' : null;
          watching.set(matchId, color);
          if (color) matches.setPresence(matchId, color, 1);
        }
        return { snapshot: await matches.snapshot(matchId) };
      }),
    );
    socket.on('match:move', handle(MoveSubmit, (p) => matches.move(playerId, p)));
    socket.on('match:resign', handle(MatchAction, async (p) => (await matches.resign(playerId, p.matchId), {})));
    socket.on('match:offerDraw', handle(MatchAction, async (p) => (await matches.offerDraw(playerId, p.matchId), {})));
    socket.on(
      'match:respondDraw',
      handle(MatchAction.extend({ accept: z.boolean() }), async (p) => (await matches.respondDraw(playerId, p.matchId, p.accept), {})),
    );

    socket.on('disconnect', () => {
      for (const [matchId, color] of watching) if (color) matches.setPresence(matchId, color, -1);
    });
  });

  return io;
}
