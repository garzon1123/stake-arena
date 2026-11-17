import { resolve } from 'node:path';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof drizzlePg<typeof schema>>;

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');

export async function connectDb(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzlePg(pool, { schema });
  return { db, close: () => pool.end() };
}

export async function runMigrations(db: Db) {
  await migratePg(db, { migrationsFolder });
}

/** In-memory Postgres (PGlite) for tests. Same schema and migrations as production. */
export async function connectTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  // PGlite's drizzle type is structurally compatible with node-postgres for our usage.
  return { db: db as unknown as Db, close: () => client.close() };
}
