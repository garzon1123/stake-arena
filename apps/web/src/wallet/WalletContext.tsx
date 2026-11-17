import { useSignMessage, useSignTransaction } from '@solana/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWallets } from '@wallet-standard/react';
import type { UiWallet, UiWalletAccount } from '@wallet-standard/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type AppConfig, type Me } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';

const CHAIN = (import.meta.env.VITE_SOLANA_CHAIN ?? 'solana:devnet') as `solana:${string}`;
const SELECTED_KEY = 'stake-arena.selected-wallet';

type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;
type SignTransaction = (tx: Uint8Array) => Promise<Uint8Array>;

interface WalletState {
  chain: `solana:${string}`;
  wallets: readonly UiWallet[];
  wallet: UiWallet | null;
  account: UiWalletAccount | null;
  select: (wallet: UiWallet, account: UiWalletAccount) => void;
  disconnect: () => Promise<void>;
  signMessage: SignMessage | null;
  signTransaction: SignTransaction | null;
}

interface SessionState {
  config: AppConfig | undefined;
  me: Me | null | undefined;
  meLoading: boolean;
  /** true when a wallet is connected but the server session belongs to nobody / someone else */
  needsSignIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => void;
}

const WalletCtx = createContext<WalletState | null>(null);
const SessionCtx = createContext<SessionState | null>(null);

function supportsArena(w: UiWallet) {
  return (
    w.features.includes('solana:signMessage') &&
    w.features.includes('solana:signTransaction') &&
    w.chains.some((c) => c.startsWith('solana:'))
  );
}

/**
 * Mounted only when an account exists, because the @solana/react hooks require one.
 * The hooks return new function identities every render, so we keep the latest ones in
 * refs and publish stable wrappers exactly once per account.
 */
function SignerBridge({ account, onReady }: { account: UiWalletAccount; onReady: (s: { signMessage: SignMessage; signTransaction: SignTransaction }) => void }) {
  const signMessage = useSignMessage(account);
  const signTransaction = useSignTransaction(account, CHAIN);
  const msgRef = useRef(signMessage);
  const txRef = useRef(signTransaction);
  msgRef.current = signMessage;
  txRef.current = signTransaction;
  useEffect(() => {
    onReady({
      signMessage: async (message) => (await msgRef.current({ message })).signature,
      signTransaction: async (transaction) => (await txRef.current({ transaction })).signedTransaction,
    });
  }, [onReady]);
  return null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const all = useWallets();
  const wallets = useMemo(() => all.filter(supportsArena), [all]);
  const [selected, setSelected] = useState<{ wallet: string; address: string } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(SELECTED_KEY) ?? 'null');
    } catch {
      return null;
    }
  });
  const [signers, setSigners] = useState<{ signMessage: SignMessage; signTransaction: SignTransaction } | null>(null);

  const wallet = wallets.find((w) => w.name === selected?.wallet) ?? null;
  const account = wallet?.accounts.find((a) => a.address === selected?.address) ?? null;

  const select = useCallback((w: UiWallet, a: UiWalletAccount) => {
    const v = { wallet: w.name, address: a.address };
    setSelected(v);
    try {
      localStorage.setItem(SELECTED_KEY, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }, []);

  const disconnect = useCallback(async () => {
    setSelected(null);
    setSigners(null);
    try {
      localStorage.removeItem(SELECTED_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!account) setSigners(null);
  }, [account]);

  const value: WalletState = {
    chain: CHAIN,
    wallets,
    wallet,
    account,
    select,
    disconnect,
    signMessage: account ? (signers?.signMessage ?? null) : null,
    signTransaction: account ? (signers?.signTransaction ?? null) : null,
  };

  return (
    <WalletCtx.Provider value={value}>
      {account && <SignerBridge key={account.address} account={account} onReady={setSigners} />}
      <SessionProvider>{children}</SessionProvider>
    </WalletCtx.Provider>
  );
}

function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { account, signMessage } = useWallet();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<AppConfig>('/api/config'), staleTime: Infinity });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/api/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 15_000,
  });

  const sessionWallet = me.data?.player.wallet ?? null;
  const needsSignIn = !!account && me.data !== undefined && sessionWallet !== account.address;

  useEffect(() => {
    if (sessionWallet) connectSocket();
    else disconnectSocket();
  }, [sessionWallet]);

  const signIn = useCallback(async () => {
    if (!account || !signMessage) throw new Error('Connect a wallet first');
    const { nonce, message } = await api<{ nonce: string; message: string }>('/api/auth/nonce', {
      body: { wallet: account.address },
    });
    const sig = await signMessage(new TextEncoder().encode(message));
    await api('/api/auth/verify', {
      body: { wallet: account.address, nonce, signature: btoa(String.fromCharCode(...sig)) },
    });
    disconnectSocket();
    await qc.invalidateQueries();
  }, [account, signMessage, qc]);

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { body: {} }).catch(() => {});
    disconnectSocket();
    qc.setQueryData(['me'], null);
    await qc.invalidateQueries();
  }, [qc]);

  const value: SessionState = {
    config: config.data,
    me: me.data,
    meLoading: me.isLoading,
    needsSignIn,
    signIn,
    signOut,
    refreshMe: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useWallet() {
  const v = useContext(WalletCtx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}

export function useSession() {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
