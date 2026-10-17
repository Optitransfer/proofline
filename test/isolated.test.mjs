import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as E from '../src/engine.mjs';
import * as P from '../src/index.mjs';
import { repo, addTask, commitBeforeBase, parentAfterContract } from './helpers.mjs';

function withTask(criteria) {
  const r = repo();
  addTask(r, { id: 'T', title: 'Isolation', criteria });
  commitBeforeBase(r);
  parentAfterContract(r);
  return r;
}

test('a local verify records isolated false', () => {
  const r = withTask([{ id: 'T-1', statement: 'file', verifier: { type: 'grep', file: 'package.json', pattern: 'module', must: 'present' } }]);
  const out = E.verifyTask(r, 'T', { base: 'HEAD~1' });
  assert.equal(out.isolated, false);
  assert.equal(out.env_digest, null);
  assert.equal(out.heuristic, true);
  assert.equal(out.decision, 'PASS');
});

test('--isolated without env.image names that item', () => {
  const r = withTask([{ id: 'T-1', statement: 'cmd', verifier: { type: 'command', cmd: 'echo ok', expect_exit: 0 } }]);
  const out = E.verifyTask(r, 'T', { base: 'HEAD~1', isolated: true });
  assert.equal(out.decision, 'BLOCKED');
  assert.match(out.blocked.join('\n'), /env\.image/);
  assert.equal(out.isolated, false);
});

test('the fixture pins the image digest and an isolated command records it', () => {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/tb06/contract.json'), 'utf8'));
  const image = fixture.env?.image || '';
  assert.match(image, /^node:22\.11\.0@sha256:[0-9a-f]{64}$/);
  const r = withTask([{ id: 'T-1', statement: 'home and read-only', verifier: { type: 'command', cmd: '[ "$HOME" = /tmp ] && ! touch probe-write', expect_exit: 0 } }]);
  const c = P.C.load(r);
  c.env = { image };
  P.C.save(r, c);
  commitBeforeBase(r);
  parentAfterContract(r);
  const out = E.verifyTask(r, 'T', { base: 'HEAD~1', isolated: true });
  assert.equal(out.isolated, true, out.blocked?.join('\n') || out.failing?.join('\n'));
  assert.ok(out.env_digest?.includes(image));
  assert.match(out.env_digest || '', /node=v?\d/);
  assert.equal(out.decision, 'PASS');
});
