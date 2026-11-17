/**
 * Client for the stake_arena Anchor program, written against @solana/kit.
 * Instruction discriminators are read from the IDL produced by `anchor build`
 * so they can never drift from the deployed program.
 */
import {
  AccountRole,
  address,
  fixCodecSize,
  getAddressCodec,
  getAddressEncoder,
  getBooleanCodec,
  getBytesCodec,
  getEnumCodec,
  getI64Codec,
  getProgramDerivedAddress,
  getStructCodec,
  getU64Codec,
  getU8Codec,
  type Address,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import idl from './idl/stake_arena.json' with { type: 'json' };

const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

function discriminator(name: string): Uint8Array {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`IDL missing instruction ${name}`);
  return Uint8Array.from(ix.discriminator);
}
const ESCROW_ACCOUNT_DISCRIMINATOR = Uint8Array.from(
  idl.accounts.find((a) => a.name === 'MatchEscrow')!.discriminator,
);

export enum OnchainState {
  AwaitingDeposits,
  Funded,
  Settled,
  Cancelled,
  Refunded,
}

export const OUTCOME = { playerOne: 1, playerTwo: 2, draw: 3 } as const;

export const escrowCodec = getStructCodec([
  ['discriminator', fixCodecSize(getBytesCodec(), 8)],
  ['matchId', fixCodecSize(getBytesCodec(), 16)],
  ['creator', getAddressCodec()],
  ['adjudicator', getAddressCodec()],
  ['playerOne', getAddressCodec()],
  ['playerTwo', getAddressCodec()],
  ['mint', getAddressCodec()],
  ['vault', getAddressCodec()],
  ['stake', getU64Codec()],
  ['fundingDeadline', getI64Codec()],
  ['resolutionWindow', getI64Codec()],
  ['fundedAt', getI64Codec()],
  ['playerOneDeposited', getBooleanCodec()],
  ['playerTwoDeposited', getBooleanCodec()],
  ['state', getEnumCodec(OnchainState)],
  ['outcome', getU8Codec()],
  ['bump', getU8Codec()],
  ['vaultBump', getU8Codec()],
]);
export type EscrowAccount = ReturnType<typeof escrowCodec.decode>;

export function decodeEscrow(data: Uint8Array): EscrowAccount {
  const decoded = escrowCodec.decode(data);
  const d = decoded.discriminator as Uint8Array;
  if (!d.every((b, i) => b === ESCROW_ACCOUNT_DISCRIMINATOR[i])) {
    throw new Error('Account is not a MatchEscrow');
  }
  return decoded;
}

export function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Invalid match id');
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

export async function findEscrowPdas(programId: Address, matchId: string) {
  const enc = getAddressEncoder();
  const [escrow] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode('match'), uuidToBytes(matchId)],
  });
  const [vault] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode('vault'), enc.encode(escrow)],
  });
  return { escrow, vault };
}

const createArgsCodec = getStructCodec([
  ['matchId', fixCodecSize(getBytesCodec(), 16)],
  ['playerOne', getAddressCodec()],
  ['playerTwo', getAddressCodec()],
  ['stake', getU64Codec()],
  ['fundingWindowSecs', getI64Codec()],
  ['resolutionWindowSecs', getI64Codec()],
]);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const signerMeta = (signer: TransactionSigner, writable = false) => ({
  address: signer.address,
  role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER,
  signer,
});
const ro = (a: Address) => ({ address: a, role: AccountRole.READONLY });
const rw = (a: Address) => ({ address: a, role: AccountRole.WRITABLE });

export function createMatchInstruction(p: {
  programId: Address;
  creator: TransactionSigner;
  adjudicator: TransactionSigner;
  mint: Address;
  escrow: Address;
  vault: Address;
  matchId: string;
  playerOne: Address;
  playerTwo: Address;
  stake: bigint;
  fundingWindowSecs: number;
  resolutionWindowSecs: number;
}): Instruction {
  const data = concat(
    discriminator('create_match'),
    createArgsCodec.encode({
      matchId: uuidToBytes(p.matchId),
      playerOne: p.playerOne,
      playerTwo: p.playerTwo,
      stake: p.stake,
      fundingWindowSecs: BigInt(p.fundingWindowSecs),
      resolutionWindowSecs: BigInt(p.resolutionWindowSecs),
    }) as Uint8Array,
  );
  const accounts =
    p.creator.address === p.adjudicator.address
      ? [signerMeta(p.creator, true), signerMeta(p.adjudicator, true)]
      : [signerMeta(p.creator, true), signerMeta(p.adjudicator)];
  return {
    programAddress: p.programId,
    accounts: [
      ...accounts,
      ro(p.mint),
      rw(p.escrow),
      rw(p.vault),
      ro(TOKEN_PROGRAM_ADDRESS),
      ro(SYSTEM_PROGRAM),
    ],
    data,
  };
}

export function depositInstruction(p: {
  programId: Address;
  player: TransactionSigner;
  escrow: Address;
  playerToken: Address;
  vault: Address;
  mint: Address;
}): Instruction {
  return {
    programAddress: p.programId,
    accounts: [
      signerMeta(p.player),
      rw(p.escrow),
      rw(p.playerToken),
      rw(p.vault),
      ro(p.mint),
      ro(TOKEN_PROGRAM_ADDRESS),
    ],
    data: discriminator('deposit'),
  };
}

export type PayoutKind = 'settle' | 'cancel_unfunded' | 'refund_unresolved';

export function payoutInstruction(p: {
  programId: Address;
  kind: PayoutKind;
  outcome?: number;
  caller: TransactionSigner;
  escrow: Address;
  vault: Address;
  mint: Address;
  playerOneToken: Address;
  playerTwoToken: Address;
  creator: Address;
}): Instruction {
  const data =
    p.kind === 'settle'
      ? concat(discriminator('settle'), Uint8Array.of(p.outcome ?? 0))
      : discriminator(p.kind);
  const callerIsCreator = p.caller.address === p.creator;
  return {
    programAddress: p.programId,
    accounts: [
      signerMeta(p.caller, callerIsCreator),
      rw(p.escrow),
      rw(p.vault),
      ro(p.mint),
      rw(p.playerOneToken),
      rw(p.playerTwoToken),
      callerIsCreator ? signerMeta(p.caller, true) : rw(p.creator),
      ro(TOKEN_PROGRAM_ADDRESS),
    ],
    data,
  };
}
