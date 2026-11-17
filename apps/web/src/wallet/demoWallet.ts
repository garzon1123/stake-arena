/**
 * "STAKE Demo Wallet" — a devnet-only burner wallet that implements the Wallet Standard,
 * so it is discovered exactly like Phantom/Solflare/Backpack. It exists so judges can try
 * the app without installing an extension. The 32-byte seed lives in this browser's
 * localStorage; it must never hold anything of value. Each browser profile gets its own key.
 */
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  signBytes,
  type KeyPairSigner,
} from '@solana/kit';
import type {
  SolanaSignMessageFeature,
  SolanaSignMessageInput,
  SolanaSignTransactionFeature,
  SolanaSignTransactionInput,
} from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type {
  StandardConnectFeature,
  StandardDisconnectFeature,
  StandardEventsFeature,
  StandardEventsListeners,
} from '@wallet-standard/features';
import { registerWallet } from '@wallet-standard/wallet';

export const DEMO_WALLET_NAME = 'STAKE Demo Wallet';
const STORAGE_KEY = 'stake-arena.demo-wallet.seed';
const CHAINS = ['solana:devnet', 'solana:localnet'] as const;

const ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1a1a23"/><path d="M9 22h14M11 22l1.5-8L16 9l3.5 5 1.5 8" fill="none" stroke="#3ddc97" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  );

function loadSeed(): Uint8Array {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return Uint8Array.from(atob(existing), (c) => c.charCodeAt(0));
  } catch {
    /* storage unavailable: fall through to an ephemeral key */
  }
  const seed = crypto.getRandomValues(new Uint8Array(32));
  try {
    localStorage.setItem(STORAGE_KEY, btoa(String.fromCharCode(...seed)));
  } catch {
    /* ephemeral */
  }
  return seed;
}

class DemoWallet implements Wallet {
  readonly version = '1.0.0' as const;
  readonly name = DEMO_WALLET_NAME;
  readonly icon = ICON as `data:image/svg+xml;base64,${string}`;
  readonly chains = CHAINS;
  #signer: KeyPairSigner | null = null;
  #account: WalletAccount | null = null;
  #listeners: { change: StandardEventsListeners['change'][] } = { change: [] };

  get accounts() {
    return this.#account ? [this.#account] : [];
  }

  get features(): StandardConnectFeature &
    StandardDisconnectFeature &
    StandardEventsFeature &
    SolanaSignMessageFeature &
    SolanaSignTransactionFeature {
    return {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: await this.#connect() }) },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => this.#disconnect() },
      'standard:events': {
        version: '1.0.0',
        on: (event, listener) => {
          this.#listeners[event].push(listener);
          return () => {
            this.#listeners[event] = this.#listeners[event].filter((l) => l !== listener);
          };
        },
      },
      'solana:signMessage': {
        version: '1.1.0',
        signMessage: async (...inputs: readonly SolanaSignMessageInput[]) => {
          const signer = this.#requireSigner();
          return Promise.all(
            inputs.map(async ({ message }) => ({
              signedMessage: message,
              signature: new Uint8Array(await signBytes(signer.keyPair.privateKey, message)),
            })),
          );
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs: readonly SolanaSignTransactionInput[]) => {
          const signer = this.#requireSigner();
          return Promise.all(
            inputs.map(async ({ transaction }) => {
              const tx = getTransactionDecoder().decode(transaction);
              const signed = await partiallySignTransaction([signer.keyPair], tx);
              return { signedTransaction: new Uint8Array(getTransactionEncoder().encode(signed)) };
            }),
          );
        },
      },
    };
  }

  #requireSigner() {
    if (!this.#signer) throw new Error('Demo wallet is not connected');
    return this.#signer;
  }

  async #connect() {
    if (!this.#signer) {
      this.#signer = await createKeyPairSignerFromPrivateKeyBytes(loadSeed());
      this.#account = {
        address: this.#signer.address,
        publicKey: new Uint8Array(getAddressEncoder().encode(this.#signer.address)),
        chains: CHAINS,
        features: ['solana:signMessage', 'solana:signTransaction'],
      };
      for (const l of this.#listeners.change) l({ accounts: this.accounts });
    }
    return this.accounts;
  }

  async #disconnect() {
    this.#signer = null;
    this.#account = null;
    for (const l of this.#listeners.change) l({ accounts: this.accounts });
  }
}

let registered = false;
export function registerDemoWallet() {
  if (registered) return;
  registered = true;
  registerWallet(new DemoWallet());
}

/** Lets a user deliberately replace their burner key (e.g. to play a second account). */
export function resetDemoWallet() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
