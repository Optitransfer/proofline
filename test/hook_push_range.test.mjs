import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { repo, write, addTask, sh } from './helpers.mjs';
import { hookPrePush } from '../src/index.mjs';

function push(r, args) {
  return spawnSync('git', ['push', ...args], { cwd: r, encoding: 'utf8' });
}

test('a rebased branch does not gate a commit already on main', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'MAIN', title: 'm', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  addTask(r, { id: 'BRANCH', title: 'b', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  write(r, { 'src/tasks.mjs': 'export const tasks = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'add the two tasks');
  push(r, ['origin', 'HEAD:main']);
  sh(r, 'checkout', '-q', '-b', 'feature');
  write(r, { 'src/branch.mjs': 'export const branch = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'branch work (BRANCH)');
  const first = push(r, ['origin', 'HEAD:feature']);
  assert.equal(first.status, 0, first.stderr);
  sh(r, 'checkout', '-q', 'main');
  write(r, { 'src/main.mjs': 'export const main = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'main work (MAIN)');
  const landed = push(r, ['origin', 'HEAD:main']);
  assert.equal(landed.status, 0, landed.stderr);
  sh(r, 'checkout', '-q', 'feature');
  sh(r, 'rebase', '-q', 'main');
  const again = push(r, ['--force-with-lease', 'origin', 'HEAD:feature']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stderr, /gated BRANCH at /);
  assert.doesNotMatch(again.stderr, /gated MAIN at /);
});

test('a commit that is not on a remote yet is still gated', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'MAIN', title: 'm', criteria: [{ verifier: { type: 'command', cmd: 'false' } }] });
  addTask(r, { id: 'BRANCH', title: 'b', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  write(r, { 'src/tasks.mjs': 'export const tasks = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'add the two tasks');
  push(r, ['origin', 'HEAD:main']);
  sh(r, 'checkout', '-q', '-b', 'feature');
  write(r, { 'src/branch.mjs': 'export const branch = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'branch work (BRANCH)');
  const first = push(r, ['origin', 'HEAD:feature']);
  assert.equal(first.status, 0, first.stderr);
  sh(r, 'checkout', '-q', 'main');
  write(r, { 'src/main.mjs': 'export const main = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'main work (MAIN)');
  sh(r, 'checkout', '-q', 'feature');
  sh(r, 'rebase', '-q', 'main');
  const again = push(r, ['--force-with-lease', 'origin', 'HEAD:feature']);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /MAIN at /);
});

const send = (r, args) => spawnSync('git', ['push', ...args], { cwd: r, encoding: 'utf8' });
function setup() {
  const r = repo({ hooks: true });
  addTask(r, { id: 'MAIN', title: 'm', criteria: [{ verifier: { type: 'command', cmd: 'false' } }] });
  write(r, { 'src/tasks.mjs': 'export const tasks = 1;\n' });
  sh(r, 'add', '-A'); sh(r, 'commit', '-q', '-m', 'add the task');
  send(r, ['origin', 'HEAD:main']);
  write(r, { 'src/main.mjs': 'export const main = 1;\n' });
  sh(r, 'add', '-A'); sh(r, 'commit', '-q', '-m', 'main work (MAIN)');
  return r;
}
const forge = (r) => sh(r, 'update-ref', 'refs/remotes/origin/elsewhere', 'HEAD');

test('main, control', () => { assert.notEqual(send(setup(), ['origin', 'HEAD:main']).status, 0); });
test('main, forged ref', () => { const r = setup(); forge(r); assert.notEqual(send(r, ['origin', 'HEAD:main']).status, 0); });
test('new branch, control', () => { assert.notEqual(send(setup(), ['origin', 'HEAD:refs/heads/fresh']).status, 0); });
test('new branch, forged ref', () => { const r = setup(); forge(r); assert.notEqual(send(r, ['origin', 'HEAD:refs/heads/fresh']).status, 0); });

test('an unreadable server gates every commit in the range', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'MAIN', title: 'm', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  addTask(r, { id: 'BRANCH', title: 'b', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  write(r, { 'src/main.mjs': 'export const main = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'main work (MAIN)');
  const landed = push(r, ['origin', 'HEAD:main']);
  assert.equal(landed.status, 0, landed.stderr);
  write(r, { 'src/branch.mjs': 'export const branch = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'branch work (BRANCH)');
  const local = sh(r, 'rev-parse', 'HEAD');
  const line = `refs/heads/fresh ${local} refs/heads/fresh ${'0'.repeat(40)}`;
  const url = sh(r, 'remote', 'get-url', 'origin');
  const open = hookPrePush(r, { lines: [line], pushUrl: url });
  assert.equal(open.ok, true, open.msg);
  assert.match(open.msg, /gated BRANCH at /);
  assert.doesNotMatch(open.msg, /gated MAIN at /);
  const shut = hookPrePush(r, { lines: [line], pushUrl: '/tmp/proofline-no-such-remote' });
  assert.equal(shut.ok, true, shut.msg);
  assert.match(shut.msg, /gated BRANCH at /);
  assert.match(shut.msg, /gated MAIN at /);
});
