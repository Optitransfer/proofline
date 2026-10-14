import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { repo, addTask } from './helpers.mjs';

const ok = [{ verifier: { type: 'command', cmd: 'true' } }];
const bad = [{ verifier: { type: 'command', cmd: 'false' } }];

test('next returns one task at a time, gated by phase and dependencies', () => {
  const r = repo();
  addTask(r, { id: 'IMP-2', title: 'b', phase: 'implement', depends_on: ['IMP-1'], criteria: ok });
  addTask(r, { id: 'IMP-1', title: 'a', phase: 'implement', criteria: ok });
  addTask(r, { id: 'DES-1', title: 'd', phase: 'design', criteria: bad });
  let n = P.taskNext(r); assert.equal(n.task, 'DES-1'); assert.match(n.brief, /# TASK DES-1/);
  assert.equal(P.E.gate(r, 'DES-1').decision, 'FAIL');
  assert.equal(P.taskNext(r).task, 'DES-1', 'design phase not verified: implement must wait');
  const c = P.C.load(r); c.tasks.find((t) => t.id === 'DES-1').criteria = ok; P.C.save(r, c);
  P.E.gate(r, 'DES-1');
  n = P.taskNext(r); assert.equal(n.task, 'IMP-1');
  P.E.gate(r, 'IMP-1');
  assert.equal(P.taskNext(r).task, 'IMP-2');
  P.E.gate(r, 'IMP-2');
  assert.equal(P.taskNext(r).done, true);
  const st = P.status(r); assert.equal(st.phases.find((p) => p.phase === 'implement').verified, 2); assert.equal(st.chain.ok, true);
});

test('brief contains every criterion, the loop, forbidden list, stop rules and report format', () => {
  const r = repo();
  addTask(r, { id: 'T', title: 't', criteria: [{ statement: 'fast', verifier: { type: 'metric', cmd: 'node b.mjs', key: 'p50', op: '<', value: 20 } }] });
  const b = P.taskNext(r).brief;
  for (const s of ['p50` < 20', 'Mandatory loop', 'Forbidden', 'Stop rules', 'T | done/partial/not done/blocked']) assert.ok(b.includes(s), s);
});
