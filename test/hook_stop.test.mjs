import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const BIN = path.resolve(import.meta.dirname, '..', 'bin', 'proofline.mjs');
const sh = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function repo() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-stop-'));
  sh(r, ['init', '-q', '-b', 'main']);
  sh(r, ['config', 'user.email', 't@t']);
  sh(r, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(r, 'a.txt'), 'a\n');
  sh(r, ['add', '-A']);
  sh(r, ['commit', '-q', '-m', 'work']);
  return r;
}

function transcript(dir, timestamp) {
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'user', timestamp, message: { role: 'user', content: 'go' } }) + '\n');
  return file;
}

function stop(root, payload) {
  try {
    const out = execFileSync(process.execPath, [BIN, 'hook', 'stop', '--root', root], {
      input: JSON.stringify(payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, out: out.trim(), err: '' };
  } catch (err) {
    return { code: err.status ?? 1, out: String(err.stdout || '').trim(), err: String(err.stderr || '') };
  }
}

function count(out) {
  if (!out) return 0;
  JSON.parse(out);
  return 1;
}

test('a commit in the session yields one receipt, and the same range yields none again', async () => {
  const r = repo();
  const file = transcript(r, '2000-01-01T00:00:00Z');
  const first = await stop(r, { transcript_path: file, cwd: r, session_id: 's1' });
  assert.equal(first.code, 0, first.err);
  assert.equal(count(first.out), 1);
  const second = await stop(r, { transcript_path: file, cwd: r, session_id: 's1' });
  assert.equal(second.code, 0, second.err);
  assert.equal(count(second.out), 0);
});

test('a session with no commit yields none', async () => {
  const r = repo();
  const file = path.join(r, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'user', timestamp: '2099-01-01T00:00:00Z' }) + '\n');
  const got = await stop(r, { transcript_path: file, cwd: r, session_id: 's2' });
  assert.equal(got.code, 0, got.err);
  assert.equal(count(got.out), 0);
});
