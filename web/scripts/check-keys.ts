/**
 * Validates every Gemini key against the live API before you trust it in a demo.
 *
 * A dead or quota-exhausted key is invisible until the agent silently falls
 * through to the next one — and if they are ALL dead you find out on stage.
 * Run this after adding keys, and again right before judging.
 *
 *   cd web && npx tsx -r dotenv/config scripts/check-keys.ts
 *   (add DOTENV_CONFIG_PATH=.env.local if your keys live there)
 */

import { API_KEYS, MODEL_CHAIN } from '../src/lib/ai/provider';

const mask = (k: string) => `${k.slice(0, 6)}…${k.slice(-4)}`;

async function probe(key: string, model: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
      signal: AbortSignal.timeout(25_000),
    });
    if (res.ok) return { ok: true, note: 'ready' };
    const body = await res.text();
    if (/RESOURCE_EXHAUSTED|quota/i.test(body)) return { ok: false, note: 'quota spent today' };
    if (/API_KEY_INVALID|API key not valid/i.test(body)) return { ok: false, note: 'INVALID KEY' };
    if (/not found|NOT_FOUND/i.test(body)) return { ok: false, note: 'model unavailable' };
    if (/PERMISSION_DENIED/i.test(body)) return { ok: false, note: 'PERMISSION DENIED' };
    return { ok: false, note: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message.slice(0, 40) : 'network error' };
  }
}

async function main() {
  if (API_KEYS.length === 0) {
    console.log('No keys found. Set GOOGLE_GENERATIVE_AI_API_KEYS="k1,k2,k3".');
    process.exit(1);
  }

  console.log(`${API_KEYS.length} key(s) x ${MODEL_CHAIN.length} model(s)\n`);
  let live = 0;

  for (const [i, key] of API_KEYS.entries()) {
    console.log(`key${i + 1}  ${mask(key)}`);
    for (const model of MODEL_CHAIN) {
      const { ok, note } = await probe(key, model);
      if (ok) live++;
      console.log(`   ${ok ? 'OK  ' : '--  '} ${model.padEnd(30)} ${note}`);
    }
    console.log();
  }

  const total = API_KEYS.length * MODEL_CHAIN.length;
  console.log(`${live}/${total} (key, model) pairs live  ~=  ${live * 20} requests/day`);
  if (live === 0) console.log('\nNOTHING IS LIVE. The agent will fail. Fix before judging.');
}

void main();
