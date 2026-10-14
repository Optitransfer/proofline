// Result cache: a PASS of an expensive check (command, metric) on a clean tree runs once per HEAD and is reused.
// Opt-in per contract (defaults.reuse_results). The PASS is recorded in the evidence log; the cache file points at
// that entry, and a result is reused only from an entry that is still in an intact chain with the same hash.
import fs from 'node:fs';
import path from 'node:path';
import { git, sha256, canon, readJson } from './util.mjs';
import { record, readLog, verifyChain } from './evidence.mjs';

/** The only verifiers whose PASS is reused. The others are cheap, or depend on the base. */
export const REUSABLE = ['command', 'metric'];
export const DEFAULT_MAX_AGE_H = 24;
export const cacheDir = (root) => path.join(root, '.proofline', 'cache');
const cacheFile = (root, key) => path.join(cacheDir(root), `${key}.json`);

/** A contract's reuse settings: on only when defaults.reuse_results is true. */
export function settings(c) {
  const d = c.defaults || {};
  const age = d.reuse_max_age_h;
  return { on: d.reuse_results === true, maxAgeH: typeof age === 'number' && age > 0 ? age : DEFAULT_MAX_AGE_H, maxLoad: typeof d.max_load_per_cpu === 'number' ? d.max_load_per_cpu : undefined };
}

/** The env vars a check names: `$VAR` and `${VAR}` in its command, `{VAR}` in a metric's output_file. */
export function namedEnv(v) {
  const names = new Set();
  for (const m of String(v.cmd ?? '').matchAll(/\$\{?([A-Za-z_]\w*)/g)) names.add(m[1]);
  for (const m of String(v.output_file ?? '').matchAll(/\{(\w+)\}/g)) names.add(m[1]);
  return [...names].sort();
}

/**
 * The cache key of a criterion's verifier, or null when its result is neither reused nor stored: not a reusable
 * verifier, no HEAD, or a tree that differs from HEAD outside .proofline/ (an uncommitted edit never reuses a result).
 * The key holds the verifier (canonical JSON), HEAD, process.version and the values of the env vars the check names;
 * for a metric also its baseline and the regression tolerance, which decide its verdict.
 */
export function keyFor(root, v, { baseline, tolerancePct } = {}) {
  if (!REUSABLE.includes(v.type)) return null;
  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
  if (!head.ok || !head.out) return null;
  // --untracked-files=normal: an untracked file counts even where status.showUntrackedFiles=no hides it.
  const st = git(['status', '--porcelain', '--untracked-files=normal'], root);
  if (!st.ok || st.out.split('\n').some((l) => l && !l.includes('.proofline/'))) return null;
  const env = Object.fromEntries(namedEnv(v).map((n) => [n, v.env?.[n] ?? process.env[n] ?? null]));
  const k = { verifier: v, head: head.out, node: process.version, env };
  if (v.type === 'metric') Object.assign(k, { baseline: baseline?.[v.name || v.key] ?? null, tolerance_pct: tolerancePct ?? 20 });
  return { key: sha256(canon(k)), head: head.out };
}

/**
 * The evidence entry of a PASS that may be reused for `key`, or null (then the check runs). The cache file must name
 * an entry that is in an intact chain with the hash it stored, records a PASS for this key, is no older than
 * maxAgeH hours, and, for a metric, ran at a load per CPU within maxLoad when that is set.
 */
export function lookup(root, key, { maxAgeH = DEFAULT_MAX_AGE_H, maxLoad, now = Date.now() } = {}) {
  const c = readJson(cacheFile(root, key));
  if (!c || c.key !== key || c.status !== 'pass' || !Number.isInteger(c.entry)) return null;
  let e;
  try { if (!verifyChain(root).ok) return null; e = readLog(root)[c.entry]; } catch { return null; }
  if (!e || e.hash !== c.entry_hash || e.type !== 'result' || e.data?.key !== key || e.data.status !== 'pass') return null;
  const age = now - Date.parse(e.ts);
  if (!(age >= 0 && age <= maxAgeH * 3600e3)) return null;
  if (e.data.type === 'metric' && typeof maxLoad === 'number' && !(e.data.evidence?.machine?.load_per_cpu <= maxLoad)) return null;
  return e;
}

/** Record a fresh PASS in the evidence log and point the cache file for its key at that entry. Returns the entry. */
export function store(root, { key, head }, task, a, r) {
  const data = { task, criterion: a.id, type: a.verifier.type, key, head, status: r.status, detail: r.detail, evidence: r.evidence };
  const e = record(root, 'result', data);
  const f = cacheFile(root, key), tmp = `${f}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ ...data, ts: e.ts, entry: e.seq, entry_hash: e.hash }, null, 2) + '\n');
  fs.renameSync(tmp, f);
  return e;
}

/** A criterion's result taken from the evidence entry that recorded its PASS. */
export function reusedResult(e) {
  const from = `reused from ${e.ts} (evidence entry ${e.seq})`;
  return { status: 'pass', detail: `${from}: ${e.data.detail}`, evidence: { ...e.data.evidence, reused_from: { ts: e.ts, entry: e.seq, hash: e.hash, head: e.data.head } }, reused: { ts: e.ts, entry: e.seq } };
}
