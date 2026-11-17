import { loadConfig } from '../config.ts';
import { connectDb, runMigrations } from './client.ts';

const config = loadConfig();
const { db, close } = await connectDb(config.DATABASE_URL);
await runMigrations(db);
await close();
console.log('migrations applied');
