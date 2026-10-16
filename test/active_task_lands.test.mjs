import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as P from '../src/index.mjs';
import { repo, write, addTask, sh, BIN } from './helpers.mjs';

const run = (r, ...a) => spawnSync(process.execPath, [BIN, ...a, '--root', r], { encoding: 'utf8' });
const activeFile = (r) => path.join(r, '.proofline', 'active');
const active = (r) => fs.readFileSync(activeFile(r), 'utf8').trim();

function twoTasks() {
  const r = repo();
  addTask(r, { id: 'OLD', title: 'old', criteria: [{ verifier: { type: 'command', cmd: 'false' } }] });
  addTask(r, { id: 'NEW', title: 'new', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  return r;
}

test('next and verify clear an active task whose head is an ancestor of origin/main', () => {
  const r = twoTasks();
  const first = run(r, 'next');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(active(r), 'OLD');
  write(r, { 'src/old.mjs': 'export const old = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'land the old work (OLD)');
  sh(r, 'push', '-q', 'origin', 'main');
  const n = run(r, 'next');
  assert.equal(n.status, 0, n.stderr);
  assert.match(n.stdout, /OLD landed: its head [0-9a-f]{8} is an ancestor of origin\/main/);
  assert.match(n.stdout, /Cleared \.proofline\/active/);
  assert.equal(active(r), 'NEW');
  fs.writeFileSync(activeFile(r), 'OLD\n');
  const v = run(r, 'verify', 'OLD');
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /OLD landed: its head [0-9a-f]{8} is an ancestor of origin\/main/);
  assert.equal(fs.existsSync(activeFile(r)), false);
});

test('the pre-push hook clears a landed active task and gates the task the new commit names', () => {
  const r = twoTasks();
  run(r, 'next');
  write(r, { 'src/old.mjs': 'export const old = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'land the old work (OLD)');
  sh(r, 'push', '-q', 'origin', 'main');
  P.installHooks(r);
  write(r, { 'src/new.mjs': 'export const n = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'new work (NEW)');
  fs.writeFileSync(activeFile(r), 'OLD\n');
  const p = spawnSync('git', ['push', 'origin', 'HEAD:main'], { cwd: r, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stderr, /OLD landed: its head [0-9a-f]{8} is an ancestor of origin\/main/);
  assert.equal(fs.existsSync(activeFile(r)), false);
});

test('a pushed PASS record lands the task only at the head it was recorded at', () => {
  const r = twoTasks();
  const head = sh(r, 'rev-parse', 'HEAD').trim();
  fs.mkdirSync(path.join(r, '.proofline', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(r, '.proofline', 'reports', 'OLD-latest.json'), JSON.stringify({
    head,
    results: [{ id: 'OLD-AC01', type: 'pushed', status: 'pass' }],
  }));
  fs.writeFileSync(activeFile(r), 'OLD\n');
  const n = run(r, 'next');
  assert.equal(n.status, 0, n.stderr);
  assert.match(n.stdout, /OLD landed: its pushed criterion has a PASS record/);
  assert.equal(active(r), 'NEW');
  // A commit beyond that head makes the task live again. Nothing clears the active file.
  fs.writeFileSync(activeFile(r), 'OLD\n');
  write(r, { 'src/more.mjs': 'export const more = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'more work');
  const again = run(r, 'next');
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /OLD landed/);
  assert.equal(active(r), 'OLD');
  P.installHooks(r);
  write(r, { 'src/more2.mjs': 'export const more2 = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'still unnamed');
  fs.writeFileSync(activeFile(r), 'OLD\n');
  const p = spawnSync('git', ['push', 'origin', 'HEAD:main'], { cwd: r, encoding: 'utf8' });
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /OLD/);
  assert.doesNotMatch(p.stderr, /no active task and no commit names a task/);
});
