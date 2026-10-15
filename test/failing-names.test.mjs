import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../src/index.mjs';
import { repo, write, addTask } from './helpers.mjs';

// A stack trace as node prints it under a failure: long enough that a few of them fill the 1,200-character tail.
const stack = (n) => Array.from({ length: 8 }, (_, i) => `      at TestContext.<anonymous> (file:///repo/test/suite-${n}.test.mjs:${10 + i}:${3 + i})`).join('\n');
const yaml = (n) => ["  ---", "  duration_ms: 1.25", "  failureType: 'testCodeFailure'", "  error: 'expected 1 to equal 2'", "  stack: |-", stack(n), "  ..."].join('\n');

const NAMES = [
  'store keeps insertion order', 'parses # comments', 'nested child fails', 'rejects an empty key',
  'rounds (half) up', 'spec nested child fails', 'retries a 503 three times', 'closes the socket on error',
  'reads a 4k body', 'colour line fails', 'dot run: lock is released', 'dot run: index is rebuilt',
];
const TODOS = ['todo: not built yet', 'todo with a reason'];
const SKIP = 'skip on this platform';

// node-style output from three runs of one suite command: a TAP run, a spec run with its "failing tests:" summary,
// and a dot run, whose names appear only in its "Failed tests:" section. The names that matter come early.
const SUITE = [
  'TAP version 13',
  '# Subtest: store keeps insertion order', 'not ok 1 - store keeps insertion order', yaml(1),
  '# Subtest: parses \\# comments', 'not ok 2 - parses \\# comments', yaml(2),
  '# Subtest: group', '    # Subtest: nested child fails', '    not ok 1 - nested child fails', yaml(3), '    1..1',
  'ok 3 - group',
  '# Subtest: rejects an empty key', 'not ok 4 - rejects an empty key', yaml(4),
  '# Subtest: todo: not built yet', 'not ok 5 - todo: not built yet # TODO', yaml(5),
  '# Subtest: skip on this platform', 'not ok 6 - skip on this platform # SKIP no fifo here',
  'ok 7 - passes',
  '1..7',
  '✔ passes (0.9ms)',
  '✖ rounds (half) up (2.104ms)',
  '▶ spec group', '  ✖ spec nested child fails (0.31ms)', '✔ spec group (0.6ms)',
  '✖ retries a 503 three times (12.5ms)',
  '✖ todo with a reason (0.4ms) # waits on the parser',
  '﹣ skip on this platform (0.1ms) # SKIP',
  '✖ closes the socket on error (3ms)',
  '✖ reads a 4k body (1.5ms)',
  '\x1b[31m✖ colour line fails \x1b[90m(7.25ms)\x1b[39m\x1b[39m',
  'ℹ tests 16', 'ℹ suites 0', 'ℹ pass 1', 'ℹ fail 12', 'ℹ cancelled 0', 'ℹ skipped 1', 'ℹ todo 2', 'ℹ duration_ms 812.5',
  '', '✖ failing tests:', '',
  ...['rounds (half) up (2.104ms)', 'spec nested child fails (0.31ms)', 'retries a 503 three times (12.5ms)', 'todo with a reason (0.4ms) # waits on the parser', 'closes the socket on error (3ms)', 'reads a 4k body (1.5ms)', 'colour line fails (7.25ms)']
    .flatMap((l, i) => ['', `test at test/suite.test.mjs:${20 + i}:1`, `✖ ${l}`, "  AssertionError [ERR_ASSERTION]: expected 1 to equal 2", stack(20 + i)]),
  '', 'X..X', '', 'Failed tests:', '',
  '✖ dot run: lock is released (4.4ms)', "  Error: lock held", stack(40),
  '✖ dot run: index is rebuilt (5.5ms)', "  Error: index stale", stack(41),
  '',
].join('\n');

const failingRepo = (files, cmd) => {
  const r = repo({ files });
  addTask(r, { id: 'N', title: 'n', criteria: [{ verifier: { type: 'command', cmd } }] });
  P.taskNext(r);
  return r;
};
const names10 = (ns) => ns.slice(0, 10).join(', ');

