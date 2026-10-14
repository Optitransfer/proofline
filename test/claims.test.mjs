import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { parseClaims } from '../src/claims.mjs';
import { repo, write, addTask, commitAll, sh } from './helpers.mjs';

test('parses status lines and ignores other tables', () => {
  const c = parseClaims('| X-1 | done | abc1234 | t.test.mjs | p50 12 ms | - |\nfoo | bar\nY | partial | - | - | - | seal', ['X-1', 'Y']);
  assert.equal(c.length, 2); assert.equal(c[0].commit, 'abc1234'); assert.equal(c[1].missing, 'seal');
});

test('claimed numbers must match measured numbers', () => {
  const r = repo({ files: { 'bench/b.mjs': "console.log(JSON.stringify({ p50: 128 }))\n", 'test/t.test.mjs': "import test from 'node:test'; test('t', () => {});\n" } });
  addTask(r, { id: 'P', title: 'p', criteria: [{ verifier: { type: 'metric', cmd: 'node bench/b.mjs', key: 'p50', op: '<', value: 200 } }] });
  P.taskNext(r);
  commitAll(r); sh(r, 'push', '-q', 'origin', 'main');
  const head = sh(r, 'rev-parse', '--short', 'HEAD');
  const g = P.E.verifyTask(r, 'P', { claims: `P | done | ${head} | t.test.mjs | p50 15 ms | -` });
  assert.equal(g.decision, 'FAIL'); assert.match(g.failing.join(), /claimed p50 15 but measured 128/);
  const ok = P.E.verifyTask(r, 'P', { claims: `P | done | ${head} | t.test.mjs | p50 128 ms | -` });
  assert.equal(ok.decision, 'PASS', ok.failing.join());
});

test('done with no measurements, unknown commit, missing test, deferral are all rejected', () => {
  const r = repo({ files: { 'bench/b.mjs': "console.log(JSON.stringify({ p50: 5 }))\n" } });
  addTask(r, { id: 'P', title: 'p', criteria: [{ verifier: { type: 'metric', cmd: 'node bench/b.mjs', key: 'p50', op: '<', value: 20 } }] });
  const g = P.E.verifyTask(r, 'P', { claims: 'P | done | deadbeef1 | ghost_test.mjs | fast | rest is a follow-up' });
  const f = g.failing.join('\n');
  for (const re of [/does not exist/, /ghost_test.mjs" not found/, /no measured numbers/, /follow-up/]) assert.match(f, re);
});
