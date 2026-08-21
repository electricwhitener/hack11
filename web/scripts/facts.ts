/**
 * Dumps every figure the pitch deck quotes into docs/facts.json.
 *
 * The deck generator reads that file rather than hardcoding numbers, so the
 * slides cannot drift from what the product actually computes. Re-run both
 * after any change to the graph or the model.
 *
 *   npx tsx scripts/facts.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { areaStats, repairQueue, routePair, PLACES, meta } from '../src/lib/nightsafety';

const stats = areaStats();
const queue = repairQueue(8);

// Every hostel-to-destination walk: the trips students actually make at night.
// Hostel-to-hostel and destination-to-destination pairs are excluded because
// they are not the journeys this product exists to make safer.
const hostels = PLACES.filter((p) => p.kind === 'hostel');
const dests = PLACES.filter((p) => p.kind === 'dest');

const trips = [];
for (let i = 0; i < hostels.length; i++) {
  for (let j = 0; j < dests.length; j++) {
    const r = routePair(hostels[i].node, dests[j].node);
    trips.push({
      from: hostels[i].name,
      to: dests[j].name,
      meters: r.shortest.meters,
      darkBefore: r.shortest.darkMeters,
      darkAfter: r.safest.darkMeters,
      extraMeters: r.detourMeters,
      extraPct: r.detourPct,
      cutPct: r.darkReductionPct,
      identical: r.identical,
      worstAvoided: r.shortest.darkStretches[0] ?? null,
    });
  }
}
trips.sort((a, b) => b.cutPct - a.cutPct);

/**
 * The headline is the trip with the best safety-per-metre, not the biggest raw
 * percentage — "100% safer for a 64% detour" is a worse story than "99% safer
 * for one extra metre", because nobody takes the first deal.
 */
const headline = [...trips]
  .filter((t) => !t.identical && t.darkBefore > 150)
  .sort((a, b) => b.cutPct / Math.max(b.extraPct, 1) - a.cutPct / Math.max(a.extraPct, 1))[0];

const diverged = trips.filter((t) => !t.identical);
const median = diverged.length
  ? diverged.map((t) => t.cutPct).sort((a, b) => a - b)[Math.floor(diverged.length / 2)]
  : 0;

const facts = {
  generated: new Date().toISOString(),
  area: meta.area,
  bbox: meta.bbox,
  stats,
  model: {
    hostels: meta.hostels,
    destinations: meta.destinations,
    modelledTrips: meta.trips,
    darkByClass: meta.dark_by_class,
  },
  queue,
  queueTop5Pct: Number(queue.slice(0, 5).reduce((a, q) => a + q.benefitPct, 0).toFixed(1)),
  trips,
  headline,
  /** Runners-up, so the deck can show the pattern rather than one lucky case. */
  bestValue: [...trips]
    .filter((t) => !t.identical && t.darkBefore > 150)
    .sort((a, b) => b.cutPct / Math.max(b.extraPct, 1) - a.cutPct / Math.max(a.extraPct, 1))
    .slice(0, 6),
  routing: {
    total: trips.length,
    diverged: diverged.length,
    medianCutPct: median,
    medianDetourPct: diverged.length
      ? diverged.map((t) => t.extraPct).sort((a, b) => a - b)[Math.floor(diverged.length / 2)]
      : 0,
  },
};

const out = join(process.cwd(), '..', 'docs', 'facts.json');
mkdirSync(join(process.cwd(), '..', 'docs'), { recursive: true });
writeFileSync(out, JSON.stringify(facts, null, 2));

console.log(`wrote docs/facts.json`);
console.log(`  headline: ${facts.headline.from} -> ${facts.headline.to}`);
console.log(`            ${facts.headline.cutPct}% less dark for +${facts.headline.extraMeters}m (${facts.headline.extraPct}%)`);
console.log(`  routing : ${facts.routing.diverged}/${facts.routing.total} diverged, median cut ${facts.routing.medianCutPct}%`);
console.log(`  queue   : top-5 removes ${facts.queueTop5Pct}% of area risk`);
