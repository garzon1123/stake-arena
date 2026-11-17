/** Extracts the real settle transaction for the recorded match into proof.json (read-only). */
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
const RAW = process.argv[2] ?? 'deliverables/raw';
const RPC = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const m = JSON.parse(readFileSync(`${RAW}/markers.json`, 'utf8'));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://localhost:5432/stake_arena' });
await db.connect();
const { rows: [match] } = await db.query('select escrow_address, vault_address from matches where id=$1', [m.matchId]);
const { rows: [tx] } = await db.query("select signature from escrow_transactions where match_id=$1 and kind='settle' and status='confirmed'", [m.matchId]);
const { rows: players } = await db.query('select username, wallet from players where username = any($1)', [[m.names.a, m.names.b]]);
await db.end();
const res = await fetch(RPC, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [tx.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] }),
}).then((r) => r.json());
const t = res.result;
const keys: string[] = t.transaction.message.accountKeys.map((k: { pubkey: string }) => k.pubkey);
const pre = new Map(t.meta.preTokenBalances.map((b: any) => [b.accountIndex, b]));
const post = new Map(t.meta.postTokenBalances.map((b: any) => [b.accountIndex, b]));
const label = (owner: string) =>
  owner === match.escrow_address ? 'Escrow vault (PDA)' : players.find((p) => p.wallet === owner)?.username ?? owner;
const tokenChanges = [...new Set([...pre.keys(), ...post.keys()])].sort().map((i: any) => {
  const b: any = pre.get(i) ?? post.get(i);
  return {
    label: label(b.owner),
    account: keys[i],
    before: (pre.get(i) as any)?.uiTokenAmount.uiAmountString ?? '—',
    after: (post.get(i) as any)?.uiTokenAmount.uiAmountString ?? 'closed',
  };
});
const logs = (t.meta.logMessages as string[]).filter((l) => !l.startsWith('Program data')).map((l) => l.replace(/Program (\w{4})\w+(\w{4}) /, 'Program $1…$2 '));
const proof = { matchId: m.matchId, signature: tx.signature, slot: t.slot, programId: keys[t.transaction.message.instructions[0].programIdIndex] ?? t.transaction.message.instructions[0].programId, tokenChanges, logs };
writeFileSync(`${RAW}/proof.json`, JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
