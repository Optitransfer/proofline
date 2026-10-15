import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/contract.mjs';

const base = () => { const c = C.skeleton('p'); c.tasks.push(C.makeTask({ id: 'A', title: 'a', criteria: [{ verifier: { type: 'metric', cmd: 'b', key: 'p50', op: '<', value: 20 } }] })); return c; };

test('a task without a deterministic verifier is invalid', () => {
  const c = C.skeleton('p'); c.tasks.push(C.makeTask({ id: 'T', title: 't', criteria: [{ statement: 'it works' }] }));
  assert.match(C.validate(c).join(), /deterministic verifier/);
});
test('missing verifier fields and unknown deps are reported', () => {
  const c = C.skeleton('p'); c.tasks.push(C.makeTask({ id: 'T', title: 't', depends_on: ['Z'], criteria: [{ verifier: { type: 'metric', cmd: 'x' } }] }));
  const e = C.validate(c).join('\n'); assert.match(e, /missing "key"/); assert.match(e, /unknown Z/);
});
test('dependency cycles are rejected', () => {
  const c = base(); c.tasks.push(C.makeTask({ id: 'B', title: 'b', depends_on: ['C'], criteria: base().tasks[0].criteria }), C.makeTask({ id: 'C', title: 'c', depends_on: ['B'], criteria: base().tasks[0].criteria }));
  assert.match(C.validate(c).join(), /cycle/);
});
test('topo order respects phases then dependencies', () => {
  const k = base().tasks[0].criteria;
  const ts = [C.makeTask({ id: 'I', title: 'i', phase: 'implement', depends_on: ['D'], criteria: k }), C.makeTask({ id: 'D', title: 'd', phase: 'design', criteria: k })];
  assert.deepEqual(C.topo(ts).map((t) => t.id), ['D', 'I']);
});
test('loosening a threshold is a weakening', () => {
  const a = base(), b = base(); b.tasks[0].criteria[0].verifier.value = 200;
  assert.match(C.weakenings(a, b).join(), /threshold loosened/);
});
test('removing a criterion, non-mandatory, changed command and disabled rules are weakenings', () => {
  const a = base();
  const b = base(); b.tasks[0].criteria[0].mandatory = false; b.tasks[0].criteria[0].verifier.cmd = 'other'; b.forbidden.timeout_raise = false; b.forbidden.bypass_env = [];
  const w = C.weakenings(a, b).join('\n');
  assert.match(w, /non-mandatory/); assert.match(w, /command changed/); assert.match(w, /timeout_raise disabled/); assert.match(w, /SKIP_HOOKS/);
  const c = base(); c.tasks[0].criteria = [];
  assert.match(C.weakenings(a, c).join(), /criterion removed/);
});
test('tightening a threshold is not a weakening', () => {
  const a = base(), b = base(); b.tasks[0].criteria[0].verifier.value = 10;
  assert.deepEqual(C.weakenings(a, b), []);
});
