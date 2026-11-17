import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { address, getPublicKeyFromAddress, isAddress, signatureBytes, verifySignature } from '@solana/kit';
import type { Db } from '../db/client.ts';
import * as t from '../db/schema.ts';

export const SESSION_COOKIE = 'sa_session';
const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function buildSignInMessage(p: { domain: string; uri: string; wallet: string; nonce: string; issuedAt: Date; expiresAt: Date }) {
  return [
    `${p.domain} wants you to sign in with your Solana account:`,
    p.wallet,
    '',
    'Sign in to STAKE Arena (devnet demo). This only proves you own this wallet: it does not send a transaction or cost anything.',
    '',
    `URI: ${p.uri}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt.toISOString()}`,
    `Expiration Time: ${p.expiresAt.toISOString()}`,
  ].join('\n');
}

export class AuthService {
  constructor(
    private db: Db,
    private origin: string,
    private now: () => number = Date.now,
  ) {}

  async createNonce(wallet: string) {
    if (!isAddress(wallet)) throw new Error('Invalid wallet address');
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date(this.now());
    const expiresAt = new Date(this.now() + NONCE_TTL_MS);
    const url = new URL(this.origin);
    const message = buildSignInMessage({ domain: url.host, uri: url.origin, wallet, nonce, issuedAt, expiresAt });
    await this.db.insert(t.walletAuthNonces).values({ nonce, wallet, message, expiresAt });
    return { nonce, message };
  }

  /** Verifies the signature over the server-issued message and consumes the nonce exactly once. */
  async verify(wallet: string, nonce: string, signatureB64: string) {
    if (!isAddress(wallet)) throw new Error('Invalid wallet address');
    const [row] = await this.db
      .update(t.walletAuthNonces)
      .set({ usedAt: new Date(this.now()) })
      .where(
        and(
          eq(t.walletAuthNonces.nonce, nonce),
          eq(t.walletAuthNonces.wallet, wallet),
          isNull(t.walletAuthNonces.usedAt),
          gt(t.walletAuthNonces.expiresAt, new Date(this.now())),
        ),
      )
      .returning();
    if (!row) throw new Error('Sign-in request expired or already used');
    const sig = Buffer.from(signatureB64, 'base64');
    if (sig.length !== 64) throw new Error('Malformed signature');
    const key = await getPublicKeyFromAddress(address(wallet));
    const ok = await verifySignature(key, signatureBytes(new Uint8Array(sig)), new TextEncoder().encode(row.message));
    if (!ok) throw new Error('Signature verification failed');

    const [player] = await this.db
      .insert(t.players)
      .values({ wallet })
      .onConflictDoUpdate({ target: t.players.wallet, set: { updatedAt: new Date(this.now()) } })
      .returning();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now() + SESSION_TTL_MS);
    await this.db.insert(t.sessions).values({ tokenHash: sha256(token), playerId: player!.id, expiresAt });
    return { player: player!, token, expiresAt };
  }

  async playerIdForToken(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const [s] = await this.db
      .select()
      .from(t.sessions)
      .where(and(eq(t.sessions.tokenHash, sha256(token)), isNull(t.sessions.revokedAt), gt(t.sessions.expiresAt, new Date(this.now()))));
    return s?.playerId ?? null;
  }

  async revoke(token: string | undefined) {
    if (!token) return;
    await this.db.update(t.sessions).set({ revokedAt: new Date(this.now()) }).where(eq(t.sessions.tokenHash, sha256(token)));
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
