import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, write, addTask, commitBeforeBase, sh } from './helpers.mjs';

test('a push from a worktree with no evidence is gated, and a failing task is refused', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'T', title: 't', criteria: [{ verifier: { type: 'command', cmd: 'false' } }] });
  commitBeforeBase(r);
  write(r, { 'src/a.mjs': 'export const a = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'bad work (T)');
  const sha = sh(r, 'rev-parse', 'HEAD');
  const parent = sh(r, 'rev-parse', 'HEAD^');
  const wt = path.join(path.dirname(r), 'fresh');
  sh(r, 'worktree', 'add', '--detach', '--quiet', wt, sha);
  assert.equal(fs.existsSync(path.join(wt, '.proofline', 'evidence.jsonl')), false);
  const p = spawnSync('git', ['push', 'origin', 'HEAD:main'], { cwd: wt, encoding: 'utf8' });
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /proofline pre-push: REFUSED/);
  assert.match(p.stderr, new RegExp(`T at ${sha}`));
  assert.match(p.stderr, new RegExp(`base ${parent}`));
});

test('stale evidence in the pushing worktree cannot block a commit that passes', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'T', title: 't', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  commitBeforeBase(r);
  write(r, { 'src/a.mjs': 'export const a = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'good work (T)');
  const sha = sh(r, 'rev-parse', 'HEAD');
  fs.appendFileSync(path.join(r, '.proofline', 'evidence.jsonl'), '{"seq":0,"tampered":true}\n');
  const p = spawnSync('git', ['push', 'origin', 'HEAD:main'], { cwd: r, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stderr, new RegExp(`gated T at ${sha}`));
});
