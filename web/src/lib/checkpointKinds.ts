/**
 * The kinds of point a surveyor can place.
 *
 * Lives here rather than in the editor because the API validates against the
 * same list. A `kind` the editor cannot render is worse than a rejected save:
 * the point comes back grey, with no button selected, and nothing on screen
 * says why — which is exactly how `entrance` survived in the database after
 * the gate rework.
 *
 * "Entrance" and "Exit" used to be separate options, which forced a false
 * choice: almost every gate on this campus works in both directions, and there
 * was no way to say so. A gate is now one kind that goes both ways, with
 * one-way variants for the cases that really are one-way.
 *
 * These are not decoration. On this campus these points are the ONLY lawful way
 * between the hostel, the campus and the outside, so mapping them precisely is
 * what stops the router inventing a shortcut through a wall.
 */
export const CHECKPOINT_KINDS: { value: string; label: string; colour: string; hint?: string }[] = [
  { value: 'gate', label: 'Gate', colour: '#F8B324', hint: 'Goes both ways' },
  { value: 'entry_only', label: 'Entry only', colour: '#13A34B', hint: 'In, not out' },
  { value: 'exit_only', label: 'Exit only', colour: '#5B9DFF', hint: 'Out, not in' },
  { value: 'emergency', label: 'Security / medical', colour: '#EB442C' },
  { value: 'shop', label: 'Shop / food', colour: '#C084FC' },
  { value: 'landmark', label: 'Landmark', colour: '#94A3B8' },
];

export const DEFAULT_KIND = 'gate';

/**
 * Kinds written before the gate rework, mapped onto what they meant.
 *
 * Applied on read as well as on write, so rows already in Postgres render
 * correctly without a migration — and correct themselves the next time
 * somebody saves them.
 */
const LEGACY: Record<string, string> = {
  entrance: 'gate',
  exit: 'gate',
  entry: 'entry_only',
  checkpoint: 'landmark',
  security: 'emergency',
  medical: 'emergency',
  food: 'shop',
};

/**
 * True for a kind we can actually store: a current one, or a legacy alias.
 *
 * Separate from normaliseKind because normaliseKind always returns something
 * valid — so validating with it alone would accept every string on earth and
 * quietly file it as a gate.
 */
export function isKnownKind(kind: string | null | undefined): boolean {
  const k = (kind ?? '').trim().toLowerCase();
  return CHECKPOINT_KINDS.some((c) => c.value === k) || k in LEGACY;
}

/** A kind the editor and the map can both render, whatever came in. */
export function normaliseKind(kind: string | null | undefined): string {
  const k = (kind ?? '').trim().toLowerCase();
  if (CHECKPOINT_KINDS.some((c) => c.value === k)) return k;
  return LEGACY[k] ?? DEFAULT_KIND;
}

export const kindColour = (kind: string) =>
  CHECKPOINT_KINDS.find((k) => k.value === normaliseKind(kind))?.colour ?? '#94A3B8';
