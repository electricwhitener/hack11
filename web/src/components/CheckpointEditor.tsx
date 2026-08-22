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
};

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
  // Deleting is destructive, permanent, and one thumb-width from Save on the
  // phone this is used on. Two taps, no dialog to dismiss in the dark.
  const [confirming, setConfirming] = useState(false);
  const editing = Boolean(draft.id);

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
          onSave({ ...draft, name: name.trim(), kind, note: note.trim() || null });
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

        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional) — e.g. locked after 9:15pm"
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
