'use client';

import { useState } from 'react';
import { Trash2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CHECKPOINT_KINDS, normaliseKind } from '@/lib/checkpointKinds';

export type Checkpoint = {
  id?: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  note?: string | null;
  barrier?: 'hard' | 'permission' | null;
  closes?: string | null;
  opens?: string | null;
  permit?: string | null;
};

/**
 * What a gate DOES, as four cases a surveyor can pick standing in front of it.
 *
 * The note field used to be the only place hours could be written, and nothing
 * read it — "locked after 8:00 PM" was prose the router never saw. These map
 * onto the barrier model the router already understands.
 */
type Access = 'open' | 'hours' | 'permit' | 'shut';

const ACCESS: { value: Access; label: string; hint: string }[] = [
  { value: 'open', label: 'Open to all', hint: 'Just a marker' },
  { value: 'hours', label: 'Shuts at night', hint: 'Nobody passes' },
  { value: 'permit', label: 'Needs a permit', hint: 'Outpass, pass…' },
  { value: 'shut', label: 'Always shut', hint: 'Acts as a wall' },
];

function accessOf(c: Checkpoint): Access {
  if (!c.barrier) return 'open';
  if (c.barrier === 'permission') return 'permit';
  return c.closes && c.opens ? 'hours' : 'shut';
}

/**
 * Edit one surveyor-placed point.
 *
 * MOUNTED WITH A `key` TIED TO THE POINT. These fields are `useState`
 * initialisers, which run once per mount — without the key, tapping a second
 * pin left the first pin's name and kind in the form and saving wrote them
 * onto the second point.
 */
export function CheckpointEditor({
  draft,
  onSave,
  onDelete,
  onCancel,
}: {
  draft: Checkpoint;
  onSave: (c: Checkpoint) => void;
  onDelete?: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(draft.name);
  const [kind, setKind] = useState(normaliseKind(draft.kind));
  const [note, setNote] = useState(draft.note ?? '');
  const [access, setAccess] = useState<Access>(accessOf(draft));
  const [closes, setCloses] = useState(draft.closes ?? '21:15');
  const [opens, setOpens] = useState(draft.opens ?? '05:00');
  const [permit, setPermit] = useState(draft.permit ?? '');
  // Deleting is destructive, permanent, and one thumb-width from Save on the
  // phone this is used on. Two taps, no dialog to dismiss in the dark.
  const [confirming, setConfirming] = useState(false);
  const editing = Boolean(draft.id);

  /** The four cases collapsed back onto the router's barrier model. */
  function accessFields(): Pick<Checkpoint, 'barrier' | 'closes' | 'opens' | 'permit'> {
    if (access === 'open') return { barrier: null, closes: null, opens: null, permit: null };
    if (access === 'shut') return { barrier: 'hard', closes: null, opens: null, permit: null };
    if (access === 'permit') {
      return { barrier: 'permission', closes: null, opens: null, permit: permit.trim() || 'a pass' };
    }
    return { barrier: 'hard', closes, opens, permit: null };
  }

  return (
    <div className="panel-in rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <MapPin className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{editing ? 'Edit point' : 'New point'}</h3>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}
        </span>
      </div>

      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSave({
            ...draft,
            name: name.trim(),
            kind,
            note: note.trim() || null,
            ...accessFields(),
          });
        }}
      >
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name — e.g. AB1 North Gate"
          className="h-9 text-sm"
        />

        <div className="grid grid-cols-3 gap-1.5">
          {CHECKPOINT_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              title={k.hint}
              className={`rounded-md border px-1.5 py-1.5 text-[11px] leading-tight transition-colors ${
                kind === k.value
                  ? 'border-transparent font-medium text-background'
                  : 'bg-background text-muted-foreground hover:text-foreground'
              }`}
              style={kind === k.value ? { backgroundColor: k.colour } : undefined}
            >
              {k.label}
              {k.hint ? (
                <span className="block text-[9px] font-normal opacity-75">{k.hint}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* This is the part the router reads. The note below is for people. */}
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
            Can this be walked through?
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {ACCESS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setAccess(a.value)}
                className={`rounded-md border px-1.5 py-1.5 text-[11px] leading-tight transition-colors ${
                  access === a.value
                    ? 'border-primary bg-primary/20 font-medium text-foreground'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {a.label}
                <span className="block text-[9px] font-normal opacity-75">{a.hint}</span>
              </button>
            ))}
          </div>

          {access === 'hours' ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Input
                value={closes}
                onChange={(e) => setCloses(e.target.value)}
                placeholder="21:15"
                aria-label="Closes at"
                className="h-7 flex-1 text-xs tabular-nums"
              />
              <span className="text-[10px] text-muted-foreground">until</span>
              <Input
                value={opens}
                onChange={(e) => setOpens(e.target.value)}
                placeholder="05:00"
                aria-label="Opens at"
                className="h-7 flex-1 text-xs tabular-nums"
              />
            </div>
          ) : null}

          {access === 'permit' ? (
            <Input
              value={permit}
              onChange={(e) => setPermit(e.target.value)}
              placeholder="What gets you through — e.g. outpass"
              className="mt-1.5 h-7 text-xs"
            />
          ) : null}

          {access !== 'open' ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
              {access === 'shut'
                ? 'No route will use the paths through here, at any hour.'
                : access === 'permit'
                  ? 'Routes may use it, but will say the permit is needed.'
                  : 'Routes will avoid it between those hours.'}
            </p>
          ) : null}
        </div>

        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional) — shown to walkers"
          className="h-8 text-xs"
        />

        {confirming && editing && onDelete ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2">
            <p className="text-[11px] leading-relaxed text-foreground">
              Delete <span className="font-medium">{draft.name || 'this point'}</span> for good?
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="flex-1"
                onClick={() => onDelete(draft.id!)}
              >
                Delete it
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" className="flex-1" disabled={!name.trim()}>
              {editing ? 'Save changes' : 'Add point'}
            </Button>
            {editing && onDelete ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirming(true)}
                aria-label="Delete point"
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
