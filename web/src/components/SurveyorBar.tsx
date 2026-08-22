'use client';

import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Surveyor = {
  authorised: boolean;
  available: boolean;
  checking: boolean;
  signIn: (candidate: string) => Promise<boolean>;
  signOut: () => void;
};

/**
 * Surveyor unlock.
 *
 * Hidden entirely unless SURVEY_PASSCODE is configured, so an ordinary visitor
 * never sees a control they cannot use — a locked door in the UI is worse than
 * no door at all.
 */
export function SurveyorBar({ surveyor }: { surveyor: Surveyor }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (surveyor.checking || !surveyor.available) return null;

  if (surveyor.authorised) {
    return (
      <button
        onClick={surveyor.signOut}
        title="Signed in as surveyor — click to sign out"
        className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary shadow-sm backdrop-blur transition-colors hover:bg-primary/20"
      >
        <ShieldCheck className="size-3.5" />
        Surveyor
      </button>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border bg-card/95 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
      >
        <KeyRound className="size-3.5" />
        Surveyor
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await surveyor.signIn(code.trim());
        setBusy(false);
        if (ok) {
          setOpen(false);
          setCode('');
          toast.success('Surveyor mode on', {
            description: 'Tap any path to record what it is actually like.',
          });
        } else {
          toast.error('That passcode did not work.');
        }
      }}
      className="flex items-center gap-1.5 rounded-lg border bg-card/95 p-1.5 shadow-lg backdrop-blur"
    >
      <Input
        autoFocus
        type="password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Passcode"
        className="h-7 w-28 text-xs"
      />
      <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={busy || !code.trim()}>
        {busy ? '…' : 'Unlock'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(false)}
      >
        ✕
      </Button>
    </form>
  );
}
