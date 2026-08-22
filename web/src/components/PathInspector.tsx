'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type PathInfo = {
  label: string;
  wayId: number;
  span: number[];
  meters: number;
  maxMeters: number;
  segments: number;
  lit: boolean;
  darkness: number;
  darkReports: number;
  litReports: number;
  confidence: number;
  source: string;
  surveyed?: boolean;
  exposure: number;
  risk: number;
  lat: number;
  lng: number;
  blocked?: boolean;
};

export type SurveyLighting = 'lit' | 'dim' | 'dark';
export type SurveyTraffic = 'high' | 'medium' | 'low';

/**
 * One observation, not a whole row.
 *
 * The traffic buttons used to call onSurvey with a lighting value derived from
 * the current estimate — `darkness > 0.5 ? 'dark' : 'lit'` — which promoted the
 * model's own guess to surveyed ground truth at prior strength 8, and silently
 * rewrote any existing 'dim' survey to one of the other two. Correcting the
 * foot traffic now says nothing whatever about the lighting.
 */
export type SurveyPatch = {
  lighting?: SurveyLighting;
  traffic?: SurveyTraffic;
  note?: string | null;
};

/** Where the current belief came from, in words a person would use. */
const ORIGIN: Record<string, string> = {
  survey: 'Someone walked this and checked',
  osm: 'From the public map data',
  simulated: 'Estimated from the type of path',
};

/**
 * What we currently think, as a sentence rather than a number.
 *
 * A raw "darkness 0.52" means nothing to somebody standing on a footpath. The
 * probability is still shown as a bar, but the headline has to be language.
 */
function verdict(darkness: number): { text: string; tone: string } {
  if (darkness >= 0.75) return { text: 'Unlit', tone: 'text-red-400' };
  if (darkness > 0.5) return { text: 'Probably unlit', tone: 'text-amber-400' };
  if (darkness >= 0.35) return { text: 'Patchy', tone: 'text-amber-400' };
  return { text: 'Lit', tone: 'text-emerald-400' };
}

/**
 * What everyone who has walked here thinks.
 *
 * Showing the split rather than a single verdict is the honest presentation:
 * "3 of 4 say unlit" carries its own uncertainty, where "unlit" hides it.
 */
function Consensus({ dark, lit }: { dark: number; lit: number }) {
  const total = dark + lit;
  if (total === 0) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Nobody has reported this stretch yet. You would be the first.
      </p>
    );
  }

  const agree = Math.max(dark, lit);
  const majority = dark >= lit ? 'unlit' : 'lit';
  const split = dark > 0 && lit > 0;

  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-background">
        <div className="bg-amber-500" style={{ width: `${(dark / total) * 100}%` }} />
        <div className="bg-emerald-500" style={{ width: `${(lit / total) * 100}%` }} />
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">
          {agree} of {total}
        </span>{' '}
        {total === 1 ? 'report says' : 'reports say'} {majority}
        {split ? ' — people disagree here, so more reports would help.' : '.'}
      </p>
    </div>
  );
}

export function PathInspector({
  info,
  canSurvey,
  onReport,
  onSurvey,
  onBlock,
  onClearSurvey,
  onClose,
}: {
  info: PathInfo;
  canSurvey: boolean;
  onReport: (span: number[], dark: boolean) => void;
  onSurvey: (span: number[], patch: SurveyPatch) => void;
  onBlock: (span: number[], blocked: boolean) => void;
  onClearSurvey: (span: number[]) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [undoing, setUndoing] = useState(false);
  const v = verdict(info.darkness);
  const pct = Math.round(info.darkness * 100);

  return (
    <div className="rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold leading-snug">{info.label}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {info.meters} m selected · max {info.maxMeters} m at a time
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>

      <div className="mt-3 space-y-2.5 rounded-lg bg-muted/50 p-3">
        <div className="flex items-baseline justify-between">
          <span className={`text-lg font-semibold ${v.tone}`}>{v.text}</span>
          <span className="text-[11px] text-muted-foreground">{pct}% likely unlit</span>
        </div>
        <Consensus dark={info.darkReports} lit={info.litReports} />
        <p className="text-[11px] text-muted-foreground">
          {ORIGIN[info.source] ?? info.source} · foot traffic {info.exposure.toFixed(2)}
        </p>
      </div>

      <p className="mt-3 text-xs font-medium">What is this stretch like right now?</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button size="sm" onClick={() => onReport(info.span, true)}>
          It&apos;s dark
        </Button>
        <Button size="sm" variant="outline" onClick={() => onReport(info.span, false)}>
          It&apos;s lit
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        One report shifts the estimate; two agreeing settle it. Only the {info.meters} m you
        selected changes.
      </p>

      {canSurvey ? (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            Surveyor
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            This overrides the estimate outright, so use it only for what you can see.
          </p>

          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {(
              [
                ['lit', 'Lit', 'bg-yellow-400/15 text-yellow-300 hover:bg-yellow-400/25'],
                ['dim', 'Dim', 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'],
                ['dark', 'Unlit', 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'],
              ] as const
            ).map(([value, label, cls]) => (
              <button
                key={value}
                onClick={() => onSurvey(info.span, { lighting: value, note: note.trim() || undefined })}
                className={`rounded-md px-2 py-2 text-xs font-medium transition-colors ${cls}`}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="mt-3 text-[11px] font-medium text-muted-foreground">
            …and if the foot traffic looks wrong:
          </p>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {(
              [
                ['high', 'Busy'],
                ['medium', 'Some'],
                ['low', 'Quiet'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => onSurvey(info.span, { traffic: value })}
                className="rounded-md border bg-background px-2 py-1.5 text-[11px] transition-colors hover:bg-secondary"
              >
                {label}
              </button>
            ))}
          </div>

          {/* This box used to be write-only: whatever was typed here was never
              sent anywhere. It now rides along with a lighting record, and can
              be saved on its own. */}
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — e.g. two lamps out"
            className="mt-2.5 h-8 text-xs"
          />
          {note.trim() ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-1.5 w-full"
              onClick={() => onSurvey(info.span, { note: note.trim() })}
            >
              Save this note
            </Button>
          ) : (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Saved with whatever you record above.
            </p>
          )}

          <div className="mt-3 border-t pt-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Can this stretch be walked at all?
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Mark a fence, a wall, or a lawn the map thinks is a path. Blocked stretches are
              removed from routing entirely, which is what stops illegal shortcuts.
            </p>
            <Button
              size="sm"
              variant={info.blocked ? 'default' : 'outline'}
              className="mt-2 w-full"
              onClick={() => onBlock(info.span, !info.blocked)}
            >
              {info.blocked ? 'Blocked — tap to unblock' : 'Not walkable — block it'}
            </Button>
          </div>

          {info.surveyed ? (
            <div className="mt-3 border-t pt-3">
              <p className="text-[11px] font-medium text-muted-foreground">Got this one wrong?</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Withdraws the survey on this stretch — lighting, foot traffic, note and block —
                and puts it back on the modelled estimate. Recording a different value instead
                would still read as something somebody checked.
              </p>
              {undoing ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                    onClick={() => onClearSurvey(info.span)}
                  >
                    Withdraw it
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setUndoing(false)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 w-full"
                  onClick={() => setUndoing(true)}
                >
                  Undo this survey
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
