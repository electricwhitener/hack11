'use client';

import { useState } from 'react';
import { Trash2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type Checkpoint = {
  id?: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  note?: string | null;
};

/**
 * The kinds that matter for routing legality.
 *
 * "Entrance" and "Exit" used to be separate options, which forced a false
 * choice: almost every gate on this campus works in both directions, and there
 * was no way to say so. A gate is now one kind that goes both ways, with
 * one-way variants for the cases that really are one-way.
 *
 * These are not decoration. On this campus they are the ONLY lawful way between
 * the hostel, the campus and the outside, so mapping them precisely is what
 * stops the router inventing a shortcut through a wall.
 */
export const CHECKPOINT_KINDS: { value: string; label: string; colour: string; hint?: string }[] = [
  { value: 'gate', label: 'Gate', colour: '#F8B324', hint: 'Goes both ways' },
  { value: 'entry_only', label: 'Entry only', colour: '#13A34B', hint: 'In, not out' },
  { value: 'exit_only', label: 'Exit only', colour: '#5B9DFF', hint: 'Out, not in' },
  { value: 'emergency', label: 'Security / medical', colour: '#EB442C' },
  { value: 'shop', label: 'Shop / food', colour: '#C084FC' },
  { value: 'landmark', label: 'Landmark', colour: '#94A3B8' },
];

export const kindColour = (kind: string) =>
  CHECKPOINT_KINDS.find((k) => k.value === kind)?.colour ?? '#94A3B8';

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
  const [kind, setKind] = useState(draft.kind || 'gate');
  const [note, setNote] = useState(draft.note ?? '');
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

        <div className="flex gap-2 pt-1">
          <Button type="submit" size="sm" className="flex-1" disabled={!name.trim()}>
            {editing ? 'Save changes' : 'Add point'}
          </Button>
          {editing && onDelete ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onDelete(draft.id!)}
              aria-label="Delete point"
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
