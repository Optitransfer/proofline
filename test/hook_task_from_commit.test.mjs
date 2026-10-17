import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, write, addTask, commitBeforeBase, sh } from './helpers.mjs';

const push = (r) => spawnSync('git', ['push', 'origin', 'HEAD:main'], { cwd: r, encoding: 'utf8' });

test('a commit that names no task is gated on the active task', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'OLD', title: 'old', criteria: [{ verifier: { type: 'command', cmd: 'false' } }] });
  commitBeforeBase(r);
  fs.writeFileSync(path.join(r, '.proofline', 'active'), 'OLD\n');
  write(r, { 'src/x.mjs': 'export const x = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'unnamed work');
  const p = push(r);
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /proofline pre-push: REFUSED/);
  assert.match(p.stderr, /OLD/);
});

test('a Proofline-Task trailer names the task, so a failing active task is not gated', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'OLD', title: 'old', criteria: [{ verifier: { type: 'command', cmd: 'false' } }] });
  addTask(r, { id: 'NEW', title: 'new', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  commitBeforeBase(r);
  fs.writeFileSync(path.join(r, '.proofline', 'active'), 'OLD\n');
  write(r, { 'src/y.mjs': 'export const y = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'new work\n\nProofline-Task: NEW\n');
  const p = push(r);
  assert.equal(p.status, 0, p.stderr);
});

test('before any task has a start record, a push that names no task passes and prints proofline next', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'OLD', title: 'old', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  commitBeforeBase(r);
  write(r, { 'src/boot.mjs': 'export const boot = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'baseline');
  const p = push(r);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stderr, /proofline next/);
});

test('a push with no active task and no named task is refused once a task has started', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'OLD', title: 'old', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  commitBeforeBase(r);
  spawnSync(process.execPath, [new URL('../bin/proofline.mjs', import.meta.url).pathname, 'next', '--root', r], { encoding: 'utf8' });
  fs.rmSync(path.join(r, '.proofline', 'active'), { force: true });
  write(r, { 'src/z.mjs': 'export const z = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'unnamed work');
  const p = push(r);
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /proofline next/);
});
