import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { AuthService } from './http/auth.ts';
import { registerRoutes } from './http/routes.ts';
import { Matchmaker } from './match/matchmaker.ts';
import { MatchService } from './match/service.ts';
import { createHub, createRealtime } from './realtime.ts';
import type { ChainService } from './solana/chain.ts';

export async function buildApp(config: Config, db: Db, chain: ChainService) {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info' },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  await app.register(cookie);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  const hub = createHub();
  const log = app.log;
  const auth = new AuthService(db, config.WEB_ORIGIN);
  const matches = new MatchService(db, chain, hub, log);
  const matchmaker = new Matchmaker(db, chain, matches, hub, log);
  registerRoutes(app, { config, db, auth, chain, matches, matchmaker });

  // In production the server also serves the built web app (single origin => simple cookies & websockets).
  const webDist = resolve(config.repoRoot, 'apps/web/dist');
  if (config.NODE_ENV === 'production' && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/socket.io/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  await app.ready();
  const io = createRealtime(app.server, { origin: config.WEB_ORIGIN, auth, matches, matchmaker, hub, log });
  return { app, io, matches, matchmaker, auth };
}
