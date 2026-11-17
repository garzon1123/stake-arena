import { useConnect, type UiWallet } from '@wallet-standard/react';
import { ArrowRight, CheckCircle2, ShieldCheck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn, shortAddress } from '../lib/format';
import { DEMO_WALLET_NAME } from '../wallet/demoWallet';
import { useSession, useWallet } from '../wallet/WalletContext';
import { Button, Dialog } from './ui';

function WalletRow({ wallet, onConnected }: { wallet: UiWallet; onConnected: () => void }) {
  const { select } = useWallet();
  const [connecting, connect] = useConnect(wallet);
  const isDemo = wallet.name === DEMO_WALLET_NAME;
  return (
    <button
      onClick={async () => {
        try {
          const accounts = await connect();
          const acc = accounts[0] ?? wallet.accounts[0];
          if (!acc) throw new Error('No account was shared');
          select(wallet, acc);
          onConnected();
        } catch (e) {
          toast.error(`Could not connect ${wallet.name}`, { description: (e as Error).message });
        }
      }}
      disabled={connecting}
      className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3 text-left transition hover:border-line-strong hover:bg-surface-2 disabled:opacity-60"
    >
      <img src={wallet.icon} alt="" className="size-8 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{wallet.name}</div>
        <div className="text-xs text-fg-muted">{isDemo ? 'Built-in burner key · devnet only · no install' : 'Browser wallet'}</div>
      </div>
      <ArrowRight className="size-4 text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-fg" />
    </button>
  );
}

export function WalletDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { wallets, account, signMessage, chain } = useWallet();
  const { needsSignIn, signIn, me } = useSession();
  const [signing, setSigning] = useState(false);
  const step = !account ? 'connect' : needsSignIn || !me ? 'verify' : 'done';
  const extensions = wallets.filter((w) => w.name !== DEMO_WALLET_NAME);
  const demo = wallets.find((w) => w.name === DEMO_WALLET_NAME);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={step === 'connect' ? 'Connect a Solana wallet' : step === 'verify' ? 'Verify wallet ownership' : 'You’re in'}
      description={
        step === 'connect'
          ? `Your wallet is your player identity. Use a wallet set to ${chain.replace('solana:', '')}.`
          : step === 'verify'
            ? 'Sign a one-time message to prove this wallet is yours. It is free and does not send a transaction.'
            : undefined
      }
    >
      <ol className="mb-5 flex items-center gap-2 text-xs text-fg-subtle" aria-label="Progress">
        {['Connect', 'Verify'].map((s, i) => {
          const done = i === 0 ? step !== 'connect' : step === 'done';
          const current = (i === 0 && step === 'connect') || (i === 1 && step === 'verify');
          return (
            <li key={s} className={cn('flex items-center gap-1.5', current && 'text-fg', done && 'text-win')}>
              {done ? <CheckCircle2 className="size-3.5" /> : <span className="grid size-4 place-items-center rounded-full border border-current text-[9px]">{i + 1}</span>}
              {s}
              {i === 0 && <span className="mx-1 h-px w-6 bg-line-strong" />}
            </li>
          );
        })}
      </ol>

      {step === 'connect' && (
        <div className="space-y-2">
          {extensions.map((w) => (
            <WalletRow key={w.name} wallet={w} onConnected={() => {}} />
          ))}
          {extensions.length === 0 && (
            <div className="rounded-xl border border-dashed border-line-strong p-4 text-[13px] text-fg-muted">
              No browser wallet detected. Install{' '}
              <a className="text-accent hover:underline" href="https://phantom.com" target="_blank" rel="noreferrer">Phantom</a>,{' '}
              <a className="text-accent hover:underline" href="https://solflare.com" target="_blank" rel="noreferrer">Solflare</a> or{' '}
              <a className="text-accent hover:underline" href="https://backpack.app" target="_blank" rel="noreferrer">Backpack</a>, or use the demo wallet below.
            </div>
          )}
          {demo && (
            <>
              <div className="flex items-center gap-3 pt-2 text-[11px] uppercase tracking-[0.14em] text-fg-subtle">
                <span className="h-px flex-1 bg-line" /> Quick start <span className="h-px flex-1 bg-line" />
              </div>
              <WalletRow wallet={demo} onConnected={() => {}} />
            </>
          )}
        </div>
      )}

      {step === 'verify' && account && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3">
            <Wallet className="size-4 text-fg-muted" />
            <span className="font-mono text-sm">{shortAddress(account.address, 6)}</span>
          </div>
          <Button
            size="lg"
            className="w-full"
            loading={signing || !signMessage}
            onClick={async () => {
              setSigning(true);
              try {
                await signIn();
                toast.success('Wallet verified');
                onOpenChange(false);
              } catch (e) {
                toast.error('Sign-in failed', { description: (e as Error).message });
              } finally {
                setSigning(false);
              }
            }}
          >
            <ShieldCheck className="size-4" /> Sign message to continue
          </Button>
        </div>
      )}

      {step === 'done' && (
        <Button className="w-full" onClick={() => onOpenChange(false)}>
          Continue
        </Button>
      )}
    </Dialog>
  );
}
