import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as P from '../src/index.mjs';
import { repo, write, sh, commitBeforeBase, BIN } from './helpers.mjs';

function sample() {
  const c = P.C.skeleton('t');
  const t = P.C.makeTask({
    id: 'T',
    title: 't',
    criteria: [{ verifier: { type: 'metric', cmd: 'node -e "console.log(JSON.stringify({p50:1}))"', key: 'p50', op: '<', value: 20 } }],
    scope: ['src/**'],
  });
  const v = t.criteria[0].verifier;
  v.pattern = 'alpha';
  v.expect_exit = 0;
  v.test_file = 'test/t.test.mjs';
  v.env = { MODE: 'a' };
  v.timeout_s = 30;
  v.min_tests = 4;
  c.tasks.push(t);
  c.forbidden = { ...c.forbidden, ignore_paths: ['vendor/**'], protected_values: [{ file: 'pkg.json', pattern: '(\\d+)', direction: 'no_decrease' }] };
  c.ci = { tasks: ['T'] };
  return c;
}

const edits = [
  ['min_tests', (c) => { c.tasks[0].criteria[0].verifier.min_tests = 1; }],
  ['grep pattern', (c) => { c.tasks[0].criteria[0].verifier.pattern = 'beta'; }],
  ['scope.allow', (c) => { c.tasks[0].scope.allow = ['docs/**']; }],
  ['forbidden.ignore_paths', (c) => { c.forbidden.ignore_paths = ['vendor/**', 'tmp/**']; }],
  ['protected_values', (c) => { c.forbidden.protected_values[0].direction = 'no_increase'; }],
  ['ci.tasks', (c) => { c.ci.tasks = []; }],
  ['expect_exit', (c) => { c.tasks[0].criteria[0].verifier.expect_exit = 1; }],
  ['test_file', (c) => { c.tasks[0].criteria[0].verifier.test_file = 'test/other.test.mjs'; }],
  ['env', (c) => { c.tasks[0].criteria[0].verifier.env = { MODE: 'b' }; }],
  ['timeout_s', (c) => { c.tasks[0].criteria[0].verifier.timeout_s = 90; }],
  ['tightening', (c) => { c.tasks[0].criteria[0].verifier.value = 10; }],
];

const cli = (r, args) => spawnSync(process.execPath, [BIN, ...args, '--root', r], { encoding: 'utf8' });

function refused(name, edit) {
  const r = repo();
  write(r, { 'proofline.json': JSON.stringify(sample(), null, 2) + '\n' });
  commitBeforeBase(r);
  const cur = sample();
  edit(cur);
  write(r, { 'proofline.json': JSON.stringify(cur, null, 2) + '\n' });
  sh(r, 'add', '--', 'proofline.json');
  const hook = P.hookPreCommit(r);
  assert.equal(hook.ok, false, `${name} pre-commit ${hook.msg}`);
  const v = P.E.verifyTask(r, 'T');
  assert.equal(v.decision, 'BLOCKED', `${name} verify ${[...v.blocked, ...v.failing].join('\n')}`);
  assert.equal(v.blocked.filter((b) => /needs owner approval/.test(b)).length, 1, v.blocked.join('\n'));
  const g = P.E.gate(r, 'T');
  assert.equal(g.decision, 'BLOCKED', `${name} gate ${g.blocked.join('\n')}`);
  const ci = cli(r, ['gate', '--ci']);
  const text = `${ci.stdout}\n${ci.stderr}`;
  assert.equal(ci.status, 2, `${name} gate --ci ${text}`);
  assert.match(text, /needs owner approval/);
}

test('each field edit, including a tightening, is refused at pre-commit, verify, gate and gate --ci', () => {
  for (const [name, edit] of edits) refused(name, edit);
});
