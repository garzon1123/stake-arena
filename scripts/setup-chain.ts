/**
 * Prepares a cluster for STAKE Arena:
 *   1. ensures the adjudicator (fee payer) has SOL (airdrop on localnet; tries on devnet)
 *   2. creates the valueless "STAKE Arena Test Token" mint (6 decimals, no freeze authority)
 *   3. prints/updates TEST_MINT in .env
 *
 * Usage: npx tsx scripts/setup-chain.ts [--cluster localnet|devnet] [--rpc URL]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  airdropFactory,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import { getInitializeMint2Instruction, getMintSize, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const cluster = arg('cluster') ?? 'localnet';
const rpcUrl = arg('rpc') ?? (cluster === 'devnet' ? 'https://api.devnet.solana.com' : 'http://127.0.0.1:8899');
const wsUrl = rpcUrl.replace(/^http/, 'ws').replace(':8899', ':8900');

const readKey = (p: string) => createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(resolve(root, p), 'utf8'))));

const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const adjudicator = await readKey('keys/adjudicator.json');
const mintAuthority = await readKey('keys/mint-authority.json');

const { value: bal } = await rpc.getBalance(adjudicator.address).send();
console.log(`cluster=${cluster} adjudicator=${adjudicator.address} balance=${Number(bal) / 1e9} SOL`);
if (bal < 500_000_000n) {
  try {
    await airdropFactory({ rpc, rpcSubscriptions })({
      recipientAddress: adjudicator.address,
      lamports: lamports(cluster === 'devnet' ? 1_000_000_000n : 100_000_000_000n),
      commitment: 'confirmed',
    });
    console.log('airdrop ok');
  } catch (e) {
    console.error(`airdrop failed (${(e as Error).message}). Fund ${adjudicator.address} at https://faucet.solana.com and re-run.`);
    if (bal < 50_000_000n) process.exit(1);
  }
}

const mint = await generateKeyPairSigner();
const space = BigInt(getMintSize());
const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
const { value: blockhash } = await rpc.getLatestBlockhash().send();
const tx = await signTransactionMessageWithSigners(
  pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(adjudicator, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getCreateAccountInstruction({ payer: adjudicator, newAccount: mint, lamports: rent, space, programAddress: TOKEN_PROGRAM_ADDRESS }),
          getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: mintAuthority.address, freezeAuthority: null }),
        ],
        m,
      ),
  ),
);
await sendAndConfirm(tx as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
console.log(`TEST mint created: ${mint.address}  (tx ${getSignatureFromTransaction(tx)})`);

const envPath = resolve(root, '.env');
let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(resolve(root, '.env.example'), 'utf8');
const set = (k: string, v: string) => {
  env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`;
};
set('TEST_MINT', mint.address);
set('SOLANA_CLUSTER', cluster);
set('SOLANA_RPC_URL', rpcUrl);
set('VITE_SOLANA_CHAIN', `solana:${cluster}`);
writeFileSync(envPath, env);
console.log(`.env updated (TEST_MINT, SOLANA_CLUSTER, SOLANA_RPC_URL)`);
process.exit(0);
