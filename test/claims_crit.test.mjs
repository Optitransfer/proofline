import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { repo, addTask, commitBeforeBase, sh } from './helpers.mjs';

// An intake task adds no test file: its proof is a command the gate runs. The tests column names that criterion.
function intake(extra = []) {
  const r = repo();
  addTask(r, {
    id: 'IN', title: 'intake', scope: [],
    criteria: [
      { id: 'IN-AC01', statement: 'baseline inventory recorded', verifier: { type: 'command', cmd: 'node -e "process.exit(0)"' } },
      { id: 'IN-AC02', statement: 'package.json present', verifier: { type: 'file_exists', path: 'package.json' } },
      ...extra,
    ],
  });
  commitBeforeBase(r);
  P.taskNext(r);
  return { r, head: sh(r, 'rev-parse', '--short', 'HEAD') };
}

test('crit:<id> naming a passing command criterion of the task proves the claim', () => {
  const { r, head } = intake();
  const g = P.E.verifyTask(r, 'IN', { claims: `IN | done | ${head} | crit:IN-AC01 | - | -` });
  assert.equal(g.decision, 'PASS', g.failing.join('\n'));
  assert.equal(g.claims[0].ok, true);
});

test('the same claim with the criterion id as a bare name still fails the repo lookup', () => {
  const { r, head } = intake();
  const g = P.E.verifyTask(r, 'IN', { claims: `IN | done | ${head} | IN-AC01-proof | - | -` });
  assert.equal(g.decision, 'FAIL');
  assert.match(g.failing.join('\n'), /named test "IN-AC01-proof" not found in the repo/);
});

test('crit:<id> is refused for an unknown id, another task, a check that runs nothing, and a failing criterion', () => {
  const { r, head } = intake([{ id: 'IN-AC03', statement: 'second run', mandatory: false, verifier: { type: 'command', cmd: 'node -e "process.exit(1)"' } }]);
  addTask(r, { id: 'OTHER', title: 'o', criteria: [{ id: 'OT-AC01', statement: 'o', verifier: { type: 'command', cmd: 'node -e "process.exit(0)"' } }] });
  const cases = [
    ['crit:IN-AC99', /"crit:IN-AC99" is not a criterion of IN that this gate ran/],
    ['crit:OT-AC01', /"crit:OT-AC01" is not a criterion of IN that this gate ran/],
    ['crit:IN-AC02', /"crit:IN-AC02" is a file_exists check, which runs no test/],
    ['crit:IN-AC03', /"crit:IN-AC03" is FAIL in this gate, not PASS/],
  ];
  for (const [name, re] of cases) {
    const g = P.E.verifyTask(r, 'IN', { claims: `IN | done | ${head} | ${name} | - | -` });
    assert.equal(g.decision, g.blocked.length ? 'BLOCKED' : 'FAIL', name);
    assert.match(g.claims[0].issues.join('\n'), re, name);
  }
});

test('crit: names mix with file names, and every one must hold', () => {
  const { r, head } = intake();
  const ok = P.E.verifyTask(r, 'IN', { claims: `IN | done | ${head} | crit:IN-AC01, package.json | - | -` });
  assert.equal(ok.claims[0].ok, true, ok.claims[0].issues.join('\n'));
  const bad = P.E.verifyTask(r, 'IN', { claims: `IN | done | ${head} | crit:IN-AC01, crit:IN-AC02 | - | -` });
  assert.equal(bad.decision, 'FAIL');
  assert.equal(bad.claims[0].issues.length, 1);
});

test('dash, n/a and none still count as naming no test', () => {
  const { r, head } = intake();
  const g = P.E.verifyTask(r, 'IN', { claims: `IN | done | ${head} | n/a | - | -` });
  assert.match(g.failing.join('\n'), /without naming the test\(s\) that prove it/);
});
