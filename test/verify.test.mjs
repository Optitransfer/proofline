import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as P from '../src/index.mjs';
import { repo, write, addTask, commitAll, sh } from './helpers.mjs';

const BENCH = (v) => `console.log('progress'); console.log(JSON.stringify({ flushMs: ${v}, writers1: { p50: 12 }, writers32: { savesPerSec: 640 } }));\n`;

test('metric: threshold met passes, missed fails with measured value', () => {
  const r = repo({ files: { 'bench/b.mjs': BENCH(1200) } });
  addTask(r, { id: 'M', title: 'm', criteria: [
    { verifier: { type: 'metric', cmd: 'node bench/b.mjs', key: 'flushMs', op: '<', value: 2000 } },
    { verifier: { type: 'metric', cmd: 'node bench/b.mjs', key: 'writers32.savesPerSec', op: '>', value: 500 } }] });
  P.taskNext(r);
  let g = P.E.verifyTask(r, 'M'); assert.equal(g.decision, 'PASS'); assert.equal(g.measured.flushMs, 1200);
  write(r, { 'bench/b.mjs': BENCH(14400) });
  g = P.E.verifyTask(r, 'M'); assert.equal(g.decision, 'FAIL'); assert.match(g.failing[0], /flushMs = 14400, needs < 2000/);
});

test('metric: missing bench rig is BLOCKED, never PASS', () => {
  const r = repo();
  addTask(r, { id: 'M', title: 'm', criteria: [{ verifier: { type: 'metric', cmd: 'node bench/missing.mjs', key: 'flushMs', op: '<', value: 2000 } }] });
  P.taskNext(r);
  const g = P.E.verifyTask(r, 'M'); assert.equal(g.decision, 'BLOCKED'); assert.deepEqual(g.blocked.map((b) => b.split(':')[0]), ['M-AC01']);
});

test('metric: regression vs baseline beyond tolerance fails even under the threshold', () => {
  const r = repo({ files: { 'bench/b.mjs': BENCH(1900) } });
  const c = P.C.load(r); c.baseline.metrics.flushMs = 1000; P.C.save(r, c);
  addTask(r, { id: 'M', title: 'm', criteria: [{ verifier: { type: 'metric', cmd: 'node bench/b.mjs', key: 'flushMs', op: '<', value: 2000 } }] });
  P.taskNext(r);
  const g = P.E.verifyTask(r, 'M'); assert.equal(g.decision, 'FAIL'); assert.match(g.failing.join(), /REGRESSION/);
});

test('command: flaky (fails then passes) is not a pass', () => {
  const r = repo({ files: { 'flaky.sh': 'if [ -f .once ]; then exit 0; fi; touch .once; exit 1\n' } });
  addTask(r, { id: 'F', title: 'f', criteria: [{ verifier: { type: 'command', cmd: 'bash flaky.sh' } }] });
  P.taskNext(r);
  const g = P.E.verifyTask(r, 'F'); assert.equal(g.results[0].status, 'flaky'); assert.equal(g.decision, 'FAIL');
});

test('command: hung/cancelled tests and too few tests fail', () => {
  const r = repo({ files: { 'fake.sh': 'echo "# tests 3"; echo "# pass 2"; echo "# cancelled 1"; exit 0\n' } });
  addTask(r, { id: 'H', title: 'h', criteria: [{ verifier: { type: 'command', cmd: 'bash fake.sh', min_tests: 10 } }] });
  P.taskNext(r);
  const g = P.E.verifyTask(r, 'H'); assert.equal(g.decision, 'FAIL'); assert.match(g.failing[0], /cancelled/); assert.match(g.failing[0], /requires ≥ 10/);
});

test('wiring: code built but unreachable from the entry fails; wired passes', () => {
  const r = repo({ files: { 'src/main.mjs': "import { a } from './a.mjs';\na();\n", 'src/a.mjs': 'export function a() {}\n', 'src/fast.mjs': 'export function fastSeal() {}\n' } });
  addTask(r, { id: 'W', title: 'w', criteria: [{ verifier: { type: 'wiring', entry: 'src/main.mjs', symbol: 'fastSeal' } }] });
  P.taskNext(r);
  assert.equal(P.E.verifyTask(r, 'W').decision, 'FAIL');
  write(r, { 'src/a.mjs': "import { fastSeal } from './fast.mjs';\nexport function a() { fastSeal(); }\n" });
  const g = P.E.verifyTask(r, 'W'); assert.equal(g.decision, 'PASS'); assert.deepEqual(g.results[0].evidence.chain, ['src/main.mjs', 'src/a.mjs']);
});

