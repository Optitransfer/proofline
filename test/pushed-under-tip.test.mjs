import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as P from '../src/index.mjs';
import { repo, write, addTask, commitAll, sh } from './helpers.mjs';

/** A repo whose task T must be pushed; its commit is pushed, then a second clone pushes one more commit on top, so this
 * clone's HEAD sits one commit under origin/main and this clone has never seen the tip. */
function underTip() {
  const r = repo();
  addTask(r, { id: 'T', title: 't', criteria: [{ verifier: { type: 'pushed' } }] });
  commitAll(r, 'contract');
  write(r, { 'src/x.mjs': 'export const x = 1;\n' }); commitAll(r, 'T: x');
  sh(r, 'push', '-q', 'origin', 'main');
  const other = path.join(path.dirname(r), 'other');
  sh(path.dirname(r), 'clone', '-q', path.join(path.dirname(r), 'o.git'), other);
  sh(other, 'config', 'user.email', 't@t'); sh(other, 'config', 'user.name', 't');
  write(other, { 'src/y.mjs': 'export const y = 1;\n' }); commitAll(other, 'next task'); sh(other, 'push', '-q', 'origin', 'main');
  return { r, tip: sh(other, 'rev-parse', 'HEAD') };
}
const pushed = (g) => g.results.find((x) => x.type === 'pushed');

test('a commit under the pushed tip passes pushed, and says how far under it is', () => {
  const { r, tip } = underTip();
  const before = sh(r, 'rev-parse', 'origin/main');
  const g = P.E.verifyTask(r, 'T', { base: 'HEAD~1' });
  assert.equal(pushed(g).status, 'pass', pushed(g).detail);
  assert.match(pushed(g).detail, new RegExp(`is on origin/main, 1 commit under its tip ${tip.slice(0, 8)}`));
  assert.equal(sh(r, 'rev-parse', 'origin/main'), before, 'the check wrote no remote-tracking ref');
});

test('a commit the remote does not hold fails pushed, naming the remote tip', () => {
  const { r, tip } = underTip();
  write(r, { 'src/z.mjs': 'export const z = 1;\n' }); commitAll(r, 'T: z, never pushed');
  const g = P.E.verifyTask(r, 'T', { base: 'HEAD~1' });
  assert.equal(pushed(g).status, 'fail');
  assert.match(pushed(g).detail, new RegExp(`not pushed: origin/main is ${tip.slice(0, 8)}$`));
});

test('an unreachable remote is an error for pushed and an issue for a claim, never a pass', () => {
  const r = repo();
  addTask(r, { id: 'T', title: 't', criteria: [{ verifier: { type: 'scope' } }, { verifier: { type: 'pushed' } }] });
  commitAll(r, 'contract');
  write(r, { 'src/x.mjs': 'export const x = 1;\n' }); commitAll(r, 'T: x'); sh(r, 'push', '-q', 'origin', 'main');
  sh(r, 'remote', 'set-url', 'origin', path.join(path.dirname(r), 'gone.git'));
  const local = sh(r, 'rev-parse', '--short', 'HEAD');
  const g = P.E.verifyTask(r, 'T', { base: 'HEAD~1', claims: `T | done | ${local} | x.mjs | - | -` });
  assert.equal(pushed(g).status, 'error');
  assert.notEqual(g.decision, 'PASS');
  assert.match(JSON.stringify(g.claims), new RegExp(`cannot check that commit ${local} is on origin/main`));
});

test('a claimed commit under the tip is on the remote; one off it is not', () => {
  const { r } = underTip();
  const under = sh(r, 'rev-parse', '--short', 'HEAD');
  let g = P.E.verifyTask(r, 'T', { base: 'HEAD~1', claims: `T | done | ${under} | x.mjs | - | -` });
  assert.doesNotMatch(JSON.stringify(g.claims), /is not on origin\/main/);
  write(r, { 'src/z.mjs': 'export const z = 1;\n' }); commitAll(r, 'T: z, never pushed');
  const off = sh(r, 'rev-parse', '--short', 'HEAD');
  g = P.E.verifyTask(r, 'T', { base: 'HEAD~1', claims: `T | done | ${off} | x.mjs | - | -` });
  assert.match(JSON.stringify(g.claims), new RegExp(`commit ${off} is not on origin/main`));
});
