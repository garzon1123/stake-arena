import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AVATARS, AVATAR_COLORS, USERNAME_RE } from '@stake-arena/shared';
import { api } from '../lib/api';
import { cn } from '../lib/format';
import { useSession } from '../wallet/WalletContext';
import { Button, Dialog, PlayerAvatar } from './ui';

export function ProfileDialog({ open, onOpenChange, firstRun }: { open: boolean; onOpenChange: (o: boolean) => void; firstRun?: boolean }) {
  const { me, refreshMe } = useSession();
  const p = me?.player;
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState<string>('knight');
  const [color, setColor] = useState<string>('violet');
  const [bio, setBio] = useState('');

  useEffect(() => {
    if (open && p) {
      setUsername(p.username ?? '');
      setAvatar(p.avatar);
      setColor(p.avatarColor);
      setBio(p.bio);
    }
  }, [open, p]);

  const valid = USERNAME_RE.test(username);
  const save = useMutation({
    mutationFn: () => api('/api/me/profile', { method: 'PUT', body: { username, avatar, avatarColor: color, bio } }),
    onSuccess: () => {
      refreshMe();
      toast.success(firstRun ? 'Welcome to the Arena' : 'Profile updated');
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!firstRun}
      title={firstRun ? 'Create your player card' : 'Edit profile'}
      description={firstRun ? 'Everyone starts at 1200 Elo. Your rating is earned one game at a time.' : undefined}
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <div className="flex items-center gap-4">
          <PlayerAvatar avatar={avatar} color={color} size={56} />
          <div className="flex-1">
            <label htmlFor="username" className="text-xs font-medium text-fg-muted">Username</label>
            <input
              id="username"
              autoFocus
              value={username}
              maxLength={20}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. nimzo_fan"
              className="mt-1 h-10 w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-sm outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
              aria-invalid={username.length > 0 && !valid}
            />
            <div className={cn('mt-1 text-[11px]', username && !valid ? 'text-loss' : 'text-fg-subtle')}>3–20 letters, numbers or underscores</div>
          </div>
        </div>

        <fieldset>
          <legend className="text-xs font-medium text-fg-muted">Avatar</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {AVATARS.map((a) => (
              <button
                type="button"
                key={a}
                aria-label={a}
                aria-pressed={avatar === a}
                onClick={() => setAvatar(a)}
                className={cn('rounded-full p-0.5 transition', avatar === a ? 'ring-2 ring-accent' : 'opacity-60 hover:opacity-100')}
              >
                <PlayerAvatar avatar={a} color={color} size={36} />
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            {AVATAR_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                aria-label={`${c} color`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cn('rounded-full p-0.5 transition', color === c ? 'ring-2 ring-white/70' : 'opacity-70 hover:opacity-100')}
              >
                <PlayerAvatar avatar="pawn" color={c} size={22} className="text-[0px]" />
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="bio" className="text-xs font-medium text-fg-muted">Short bio <span className="text-fg-subtle">(optional)</span></label>
          <textarea
            id="bio"
            value={bio}
            maxLength={160}
            rows={2}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Favorite opening, club, or trash talk (keep it friendly)"
            className="mt-1 w-full resize-none rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={!valid} loading={save.isPending}>
          {firstRun ? 'Enter the Arena' : 'Save changes'}
        </Button>
      </form>
    </Dialog>
  );
}
