import { AlertTriangle, Clock, Cpu, Gavel, KeyRound, Lock, Radar, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '../components/ui';
import { explorerUrl, shortAddress } from '../lib/format';
import { useSession } from '../wallet/WalletContext';

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-lg border border-line-strong bg-surface-2 text-accent">{icon}</div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-fg-muted [&_strong]:font-medium [&_strong]:text-fg">{children}</div>
    </Card>
  );
}

export function HowItWorksPage() {
  const { config } = useSession();
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="max-w-2xl">
        <div className="text-xs font-medium uppercase tracking-[0.16em] text-accent">How it works & safety</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Skill decides the game. A program moves the money.</h1>
        <p className="mt-4 text-fg-muted">
          STAKE Arena is a technology demonstration on Solana {config?.cluster ?? 'devnet'}. Stakes use a valueless test token. Here is exactly what
          happens in a match — and what you are trusting.
        </p>
      </div>

      <div className="mt-10 grid gap-5">
        <Section icon={<Radar className="size-4" />} title="1 · Matchmaking">
          <p>
            You pick a stake tier (5, 10 or 25 TEST) and a time control. The server keeps a persistent queue and pairs players with the
            <strong> same tier and time control</strong> whose ratings are within <strong>±150 Elo</strong>. If nobody fits, the window widens by 50
            every 10 seconds (up to ±600). Pairing happens in a single database transaction, so two players can never be double-booked, and you
            can’t be matched against your own wallet.
          </p>
        </Section>

        <Section icon={<Lock className="size-4" />} title="2 · Escrow on Solana">
          <p>
            When you’re paired, the server creates a <strong>match escrow account</strong> derived from the match id, plus a token vault owned by that
            program-derived address. It records both wallets, the token mint, the exact stake and a funding deadline.
          </p>
          <p>
            Each player signs one <strong>deposit</strong> that moves exactly the stake into the vault. The program rejects wrong mints, wrong
            players, duplicate deposits, and late deposits. The game only starts once the server has read the escrow account and confirmed both
            deposits onchain — a client-supplied signature is never trusted on its own. Network fees are sponsored by the server so you never need SOL.
          </p>
          {config && (
            <dl className="grid gap-2 rounded-xl border border-line bg-bg/50 p-4 font-mono text-xs sm:grid-cols-2">
              <div>
                <dt className="font-sans text-fg-subtle">Program</dt>
                <dd>
                  <a className="text-accent hover:underline" href={explorerUrl('address', config.programId, config.cluster)} target="_blank" rel="noreferrer">
                    {shortAddress(config.programId, 8)}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="font-sans text-fg-subtle">Test token mint</dt>
                <dd>
                  <a className="text-accent hover:underline" href={explorerUrl('address', config.mint, config.cluster)} target="_blank" rel="noreferrer">
                    {shortAddress(config.mint, 8)}
                  </a>
                </dd>
              </div>
            </dl>
          )}
        </Section>

        <Section icon={<Cpu className="size-4" />} title="3 · Verified gameplay">
          <p>
            The server is authoritative. Your browser only <strong>proposes moves</strong>; the server checks your identity, that you’re in the match,
            that it’s your turn, the move sequence number, legality (via chess.js, including castling, en passant and promotion) and your clock.
            Accepted moves are persisted and broadcast to both players.
          </p>
          <p>
            Games end by checkmate, resignation, time, stalemate, threefold repetition, the fifty-move rule, insufficient material, or agreed draw.
            If your flag falls but your opponent has only a bare king (or king + one minor piece), it’s a draw.
          </p>
        </Section>

        <Section icon={<Clock className="size-4" />} title="Disconnects & timeouts">
          <p>
            Clocks are kept by the server. <strong>If you disconnect, your clock keeps running</strong> — refresh or reconnect and you resume the same
            game. Disconnecting can’t force a win or a cancellation. If the funding window (2 minutes) passes before both deposits land, the match is
            cancelled and the program refunds any deposit.
          </p>
        </Section>

        <Section icon={<Gavel className="size-4" />} title="4 · Settlement">
          <p>
            When the server records a result, a dedicated <strong>adjudicator key</strong> signs the program’s <code>settle</code> instruction: the winner
            receives the whole pot; a draw returns each stake. The program refuses to settle twice, refuses any signer other than the adjudicator, and
            can only pay token accounts owned by the two players. Settlement is retried automatically until confirmed, and the results screen only
            shows a payout after Solana confirms it.
          </p>
        </Section>

        <Section icon={<KeyRound className="size-4" />} title="What you are trusting">
          <p>
            This MVP is <strong>not trustless</strong>. The adjudicator decides which player won, so a compromised or dishonest server could settle a
            funded match the wrong way (it still can’t send funds anywhere except to one of the two players). If the adjudicator disappears, anyone can
            call <code>refund_unresolved</code> one hour after funding to return both stakes.
          </p>
          <p>
            A server-authoritative engine prevents illegal moves; it <strong>cannot detect a player consulting a chess engine</strong>. Fair-play
            analysis is future work.
          </p>
        </Section>

        <div className="flex gap-3 rounded-2xl border border-warn/25 bg-warn-soft p-5 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">Demo mode — test tokens have no cash value</div>
            <p className="mt-1 text-warn/80">
              There are no deposits of real money, no withdrawals, no mainnet configuration and no real-money mode. Any future version involving
              prizes of value would require independent legal review, regulatory compliance and a professional security audit first. The escrow program
              has not been audited.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          <ShieldCheck className="size-3.5" /> Source code, program tests and the full security model are in the project repository.
        </div>
      </div>
    </div>
  );
}
