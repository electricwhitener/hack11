'use client';

import { useState } from 'react';
import { EyeOff, RotateCcw, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type PlaceEdit = { name: string; kind: 'hostel' | 'dest'; renamed: boolean };

/**
 * Correct one imported OpenStreetMap landmark.
 *
 * These are not surveyor-placed points — they come from graph.json, which is
 * frozen because regenerating it renumbers every segment and orphans the
 * survey. So they cannot be edited at source and cannot be truly deleted; a
 * correction is overlaid on the import instead. Hiding one takes it off the
 * map, out of both destination pickers and out of the agent's list.
 *
 * Mounted with a `key` tied to the place, so the fields reseed per landmark.
 */
export function PlaceEditor({
  place,
  onRename,
  onHide,
  onRestore,
  onCancel,
}: {
  place: PlaceEdit;
  onRename: (name: string, displayName: string) => void;
  onHide: (name: string) => void;
  onRestore: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(place.name);
  const [confirming, setConfirming] = useState(false);
  const changed = name.trim() && name.trim() !== place.name;

  return (
    <div className="panel-in rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <Landmark className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Imported landmark</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {place.kind === 'hostel' ? 'Hostel' : 'Destination'}
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        From OpenStreetMap, not placed by a surveyor. It cannot be edited at
        source, so this overlays a correction on the import.
      </p>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name shown on the map"
        className="mt-3 h-9 text-sm"
      />

      {confirming ? (
        <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2">
          <p className="text-[11px] leading-relaxed text-foreground">
            Hide <span className="font-medium">{place.name}</span>? It leaves the map, both
            destination pickers and the agent&apos;s list. Foot traffic already modelled through
            it stays baked into the graph.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              onClick={() => onHide(place.name)}
            >
              Hide it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={!changed}
            onClick={() => onRename(place.name, name.trim())}
          >
            Rename
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)} aria-label="Hide">
            <EyeOff className="size-3.5" />
          </Button>
          {place.renamed ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRestore(place.name)}
              aria-label="Restore the imported name"
              title="Restore the imported name"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
