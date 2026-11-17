import {
  address,
  appendTransactionMessageInstructions,
  assertIsFullySignedTransaction,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  fetchEncodedAccount,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  isSolanaError,
  partiallySignTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  verifySignature,
  getPublicKeyFromAddress,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Transaction,
  type TransactionWithBlockhashLifetime,
} from '@solana/kit';
import {
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { ESCROW } from '@stake-arena/shared';
import { readKeypairBytes, type Config } from '../config.ts';
import {
  createMatchInstruction,
  decodeEscrow,
  depositInstruction,
  findEscrowPdas,
  OnchainState,
  payoutInstruction,
  type PayoutKind,
} from './escrow.ts';

export interface EscrowState {
  state: keyof typeof OnchainState;
  playerOne: string;
  playerTwo: string;
  playerOneDeposited: boolean;
  playerTwoDeposited: boolean;
  stake: bigint;
  mint: string;
  adjudicator: string;
  fundingDeadline: Date;
  fundedAt: Date | null;
  resolutionWindowSecs: number;
  outcome: number;
}

export interface PreparedDeposit {
  /** base64 wire transaction with empty signature slots, for the wallet to sign */
  transaction: string;
  messageBytes: Uint8Array;
  lifetime: { blockhash: string; lastValidBlockHeight: bigint };
}

/** Everything the match service needs from Solana. Implemented for real RPC below. */
export interface ChainService {
  readonly cluster: string;
  readonly programId: string;
  readonly mint: string;
  readonly adjudicator: string;
  derive(matchId: string): Promise<{ escrow: string; vault: string }>;
  createMatch(
    a: { matchId: string; playerOne: string; playerTwo: string; stake: bigint },
    onSignature: (sig: string) => Promise<void>,
  ): Promise<string>;
  fetchEscrow(matchId: string): Promise<EscrowState | null>;
  prepareDeposit(matchId: string, player: string): Promise<PreparedDeposit>;
  submitDeposit(
    signedTxBase64: string,
    expected: Pick<PreparedDeposit, 'messageBytes' | 'lifetime'>,
    player: string,
    onSignature: (sig: string) => Promise<void>,
  ): Promise<string>;
  payout(
    kind: PayoutKind,
    a: { matchId: string; playerOne: string; playerTwo: string; outcome?: number },
    onSignature: (sig: string) => Promise<void>,
  ): Promise<string>;
  balances(owner: string): Promise<{ token: bigint; sol: bigint; hasTokenAccount: boolean }>;
  faucet(owner: string, amount: bigint): Promise<string>;
}

export class ChainError extends Error {
  constructor(
    message: string,
    readonly code: 'blockhash_expired' | 'rejected' | 'rpc' | 'invalid',
  ) {
    super(message);
  }
}

function describe(e: unknown): string {
  if (isSolanaError(e)) {
    const ctx = e.context as { logs?: string[] } | undefined;
    const logs = ctx?.logs?.filter((l) => l.includes('Error') || l.includes('failed')).slice(-3);
    const cause = e.cause instanceof Error ? ` (${e.cause.message})` : '';
    return `${e.message}${cause}${logs?.length ? ` | ${logs.join(' | ')}` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}

function isBlockhashError(e: unknown): boolean {
  const msg = describe(e).toLowerCase();
  return msg.includes('blockhash') || msg.includes('block height exceeded');
}

export async function createSolanaChain(config: Config): Promise<ChainService> {
  const rpc = createSolanaRpc(config.SOLANA_RPC_URL);
  const wsUrl =
    config.SOLANA_WS_URL ??
    config.SOLANA_RPC_URL.replace(/^http/, 'ws').replace(':8899', ':8900');
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  const adjudicator: KeyPairSigner = await createKeyPairSignerFromBytes(
    readKeypairBytes(config.ADJUDICATOR_KEYPAIR, config.repoRoot),
  );
  let mintAuthority: KeyPairSigner | null = null;
  try {
    mintAuthority = await createKeyPairSignerFromBytes(
      readKeypairBytes(config.MINT_AUTHORITY_KEYPAIR, config.repoRoot),
    );
  } catch {
    mintAuthority = null; // faucet disabled (e.g. when using an external mint)
  }
  if (!config.TEST_MINT) throw new Error('TEST_MINT is not configured; run `npm run chain:setup`');
  const mint = address(config.TEST_MINT);
  const programId = address(config.PROGRAM_ID);

  async function ata(owner: Address) {
    const [a] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    return a;
  }

  async function sendWithSigners(
    instructions: Instruction[],
    onSignature: (sig: string) => Promise<void>,
  ): Promise<string> {
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(adjudicator, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const sig = getSignatureFromTransaction(signed);
    await onSignature(sig);
    try {
      await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
    } catch (e) {
      throw new ChainError(describe(e), isBlockhashError(e) ? 'blockhash_expired' : 'rpc');
    }
    return sig;
  }

  return {
    cluster: config.SOLANA_CLUSTER,
    programId,
    mint,
    adjudicator: adjudicator.address,

    async derive(matchId) {
      return findEscrowPdas(programId, matchId);
    },

    async createMatch(a, onSignature) {
      const { escrow, vault } = await findEscrowPdas(programId, a.matchId);
      const ix = createMatchInstruction({
        programId,
        creator: adjudicator,
        adjudicator,
        mint,
        escrow,
        vault,
        matchId: a.matchId,
        playerOne: address(a.playerOne),
        playerTwo: address(a.playerTwo),
        stake: a.stake,
        fundingWindowSecs: config.FUNDING_WINDOW_SECS,
        resolutionWindowSecs: ESCROW.resolutionWindowSecs,
      });
      return sendWithSigners([ix], onSignature);
    },

    async fetchEscrow(matchId) {
      const { escrow } = await findEscrowPdas(programId, matchId);
      const acc = await fetchEncodedAccount(rpc, escrow, { commitment: 'confirmed' });
      if (!acc.exists) return null;
      if (acc.programAddress !== programId) throw new Error('Escrow owned by unexpected program');
      const d = decodeEscrow(acc.data as Uint8Array);
      return {
        state: OnchainState[d.state] as keyof typeof OnchainState,
        playerOne: d.playerOne,
        playerTwo: d.playerTwo,
        playerOneDeposited: d.playerOneDeposited,
        playerTwoDeposited: d.playerTwoDeposited,
        stake: d.stake,
        mint: d.mint,
        adjudicator: d.adjudicator,
        fundingDeadline: new Date(Number(d.fundingDeadline) * 1000),
        fundedAt: d.fundedAt > 0n ? new Date(Number(d.fundedAt) * 1000) : null,
        resolutionWindowSecs: Number(d.resolutionWindow),
        outcome: d.outcome,
      };
    },

    async prepareDeposit(matchId, player) {
      const playerAddr = address(player);
      const { escrow, vault } = await findEscrowPdas(programId, matchId);
      const ix = depositInstruction({
        programId,
        player: createNoopSigner(playerAddr),
        escrow,
        playerToken: await ata(playerAddr),
        vault,
        mint,
      });
      const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      // The server sponsors the network fee so players never need SOL.
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(adjudicator, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions([ix], m),
      );
      const tx = compileTransaction(message);
      return {
        transaction: getBase64EncodedWireTransaction(tx),
        messageBytes: new Uint8Array(tx.messageBytes),
        lifetime: blockhash,
      };
    },

    async submitDeposit(signedTxBase64, expected, player, onSignature) {
      const expectedMessage = expected.messageBytes;
      let tx: Transaction;
      try {
        tx = getTransactionDecoder().decode(getBase64Encoder().encode(signedTxBase64));
      } catch {
        throw new ChainError('Malformed transaction', 'invalid');
      }
      const msg = new Uint8Array(tx.messageBytes);
      // Only co-sign the exact message the server issued: no substituted instructions.
      if (msg.length !== expectedMessage.length || !msg.every((b, i) => b === expectedMessage[i])) {
        throw new ChainError('Transaction does not match the prepared deposit', 'invalid');
      }
      const playerSig = tx.signatures[address(player)];
      if (!playerSig) throw new ChainError('Missing player signature', 'invalid');
      const key = await getPublicKeyFromAddress(address(player));
      if (!(await verifySignature(key, playerSig, msg))) {
        throw new ChainError('Invalid player signature', 'invalid');
      }
      const signed = await partiallySignTransaction([adjudicator.keyPair], tx);
      const sig = getSignatureFromTransaction(signed);
      await onSignature(sig);
      try {
        const withLifetime = { ...signed, lifetimeConstraint: expected.lifetime } as Transaction &
          TransactionWithBlockhashLifetime;
        assertIsFullySignedTransaction(withLifetime);
        await sendAndConfirm(withLifetime as unknown as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
      } catch (e) {
        throw new ChainError(describe(e), isBlockhashError(e) ? 'blockhash_expired' : 'rejected');
      }
      return sig;
    },

    async payout(kind, a, onSignature) {
      const { escrow, vault } = await findEscrowPdas(programId, a.matchId);
      const ix = payoutInstruction({
        programId,
        kind,
        outcome: a.outcome,
        caller: adjudicator,
        escrow,
        vault,
        mint,
        playerOneToken: await ata(address(a.playerOne)),
        playerTwoToken: await ata(address(a.playerTwo)),
        creator: adjudicator.address,
      });
      return sendWithSigners([ix], onSignature);
    },

    async balances(owner) {
      const o = address(owner);
      const [tok, sol] = await Promise.all([
        fetchMaybeToken(rpc, await ata(o), { commitment: 'confirmed' }),
        rpc.getBalance(o, { commitment: 'confirmed' }).send(),
      ]);
      return {
        token: tok.exists ? tok.data.amount : 0n,
        sol: sol.value,
        hasTokenAccount: tok.exists,
      };
    },

    async faucet(owner, amount) {
      if (!mintAuthority) throw new ChainError('Faucet is disabled on this server', 'invalid');
      const o = address(owner);
      const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: adjudicator,
        owner: o,
        mint,
      });
      const mintTo = getMintToInstruction({
        mint,
        token: await ata(o),
        mintAuthority,
        amount,
      });
      return sendWithSigners([createAta, mintTo], async () => {});
    },
  };
}
