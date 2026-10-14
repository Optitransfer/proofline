import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Stable JSON (sorted keys) so hashes are reproducible. */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}

/** Run a shell command; never throws. */
export function run(cmd, { cwd, timeoutS = 600, env } = {}) {
  const t = performance.now();
  // NODE_TEST_CONTEXT leaks from an enclosing `node --test` and makes a nested `node --test` exit 0 regardless of failures.
  const e = { ...process.env, ...env }; delete e.NODE_TEST_CONTEXT;
  const r = spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', timeout: timeoutS * 1000, env: e, maxBuffer: 64 << 20 });
  const ms = Math.round(performance.now() - t);
  const timedOut = r.error?.code === 'ETIMEDOUT';
  return { cmd, cwd, exit: timedOut ? 124 : (r.status ?? 1), stdout: r.stdout || '', stderr: (r.stderr || '') + (r.error && !timedOut ? String(r.error) : ''), ms, timedOut };
}

export function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export const tail = (s, n = 1500) => (s.length > n ? '…' + s.slice(-n) : s);

/** Minimal glob → RegExp: ** , * , ? */
export function globRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
export const matchAny = (p, globs) => globs.some((g) => globRe(g).test(p));

/** Read a dotted path like "writers32.savesPerSec" from an object. */
export const pick = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

export function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
export function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); }

/** Last JSON object found in a text (bench scripts print JSON as the last line). */
export function lastJson(text) {
  const lines = text.trim().split('\n').reverse();
  for (const l of lines) { const s = l.trim(); if (s.startsWith('{')) { try { return JSON.parse(s); } catch {} } }
  try { return JSON.parse(text); } catch { return undefined; }
}
