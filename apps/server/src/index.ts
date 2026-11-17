import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { connectDb, runMigrations } from './db/client.ts';
import { createSolanaChain } from './solana/chain.ts';

const config = loadConfig();
const { db, close } = await connectDb(config.DATABASE_URL);
await runMigrations(db);
const chain = await createSolanaChain(config);
const { app, io, matches, matchmaker } = await buildApp(config, db, chain);

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(
  { cluster: chain.cluster, programId: chain.programId, mint: chain.mint, adjudicator: chain.adjudicator },
  'STAKE Arena server ready (DEMO MODE — test tokens only)',
);
await matches.recover();
matches.start();
matchmaker.start();

const shutdown = async () => {
  matchmaker.stop();
  matches.stop();
  io.close();
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
