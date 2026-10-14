import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import * as P from '../src/index.mjs';
import { repo, addTask } from './helpers.mjs';

const BENCH = (v) => `console.log(JSON.stringify({ flushMs: ${v} }));\n`;
const NODE = execSync('node --version', { encoding: 'utf8' }).trim();
/** One metric task; `max` sets defaults.max_load_per_cpu. The load reader is injected, so no real load is needed. */
function metricRepo({ flushMs = 1200, max } = {}) {
  const r = repo({ files: { 'bench/b.mjs': BENCH(flushMs) } });
  if (max !== undefined) { const c = P.C.load(r); c.defaults.max_load_per_cpu = max; P.C.save(r, c); }
  addTask(r, { id: 'M', title: 'm', criteria: [{ verifier: { type: 'metric', cmd: 'node bench/b.mjs', key: 'flushMs', op: '<', value: 2000 } }] });
  P.taskNext(r);
  return r;
}
const load = (load1, cpus) => () => ({ load1, cpus });

test('metric evidence records the load, the CPU count and the node that ran the bench', () => {
  const r = metricRepo();
  const g = P.E.verifyTask(r, 'M', { machine: load(3.5, 4) });
  assert.equal(g.decision, 'PASS', g.blocked.concat(g.failing).join('\n'));
  assert.deepEqual(g.results[0].evidence.machine, { load1: 3.5, cpus: 4, load_per_cpu: 0.88, node: NODE });
  assert.match(g.results[0].detail, new RegExp(`flushMs = 1200 < 2000 \\(load 3\\.50 / 4 CPUs, node ${NODE.replace(/\./g, '\\.')}\\)`));
});

test('a load over defaults.max_load_per_cpu is BLOCKED with the numbers, never PASS or FAIL', () => {
  for (const flushMs of [1200, 9000]) {
    const r = metricRepo({ flushMs, max: 1 });
    const g = P.E.verifyTask(r, 'M', { machine: load(8, 4) });
    assert.equal(g.decision, 'BLOCKED', `flushMs ${flushMs}`);
    assert.deepEqual(g.failing, []);
    assert.match(g.blocked.join('\n'), /M-AC01: machine busy: load 8\.00 over 4 CPUs = 2\.00 per CPU > max_load_per_cpu 1/);
    assert.equal(g.results[0].status, 'blocked');
    assert.deepEqual(g.measured, {}, 'no number is taken from a busy machine');
    assert.match(P.E.steer(g, P.C.load(r)), /gate again on an idle machine/);
  }
  const idle = metricRepo({ max: 1 });
  assert.equal(P.E.verifyTask(idle, 'M', { machine: load(2, 4) }).decision, 'PASS');
  const unlimited = metricRepo({ flushMs: 9000 });
  const g = P.E.verifyTask(unlimited, 'M', { machine: load(8, 4) });
  assert.equal(g.decision, 'FAIL'); assert.equal(g.results[0].evidence.machine.load_per_cpu, 2);
});

test('max_load_per_cpu must be a positive number, and raising or removing it is a weakening', () => {
  const a = P.C.skeleton('p'); a.defaults.max_load_per_cpu = 'busy';
  assert.match(P.C.validate(a).join(), /defaults\.max_load_per_cpu must be a positive number/);
  a.defaults.max_load_per_cpu = 1;
  assert.deepEqual(P.C.validate(a), []);
  const raised = structuredClone(a); raised.defaults.max_load_per_cpu = 3;
  assert.match(P.C.weakenings(a, raised).join(), /max_load_per_cpu raised 1 → 3/);
  const removed = structuredClone(a); delete removed.defaults.max_load_per_cpu;
  assert.match(P.C.weakenings(a, removed).join(), /max_load_per_cpu removed/);
  const lowered = structuredClone(a); lowered.defaults.max_load_per_cpu = 0.5;
  assert.deepEqual(P.C.weakenings(a, lowered), []);
});
