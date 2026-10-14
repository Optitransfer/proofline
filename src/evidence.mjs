// Append-only, hash-chained evidence log: .proofline/evidence.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { sha256, canon } from './util.mjs';

export const GENESIS = '0'.repeat(64);
export const logPath = (root) => path.join(root, '.proofline', 'evidence.jsonl');

export function readLog(root) {
  const f = logPath(root);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function entryHash(e) {
  const { hash, ...body } = e;
  return sha256(canon(body));
}

/** Append an event. Returns the stored entry. Writes with O_APPEND + fsync. */
export function record(root, type, data, { actor = 'proofline' } = {}) {
  const log = readLog(root);
  const prev = log.length ? log.at(-1).hash : GENESIS;
  const e = { seq: log.length, ts: new Date().toISOString(), type, actor, data, prev };
  e.hash = entryHash(e);
  const f = logPath(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const fd = fs.openSync(f, 'a');
  try { fs.writeSync(fd, JSON.stringify(e) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return e;
}

/** Verify the chain. Any edit, deletion or reorder breaks it. */
export function verifyChain(root) {
  const log = readLog(root);
  let prev = GENESIS;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.seq !== i) return { ok: false, at: i, reason: 'sequence gap or reorder' };
    if (e.prev !== prev) return { ok: false, at: i, reason: 'prev hash mismatch (entry removed or edited)' };
    if (entryHash(e) !== e.hash) return { ok: false, at: i, reason: 'entry hash mismatch (entry edited)' };
    prev = e.hash;
  }
  return { ok: true, entries: log.length, head: prev };
}
