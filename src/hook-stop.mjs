// Claude Code Stop hook: one receipt for the commits a session made, and none on the next run.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReceipt } from './receipt.mjs';

export const STOP_COMMAND = 'proofline hook stop';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function sessionStart(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const ts = row.timestamp || row.ts;
      if (typeof ts === 'string' && ts) return ts;
    } catch { /* a later line may carry the time */ }
  }
  return null;
}

function markerFile(root) {
  return path.join(root, '.proofline', 'session');
}

function readMarker(root) {
  try { return JSON.parse(fs.readFileSync(markerFile(root), 'utf8')); }
  catch { return null; }
}

function commitsSince(root, since) {
  const out = git(root, ['rev-list', `${since}..HEAD`]);
  return out ? out.split('\n').filter(Boolean) : [];
}

function commitsForSession(root, start, sessionId) {
  const found = new Set();
  const startMs = start ? Date.parse(start) : NaN;
  if (!Number.isNaN(startMs)) {
    const out = git(root, ['log', '--format=%H%x09%cI']);
    for (const line of out.split('\n')) {
      const [sha, when] = line.split('\t');
      if (sha && Date.parse(when) >= startMs) found.add(sha);
    }
  }
  if (sessionId) {
    try {
      const out = git(root, ['log', '-F', '--format=%H', `--grep=Agent-Run: ${sessionId}`]);
      for (const sha of out.split('\n')) if (sha) found.add(sha);
    } catch { /* a git that rejects the flag still keeps the commits matched by time */ }
  }
  return [...found];
}

export async function hookStop(root, payload = {}) {
  let head = '';
  try { head = git(root, ['rev-parse', 'HEAD']); }
  catch { return { receipts: [] }; }
  const marker = readMarker(root);
  if (marker?.receipted === head) return { receipts: [] };
  let commits = [];
  try {
    commits = marker?.receipted
      ? commitsSince(root, marker.receipted)
      : commitsForSession(root, sessionStart(payload.transcript_path), payload.session_id || '');
  } catch { return { receipts: [] }; }
  if (!commits.length) return { receipts: [] };
  let base = marker?.receipted;
  if (!base) {
    try { base = git(root, ['rev-parse', `${commits[commits.length - 1]}^`]); }
    catch { base = undefined; }
  }
  const receipt = await buildReceipt(root, { base, role: 'claude-code' });
  fs.mkdirSync(path.dirname(markerFile(root)), { recursive: true });
  fs.writeFileSync(markerFile(root), JSON.stringify({ session_id: payload.session_id || '', receipted: head }) + '\n');
  return { receipts: [{ ...receipt, role: 'claude-code' }] };
}

export function connectClaudeCode(home = os.homedir()) {
  const file = path.join(home, '.claude', 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return { ok: false, file, reason: 'settings.json is not plain JSON, so nothing was changed' }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, file, reason: 'settings.json is not an object, so nothing was changed' };
    }
    settings = parsed;
  }
  const hooks = settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks) ? settings.hooks : {};
  const stop = Array.isArray(hooks.Stop) ? hooks.Stop.slice() : [];
  if (!stop.some((entry) => JSON.stringify(entry).includes(STOP_COMMAND))) {
    stop.push({ hooks: [{ type: 'command', command: STOP_COMMAND }] });
  }
  settings.hooks = { ...hooks, Stop: stop };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { ok: true, file };
}
