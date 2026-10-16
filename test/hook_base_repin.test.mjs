import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as P from '../src/index.mjs';
import { repo, write, addTask, sh } from './helpers.mjs';

test('a second start of the same task moves the base, and the refusal names the base used', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'T', title: 't', criteria: [{ verifier: { type: 'command', cmd: 'false' } }] });
  const first = P.taskNext(r);
  const b1 = first.base;
  assert.equal(b1, sh(r, 'rev-parse', 'origin/main'));
  write(r, { 'src/pin.mjs': 'export const pin = 1;\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'move the pin (T)');
  const b2 = sh(r, 'rev-parse', 'HEAD');
  const second = P.taskNext(r, { base: b2 });
  assert.equal(second.base, b2);
  assert.notEqual(b2, b1);
  const p = spawnSync('git', ['push', 'origin', 'HEAD:main'], { cwd: r, encoding: 'utf8' });
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /proofline pre-push: REFUSED/);
  assert.match(p.stderr, new RegExp(`base ${b2}`));
  assert.doesNotMatch(p.stderr, new RegExp(`base ${b1}`));
});
