import * as RDialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/format';

// ─────────────── Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'win' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent-strong text-white shadow-[0_0_0_1px_rgb(255_255_255/0.08)_inset,0_8px_24px_-8px_rgb(114_98_255/0.7)] hover:bg-accent disabled:shadow-none',
  secondary: 'bg-surface-2 text-fg border border-line-strong hover:bg-surface-3 hover:border-white/20',
  ghost: 'text-fg-muted hover:text-fg hover:bg-white/5',
  win: 'bg-win text-[#04140c] hover:brightness-110 shadow-[0_8px_24px_-10px_rgb(61_220_151/0.7)]',
  danger: 'bg-loss-soft text-loss border border-loss/30 hover:bg-loss/20',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-[10px]',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }
>(function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap transition-all duration-150 select-none',
        'active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ─────────────── Card
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]', className)}
      {...rest}
    />
  );
}

export function CardHeader({ title, action, eyebrow }: { title: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5">
      <div>
        {eyebrow && <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">{eyebrow}</div>}
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      </div>
      {action}
    </div>
  );
}

// ─────────────── Badge
type Tone = 'neutral' | 'accent' | 'win' | 'loss' | 'warn';
const tones: Record<Tone, string> = {
  neutral: 'bg-white/5 text-fg-muted border-line-strong',
  accent: 'bg-accent-soft text-accent border-accent/25',
  win: 'bg-win-soft text-win border-win/25',
  loss: 'bg-loss-soft text-loss border-loss/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
};
export function Badge({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current animate-pulse-soft" aria-hidden />}
      {children}
    </span>
  );
}

// ─────────────── Skeleton / Spinner / Empty
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-white/[0.06]', className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-fg-muted', className)} aria-label="Loading" />;
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="grid size-11 place-items-center rounded-xl border border-line bg-surface-2 text-fg-muted">{icon}</div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        {body && <p className="mt-1 max-w-xs text-[13px] text-fg-muted">{body}</p>}
      </div>
      {action}
    </div>
  );
}

// ─────────────── Stat
export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">{label}</div>
      <div className="mt-1 truncate font-mono text-lg font-medium tabular">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}

// ─────────────── Avatar
const PIECES: Record<string, string> = { knight: '♞', rook: '♜', bishop: '♝', queen: '♛', king: '♚', pawn: '♟' };
const GRADS: Record<string, string> = {
  violet: 'from-[#8b7cff] to-[#4b3fd1]',
  emerald: 'from-[#3ddc97] to-[#13866a]',
  amber: 'from-[#f5b94a] to-[#c76f1c]',
  sky: 'from-[#5cc8ff] to-[#2a6fd6]',
  rose: 'from-[#ff7aa2] to-[#c2335e]',
  slate: 'from-[#8a8aa3] to-[#3b3b4f]',
};
export function PlayerAvatar({ avatar, color, size = 40, className }: { avatar: string; color: string; size?: number; className?: string }) {
  return (
    <div
      className={cn('grid shrink-0 place-items-center rounded-full bg-gradient-to-br text-white ring-1 ring-white/15', GRADS[color] ?? GRADS.violet, className)}
      style={{ width: size, height: size, fontSize: size * 0.55, lineHeight: 1 }}
      aria-hidden
    >
      <span className="drop-shadow-[0_1px_1px_rgb(0_0_0/0.4)]">{PIECES[avatar] ?? PIECES.knight}</span>
    </div>
  );
}

// ─────────────── Segmented control
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; sub?: ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-xl border px-3 py-3 text-left transition-all',
              active
                ? 'border-accent/60 bg-accent-soft shadow-[var(--shadow-glow)]'
                : 'border-line bg-surface-2/60 hover:border-line-strong hover:bg-surface-2',
            )}
          >
            <div className={cn('font-mono text-[15px] font-semibold tabular', active ? 'text-fg' : 'text-fg/90')}>{o.label}</div>
            {o.sub && <div className="mt-0.5 text-xs text-fg-muted">{o.sub}</div>}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────── Dialog
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  dismissible?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={(o) => (dismissible || o ? onOpenChange(o) : undefined)}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in" />
        <RDialog.Content
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line-strong bg-bg-raised p-6 shadow-2xl focus:outline-none"
        >
          <div className="mb-5 pr-8">
            <RDialog.Title className="text-lg font-semibold tracking-tight">{title}</RDialog.Title>
            {description && <RDialog.Description className="mt-1.5 text-sm text-fg-muted">{description}</RDialog.Description>}
          </div>
          {children}
          {dismissible && (
            <RDialog.Close className="absolute right-4 top-4 rounded-lg p-1.5 text-fg-subtle hover:bg-white/5 hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </RDialog.Close>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ─────────────── Logo
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#16161e" stroke="rgb(255 255 255 / 0.08)" />
        <path d="M9 22h14M11 22l1.5-8L16 9l3.5 5 1.5 8" fill="none" stroke="#8b7cff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="9" r="1.8" fill="#3ddc97" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">
        STAKE <span className="text-fg-muted font-medium">Arena</span>
      </span>
    </span>
  );
}

export function DemoNotice({ className }: { className?: string }) {
  return (
    <div className={cn('text-[11px] font-medium uppercase tracking-[0.14em] text-warn', className)}>
      Demo mode — test tokens have no cash value
    </div>
  );
}