test('grep: default config flag must be on', () => {
  const r = repo({ files: { 'src/fastops.mjs': "export const defaults = { wait_default: 'sealed' };\n" } });
  addTask(r, { id: 'G', title: 'g', criteria: [{ verifier: { type: 'grep', file: 'src/fastops.mjs', pattern: "wait_default:\\s*'durable'" } }] });
  P.taskNext(r);
  assert.equal(P.E.verifyTask(r, 'G').decision, 'FAIL');
});

test('scope drift is detected', () => {
  const r = repo();
  addTask(r, { id: 'S', title: 's', scope: ['src/**'], criteria: [{ verifier: { type: 'scope' } }] });
  P.taskNext(r);
  write(r, { 'src/ok.mjs': '1', 'infra/deploy.yml': 'x' });
  const g = P.E.verifyTask(r, 'S'); assert.equal(g.decision, 'FAIL'); assert.match(g.failing[0], /infra\/deploy.yml/);
});

test('red-green: a test that already passes on base does not prove the change', () => {
  const r = repo({ files: { 'src/f.mjs': 'export const f = () => 1;\n' } });
  addTask(r, { id: 'R', title: 'r', criteria: [{ verifier: { type: 'test_red_green', test_file: 'test/f.test.mjs', cmd: 'node --test {test}' } }] });
  commitAll(r, 'task'); sh(r, 'push', '-q', 'origin', 'main');
  P.taskNext(r);
  write(r, { 'test/f.test.mjs': "import test from 'node:test'; import assert from 'node:assert';\nimport { f } from '../src/f.mjs';\ntest('f', () => assert.equal(f(), 1));\n" });
  let g = P.E.verifyTask(r, 'R'); assert.equal(g.decision, 'FAIL'); assert.match(g.failing[0], /PASSES on base/);
  write(r, { 'test/f.test.mjs': "import test from 'node:test'; import assert from 'node:assert';\nimport { f } from '../src/f.mjs';\ntest('f', () => assert.equal(f(), 2));\n", 'src/f.mjs': 'export const f = () => 2;\n' });
  g = P.E.verifyTask(r, 'R'); assert.equal(g.decision, 'PASS', g.failing.join());
});

test('contract weakened vs base is BLOCKED', () => {
  const r = repo({ files: { 'bench/b.mjs': BENCH(1200) } });
  addTask(r, { id: 'M', title: 'm', criteria: [{ verifier: { type: 'metric', cmd: 'node bench/b.mjs', key: 'flushMs', op: '<', value: 1000 } }] });
  commitAll(r, 'contract'); sh(r, 'push', '-q', 'origin', 'main');
  P.taskNext(r);
  const c = P.C.load(r); c.tasks[0].criteria[0].verifier.value = 5000; P.C.save(r, c);
  const g = P.E.verifyTask(r, 'M'); assert.equal(g.decision, 'BLOCKED'); assert.match(g.blocked.join(), /threshold loosened/); assert.equal(g.blocked.length, 1, g.blocked.join('\n'));
});

test('tampered evidence log BLOCKS the gate', () => {
  const r = repo();
  addTask(r, { id: 'X', title: 'x', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  P.taskNext(r);
  assert.equal(P.E.gate(r, 'X').decision, 'PASS');
  const f = path.join(r, '.proofline', 'evidence.jsonl'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"PASS"', '"FAIL"'));
  const g = P.E.verifyTask(r, 'X'); assert.equal(g.decision, 'BLOCKED'); assert.deepEqual(g.blocked.map((b) => b.split(' at ')[0]), ['evidence log tampered']);
});

test('gate writes Markdown + JSON reports and a corrective prompt per failed criterion', () => {
  const r = repo();
  addTask(r, { id: 'X', title: 'x', criteria: [{ statement: 'suite', verifier: { type: 'command', cmd: 'exit 3' } }] });
  P.taskNext(r);
  const g = P.E.gate(r, 'X');
  assert.equal(g.decision, 'FAIL');
  assert.ok(fs.existsSync(path.join(r, '.proofline/reports/X-latest.md')));
  assert.match(g.corrective_prompt, /X-AC01 \[command\] FAIL/); assert.match(g.corrective_prompt, /STOP RULES/);
  assert.match(fs.readFileSync(g.report, 'utf8'), /Known limits/);
});
