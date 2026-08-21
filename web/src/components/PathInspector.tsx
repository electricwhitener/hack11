'use client';

import { Button } from '@/components/ui/button';

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
  exposure: number;
  risk: number;
  lat: number;
  lng: number;
  blockedSnippet: string;
  lightingSnippet: string;
};

const SOURCE_LABEL: Record<string, string> = {
  survey: 'surveyed on foot',
  osm: 'tagged in OpenStreetMap',
  simulated: 'estimated from road type',
};

/**
 * The confirmation step between clicking a path and reporting it.
 *
 * Reporting used to fire on the click itself, which made it easy to hit the
 * wrong path and impossible to tell what you had picked. Showing the path, what
 * we currently believe about it, and how much evidence stands behind that turns
 * a stray click into a deliberate act — and it is where the honest answer to
 * "can't someone just spam this?" becomes visible to the user.
 */
export function PathInspector({
  info,
  mode,
  onReport,
  onClose,
}: {
  info: PathInfo;
  mode: 'none' | 'report' | 'inspect';
  onReport: (span: number[], dark: boolean) => void;
  onClose: () => void;
}) {
  const pct = Math.round(info.darkness * 100);
  const evidence = info.darkReports + info.litReports;

  return (
    <div className="rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold leading-snug">{info.label}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Selected stretch: {info.meters} m
            <span className="text-muted-foreground/70"> · max {info.maxMeters} m per report</span>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>

      <div className="mt-3 space-y-2 rounded-lg bg-muted/50 p-3 text-xs">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">Believed unlit</span>
          <span
            className={`font-semibold tabular-nums ${pct > 50 ? 'text-amber-400' : 'text-emerald-400'}`}
          >
            {pct}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-background">
          <div
            className={pct > 50 ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">Night foot traffic</span>
          <span className="font-medium tabular-nums">{info.exposure.toFixed(3)}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {evidence === 0
            ? `No reports yet — ${SOURCE_LABEL[info.source] ?? info.source}.`
            : `${info.darkReports} dark / ${info.litReports} lit report${evidence > 1 ? 's' : ''} so far, on top of a starting estimate ${SOURCE_LABEL[info.source] ?? info.source}.`}
        </p>
      </div>

      {mode === 'report' ? (
        <>
          <p className="mt-3 text-xs font-medium">
            What is this {info.meters} m stretch like at night?
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => onReport(info.span, true)}>
              It&apos;s dark
            </Button>
            <Button size="sm" variant="outline" onClick={() => onReport(info.span, false)}>
              It&apos;s lit
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Only the highlighted {info.meters} m is affected — a long path is rarely dark end to
            end. One report shifts the estimate; it does not settle it. The stretch stays flagged
            <span className="text-amber-400"> unconfirmed</span> until someone else agrees.
          </p>
        </>
      ) : (
        <div className="mt-3">
          <p className="text-[11px] text-muted-foreground">
            Coordinates copied for <code className="text-foreground">docs/campus-data.json</code>:
          </p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted/50 p-2 text-[10px] leading-relaxed text-muted-foreground">
            {info.lightingSnippet}
          </pre>
        </div>
      )}
    </div>
  );
}
