import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('0.0.0.0'),
  /** Public origin of the web app (used for CORS, cookie and sign-in message URI). */
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgres://localhost:5432/stake_arena'),

  SOLANA_CLUSTER: z.enum(['devnet', 'localnet']).default('devnet'),
  SOLANA_RPC_URL: z.string().default('https://api.devnet.solana.com'),
  SOLANA_WS_URL: z.string().optional(),
  PROGRAM_ID: z.string().default('4CGHpkEjVe6PAZC5V2cpNH2u1kakXQUxru4CSpnarCZL'),
  /** Test-token mint. Created by scripts/setup-chain.ts. */
  TEST_MINT: z.string().optional(),
  /** Adjudicator keypair: JSON byte array, or a path to a Solana CLI keypair file. Server-only. */
  ADJUDICATOR_KEYPAIR: z.string().default('keys/adjudicator.json'),
  /** Mint authority for the demo faucet. Server-only. */
  MINT_AUTHORITY_KEYPAIR: z.string().default('keys/mint-authority.json'),
  FAUCET_AMOUNT: z.coerce.number().int().positive().default(100),
  /** Escrow funding window (program enforces 30s..24h). */
  FUNDING_WINDOW_SECS: z.coerce.number().int().min(30).max(86_400).default(120),

});

export type Config = z.infer<typeof Env> & { repoRoot: string };

const repoRoot = resolve(import.meta.dirname, '../../..');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  return { ...parsed, repoRoot };
}

/** Reads a keypair from a JSON byte-array string or a file path (relative to repo root). */
export function readKeypairBytes(value: string, root = repoRoot): Uint8Array {
  const raw = value.trim().startsWith('[') ? value : readFileSync(resolve(root, value), 'utf8');
  const arr = JSON.parse(raw) as number[];
  if (!Array.isArray(arr) || arr.length !== 64) throw new Error('Keypair must be a 64-byte array');
  return Uint8Array.from(arr);
}
