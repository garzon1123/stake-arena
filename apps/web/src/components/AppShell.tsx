import { LogOut, Pencil, UserRound, Wallet } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { cn, shortAddress } from '../lib/format';
import { useSession, useWallet } from '../wallet/WalletContext';
import { ProfileDialog } from './ProfileDialog';
import { Button, Logo, PlayerAvatar } from './ui';
import { WalletDialog } from './WalletDialog';
import { useBalance } from '../lib/hooks';
import { formatTokenAmount } from '@stake-arena/shared';

const ShellCtx = createContext<{ openWallet: () => void; openProfile: () => void }>({
  openWallet: () => {},
  openProfile: () => {},
});
export const useShell = () => useContext(ShellCtx);

function AccountMenu() {
  const { me, signOut, config } = useSession();
  const { disconnect } = useWallet();
  const { openProfile } = useShell();
  const balance = useBalance();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  if (!me) return null;
  const p = me.player;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-xl border border-line bg-surface/80 py-1 pl-1 pr-3 transition hover:border-line-strong"
      >
        <PlayerAvatar avatar={p.avatar} color={p.avatarColor} size={28} />
        <div className="hidden text-left leading-tight sm:block">
          <div className="text-[13px] font-medium">{p.username ?? shortAddress(p.wallet)}</div>
          <div className="font-mono text-[11px] text-fg-muted tabular">
            {balance.data ? `${formatTokenAmount(balance.data.token)} ${config?.token.symbol ?? 'TEST'}` : '—'}
          </div>
        </div>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-40 w-56 overflow-hidden rounded-xl border border-line-strong bg-bg-raised p-1 shadow-2xl">
          <div className="px-3 py-2 font-mono text-[11px] text-fg-subtle">{shortAddress(p.wallet, 6)}</div>
          <Link role="menuitem" to={`/players/${p.id}`} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5">
            <UserRound className="size-4 text-fg-muted" /> My profile
          </Link>
          <button role="menuitem" onClick={() => (setOpen(false), openProfile())} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5">
            <Pencil className="size-4 text-fg-muted" /> Edit profile
          </button>
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await signOut();
              await disconnect();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-loss hover:bg-loss-soft"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const { me, needsSignIn, config } = useSession();
  const [walletOpen, setWalletOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const loc = useLocation();
  const shell = useMemo(() => ({ openWallet: () => setWalletOpen(true), openProfile: () => setProfileOpen(true) }), []);
  const signedIn = !!me && !needsSignIn;
  const firstRun = signedIn && !me?.player.username;
  const isLanding = loc.pathname === '/';

  useEffect(() => {
    if (needsSignIn) setWalletOpen(true);
  }, [needsSignIn]);

  const nav = [
    { to: '/arena', label: 'Arena' },
    { to: '/leaderboard', label: 'Leaderboard' },
    { to: '/how-it-works', label: 'How it works' },
  ];

  return (
    <ShellCtx.Provider value={shell}>
    <div className="relative min-h-dvh">
      <div className="pointer-events-none fixed inset-0 ambient" aria-hidden />
      <div className="relative z-30 border-b border-warn/15 bg-warn/[0.06] px-4 py-1.5 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-warn">
        Demo mode — test tokens have no cash value · Solana {config?.cluster ?? 'devnet'}
      </div>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="STAKE Arena home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn('rounded-lg px-3 py-1.5 text-sm transition', isActive ? 'bg-white/[0.06] text-fg' : 'text-fg-muted hover:text-fg')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface/70 px-2.5 py-1 text-[11px] font-medium text-fg-muted sm:inline-flex">
              <span className="size-1.5 rounded-full bg-win" /> {config?.cluster ?? 'devnet'}
            </span>
            {signedIn ? (
              <AccountMenu />
            ) : (
              <Button size="sm" variant={isLanding ? 'secondary' : 'primary'} onClick={() => setWalletOpen(true)}>
                <Wallet className="size-4" /> Connect wallet
              </Button>
            )}
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 md:hidden" aria-label="Main mobile">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cn('rounded-lg px-3 py-1.5 text-[13px]', isActive ? 'bg-white/[0.06] text-fg' : 'text-fg-muted')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="relative z-10">
        <Outlet />
      </main>

      <footer className="relative z-10 mt-24 border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>STAKE Arena · UBC Hackathon 2026 prototype · Solana {config?.cluster ?? 'devnet'} only</span>
          <span>Test tokens have no monetary value. No real-money wagering. Not audited.</span>
        </div>
      </footer>

      <WalletDialog open={walletOpen} onOpenChange={setWalletOpen} />
      <ProfileDialog open={profileOpen || firstRun} onOpenChange={setProfileOpen} firstRun={firstRun} />
    </div>
    </ShellCtx.Provider>
  );
}
