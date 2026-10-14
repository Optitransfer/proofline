import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { repo, write, addTask, commitAll, sh } from './helpers.mjs';

const PUSH_AGAIN = /Commit, push|push to |git push|task_next/;

for (const withPushed of [true, false]) {
  test(`PASS closing text before and after the push (${withPushed ? 'pushed criterion' : 'no pushed criterion'})`, () => {
    const r = repo();
    addTask(r, { id: 'T', title: 't', criteria: [{ verifier: { type: 'command', cmd: 'true' } }, ...(withPushed ? [{ verifier: { type: 'pushed' } }] : [])] });
    P.taskNext(r);
    write(r, { 'src/x.mjs': 'export const x = 1;\n' });
    commitAll(r, 'T: x');
    // Not pushed yet: the pushed criterion is skipped as the pre-push hook does, or absent.
    let g = P.E.verifyTask(r, 'T', { skipTypes: ['pushed'] });
    assert.equal(g.decision, 'PASS', g.blocked.concat(g.failing).join('\n'));
    let text = P.E.steer(g, P.C.load(r));
    assert.match(text, /not pushed yet/); assert.match(text, /push to origin main/);
    assert.match(text, /proofline gate T --claims "T \| done \| <hash> \|/);
    sh(r, 'push', '-q', 'origin', 'main');
    const head = sh(r, 'rev-parse', 'HEAD').slice(0, 8);
    g = P.E.verifyTask(r, 'T');
    assert.equal(g.decision, 'PASS', g.blocked.concat(g.failing).join('\n'));
    text = P.E.steer(g, P.C.load(r));
    assert.match(text, new RegExp(`verified on the pushed HEAD ${head} \\(origin/main\\)`));
    assert.match(text, new RegExp(`proofline gate T --claims "T \\| done \\| ${head} \\|`));
    assert.doesNotMatch(text, PUSH_AGAIN);
  });
}

test('after accepted claims on the pushed HEAD, the closing text points to next', () => {
  const r = repo({ files: { 'test/t.test.mjs': "import test from 'node:test';\ntest('t', () => {});\n" } });
  addTask(r, { id: 'T', title: 't', criteria: [{ verifier: { type: 'command', cmd: 'true' } }, { verifier: { type: 'pushed' } }] });
  P.taskNext(r);
  write(r, { 'src/x.mjs': 'export const x = 1;\n' });
  commitAll(r, 'T: x'); sh(r, 'push', '-q', 'origin', 'main');
  const head = sh(r, 'rev-parse', 'HEAD').slice(0, 8);
  const g = P.E.gate(r, 'T', { claims: `T | done | ${head} | t.test.mjs | - | -` });
  assert.equal(g.decision, 'PASS', g.blocked.concat(g.failing).join('\n'));
  assert.match(g.corrective_prompt, /claims match the evidence/);
  assert.match(g.corrective_prompt, /`proofline next`/);
  assert.doesNotMatch(g.corrective_prompt, PUSH_AGAIN);
});

test('a PASS gated with --base repeats --base in the suggested gate command', () => {
  const r = repo();
  addTask(r, { id: 'T', title: 't', criteria: [{ verifier: { type: 'command', cmd: 'true' } }, { verifier: { type: 'pushed' } }] });
  commitAll(r, 'contract'); sh(r, 'push', '-q', 'origin', 'main');
  const start = sh(r, 'rev-parse', 'HEAD');
  write(r, { 'src/x.mjs': 'export const x = 1;\n' });
  commitAll(r, 'T: x'); sh(r, 'push', '-q', 'origin', 'main');
  const g = P.E.verifyTask(r, 'T', { base: start });
  assert.equal(g.decision, 'PASS', g.blocked.concat(g.failing).join('\n'));
  assert.match(P.E.steer(g, P.C.load(r)), new RegExp(`proofline gate T --base ${start} --claims`));
});
