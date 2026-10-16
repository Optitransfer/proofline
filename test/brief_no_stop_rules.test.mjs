import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/contract.mjs';
import { brief, steer } from '../src/engine.mjs';

test('brief and steer do not throw when a loaded task has no stop_rules', () => {
  const t = C.makeTask({
    id: 'B',
    title: 'b',
    scope: ['**'],
    criteria: [{ statement: 'scope', verifier: { type: 'scope' } }],
  });
  delete t.stop_rules;
  const c = { ...C.skeleton('t'), tasks: [t] };
  assert.equal(typeof brief(c, t), 'string');
  const text = steer({
    task: 'B',
    decision: 'FAIL',
    head: 'a'.repeat(40),
    base: 'b'.repeat(40),
    base_ref: 'HEAD',
    base_source: 'default',
    blocked: [],
    results: [],
    forbidden: [],
    claims: [],
  }, c);
  assert.equal(typeof text, 'string');
  assert.match(text, /STOP RULES:/);
});