test('a failed suite names every failing test from the full output, not only the tail', () => {
  const r = failingRepo({ 'suite.out': SUITE }, 'cat suite.out; exit 1');
  const g = P.E.verifyTask(r, 'N');
  const res = g.results[0];
  assert.equal(res.status, 'fail');
  for (const run of [res.evidence.first, res.evidence.rerun]) {
    // the defect: the tail keeps the last few names only
    assert.ok(run.out_tail.length <= 1201, 'out_tail stays the 1,200-character tail');
    const inTail = NAMES.filter((n) => run.out_tail.includes(n));
    assert.ok(inTail.length <= 3 && !inTail.includes(NAMES[0]), `the fixture puts most failures outside the tail: ${inTail}`);
    assert.deepEqual(run.failing, NAMES);
    assert.equal(run.failing.length, run.counts.fail);
    assert.equal(run.failing_total, undefined);
    for (const n of [...TODOS, SKIP]) assert.ok(!run.failing.includes(n), `${n} is a todo or skip, not a failure`);
  }
  assert.match(res.detail, /failed again on re-run/);
  assert.ok(res.detail.includes(`12 tests failed: ${names10(NAMES)} and 2 more`), res.detail);
  assert.ok(g.failing[0].includes(`12 tests failed: ${names10(NAMES)}`), g.failing[0]);

  const md = fs.readFileSync(P.E.gate(r, 'N').report, 'utf8');
  const sec = md.split('## Failing tests')[1].split('\n## ')[0];
  for (const n of NAMES) assert.ok(sec.includes(n), `gate report names ${n}`);
  for (const n of [...TODOS, SKIP]) assert.ok(!sec.includes(n), `gate report leaves out ${n}`);
});

test('a flaky suite records the failing names of both runs', () => {
  const FIRST = ['timer fires once', 'port 4100 is free'];
  const r = failingRepo({
    'fail.out': ['✔ boots (1ms)', ...FIRST.map((n) => `✖ ${n} (2ms)`), 'ℹ tests 3', 'ℹ pass 1', 'ℹ fail 2', '', '✖ failing tests:', '', ...FIRST.flatMap((n) => [`✖ ${n} (2ms)`, stack(1)])].join('\n'),
    'pass.out': ['✔ boots (1ms)', ...FIRST.map((n) => `✔ ${n} (2ms)`), 'ℹ tests 3', 'ℹ pass 3', 'ℹ fail 0'].join('\n'),
  }, 'if [ -f .once ]; then cat pass.out; exit 0; fi; touch .once; cat fail.out; exit 1');
  const res = P.E.verifyTask(r, 'N').results[0];
  assert.equal(res.status, 'flaky');
  assert.deepEqual(res.evidence.first.failing, FIRST);
  assert.deepEqual(res.evidence.rerun.failing, []);
  assert.ok(res.detail.includes(`2 tests failed: ${FIRST.join(', ')}`), res.detail);

  fs.rmSync(`${r}/.once`);
  const md = fs.readFileSync(P.E.gate(r, 'N').report, 'utf8');
  const sec = md.split('## Failing tests')[1].split('\n## ')[0];
  assert.match(sec, /FLAKY/);
  assert.match(sec, /first run.*timer fires once, port 4100 is free/);
  assert.match(sec, /re-run.*none/);
});

test('failing names are capped at 100 and failing_total keeps the count', () => {
  const all = Array.from({ length: 150 }, (_, i) => `case ${i + 1}`);
  const r = failingRepo({ 'suite.out': ['TAP version 13', ...all.map((n, i) => `not ok ${i + 1} - ${n}`), '1..150', '# tests 150', '# fail 150'].join('\n') }, 'cat suite.out; exit 1');
  const res = P.E.verifyTask(r, 'N').results[0];
  for (const run of [res.evidence.first, res.evidence.rerun]) {
    assert.deepEqual(run.failing, all.slice(0, 100));
    assert.equal(run.failing_total, 150);
  }
  assert.ok(res.detail.includes(`150 tests failed: ${names10(all)} and 140 more`), res.detail);
});

test('a passing suite records an empty failing list', () => {
  const r = failingRepo({ 'suite.out': '✔ a (1ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0\n' }, 'cat suite.out');
  const res = P.E.verifyTask(r, 'N').results[0];
  assert.equal(res.status, 'pass');
  assert.deepEqual(res.evidence.failing, []);
});
