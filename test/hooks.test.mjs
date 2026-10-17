import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as P from '../src/index.mjs';
import { repo, write, addTask, commitBeforeBase, sh } from './helpers.mjs';

const hooksDir = (r) => path.join(r, '.git', 'hooks');
/** A hook that logs its args and stdin next to the repo (not inside it), then exits with `code`. */
function ownHook(r, name, code) {
  const out = path.join(path.dirname(r), name);
  const body = `#!/bin/sh\necho "$@" > "${out}.args"\ncat > "${out}.stdin"\necho "${name} guard says ${code}" >&2\nexit ${code}\n`;
  fs.writeFileSync(path.join(hooksDir(r), name), body, { mode: 0o755 });
  return { body, out };
}
const snapshot = (r) => Object.fromEntries(fs.readdirSync(hooksDir(r)).filter((f) => !f.endsWith('.sample')).map((f) => {
  const p = path.join(hooksDir(r), f); return [f, { mode: fs.statSync(p).mode, text: fs.readFileSync(p, 'utf8') }];
}));
const push = (r) => spawnSync('git', ['push', 'origin', 'main'], { cwd: r, encoding: 'utf8' });

test('init keeps an existing pre-push hook; when it fails, the push is refused', () => {
  const r = repo();
  const { body, out } = ownHook(r, 'pre-push', 1);
  P.init(r);
  assert.equal(fs.readFileSync(path.join(hooksDir(r), 'pre-push.proofline-prev'), 'utf8'), body);
  write(r, { 'src/x.mjs': 'export const x = 1;\n' });
  sh(r, 'add', '-A'); sh(r, 'commit', '-q', '-m', 'x');
  const p = push(r);
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /pre-push guard says 1/);
  assert.doesNotMatch(p.stderr, /proofline pre-push: REFUSED/);
  assert.match(fs.readFileSync(`${out}.args`, 'utf8'), /^origin /);
  assert.match(fs.readFileSync(`${out}.stdin`, 'utf8'), /^refs\/heads\/main [0-9a-f]{40} refs\/heads\/main [0-9a-f]{40}$/m);
});

test('an existing pre-push hook that passes lets the proofline gate run', () => {
  const r = repo();
  const { out } = ownHook(r, 'pre-push', 0);
  P.init(r);
  addTask(r, { id: 'A', title: 'a', criteria: [{ verifier: { type: 'command', cmd: 'false' } }] });
  commitBeforeBase(r);
  P.taskNext(r);
  write(r, { 'src/c.mjs': 'export const c = 1;\n' });
  sh(r, 'add', '-A'); sh(r, 'commit', '-q', '-m', 'c');
  const p = push(r);
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /pre-push guard says 0/);
  assert.match(p.stderr, /proofline pre-push: REFUSED/);
  assert.ok(fs.existsSync(`${out}.stdin`));
});

test('an existing pre-commit hook that fails still blocks the commit after init', () => {
  const r = repo();
  ownHook(r, 'pre-commit', 1);
  P.init(r);
  write(r, { 'src/x.mjs': 'export const x = 1;\n' });
  sh(r, 'add', '-A');
  const c = spawnSync('git', ['commit', '-m', 'x'], { cwd: r, encoding: 'utf8' });
  assert.notEqual(c.status, 0); assert.match(c.stderr, /pre-commit guard says 1/);
});

test('a second init changes nothing and never loses the original hook', () => {
  const r = repo();
  const { body } = ownHook(r, 'pre-push', 0);
  const first = P.init(r);
  assert.ok(first.made.some((m) => /pre-push\.proofline-prev/.test(m)), first.made.join());
  const before = snapshot(r);
  const second = P.init(r);
  assert.deepEqual(snapshot(r), before);
  assert.equal(before['pre-push.proofline-prev'].text, body);
  assert.ok(!second.made.some((m) => /proofline-prev/.test(m)), second.made.join());
  assert.equal(fs.readFileSync(path.join(hooksDir(r), 'pre-push'), 'utf8').match(/proofline-prev"/g).length, 1, 'chained once');
});

test('without an existing hook nothing is chained', () => {
  const r = repo();
  P.init(r);
  assert.ok(!fs.existsSync(path.join(hooksDir(r), 'pre-push.proofline-prev')));
  assert.ok(!fs.existsSync(path.join(hooksDir(r), 'pre-commit.proofline-prev')));
});
