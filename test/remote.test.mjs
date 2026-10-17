import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as P from '../src/index.mjs';
import { write, commitAll, parentAfterContract, sh } from './helpers.mjs';

/** A repo whose only remote is named github, with proofline initialised and a task that must be pushed. */
function githubRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-test-'));
  const bare = path.join(tmp, 'gh.git'), r = path.join(tmp, 'r');
  sh(tmp, 'init', '-q', '--bare', '-b', 'main', bare);
  sh(tmp, 'clone', '-q', '-o', 'github', bare, r);
  sh(r, 'config', 'user.email', 't@t'); sh(r, 'config', 'user.name', 't'); sh(r, 'checkout', '-q', '-b', 'main');
  write(r, { 'package.json': '{ "type": "module" }\n' });
  P.init(r, { hooks: false, project: 't' });
  const c = P.C.load(r); c.defaults.remote = 'github'; delete c.defaults.base;
  c.tasks.push(P.C.makeTask({ id: 'T', title: 't', criteria: [{ verifier: { type: 'scope' } }, { verifier: { type: 'pushed' } }] }));
  P.C.save(r, c);
  commitAll(r, 'init'); sh(r, 'push', '-q', 'github', 'main');
  assert.deepEqual(sh(r, 'remote').split('\n'), ['github']);
  return r;
}

test('defaults.remote names the remote for the base, pushed and claims', () => {
  const r = githubRepo();
  P.taskNext(r);
  write(r, { 'src/x.mjs': 'export const x = 1;\n' });
  commitAll(r, 'T: x');
  const local = sh(r, 'rev-parse', '--short', 'HEAD');
  let g = P.E.verifyTask(r, 'T', { claims: `T | done | ${local} | x.mjs | - | -` });
  assert.equal(g.base_ref, sh(r, 'rev-parse', 'github/main'), 'next pinned github/main');
  assert.match(g.failing.join('\n'), /T-AC02 FAIL: HEAD [0-9a-f]{8} not pushed: github\/main is/);
  assert.match(g.failing.join('\n'), new RegExp(`commit ${local} is not on github/main`));
  sh(r, 'push', '-q', 'github', 'main');
  g = P.E.verifyTask(r, 'T', { claims: `T | done | ${local} | x.mjs | - | -` });
  assert.equal(g.decision, 'PASS', g.blocked.concat(g.failing).join('\n'));
  assert.match(g.results.find((x) => x.type === 'pushed').detail, /is github\/main/);
});

test('without a pin, the default base is <remote>/<branch>', () => {
  const r = githubRepo();
  write(r, { 'src/x.mjs': 'export const x = 1;\n' });
  commitAll(r, 'T: x');
  const g = P.E.verifyTask(r, 'T');
  assert.equal(g.base_ref, 'github/main'); assert.equal(g.base_source, 'default');
  assert.equal(g.base, sh(r, 'rev-parse', 'github/main'));
});

test('defaults.remote must be a remote name', () => {
  const c = P.C.skeleton('p'); c.defaults.remote = 5;
  assert.match(P.C.validate(c).join(), /defaults\.remote must be a remote name/);
  c.defaults.remote = 'github';
  assert.deepEqual(P.C.validate(c), []);
});

test('the corrective text and the brief name the configured remote, never origin', () => {
  const r = githubRepo();
  const n = P.taskNext(r);
  assert.match(n.brief, /HEAD == github\/main/);
  assert.doesNotMatch(n.brief, /\borigin\b/);
  write(r, { 'src/x.mjs': 'export const x = 1;\n' });
  commitAll(r, 'T: x');
  const g = P.E.verifyTask(r, 'T');
  assert.equal(g.decision, 'FAIL');
  const text = P.E.steer(g, P.C.load(r));
  assert.match(text, /`git push github main`/);
  assert.doesNotMatch(text, /\borigin\b/);
});

test('a pushed criterion with its own remote wins over defaults.remote in the corrective text', () => {
  const r = githubRepo();
  const mirror = path.join(path.dirname(r), 'mirror.git');
  sh(path.dirname(r), 'init', '-q', '--bare', '-b', 'main', mirror); sh(r, 'remote', 'add', 'mirror', mirror);
  const c = P.C.load(r); c.tasks.push(P.C.makeTask({ id: 'U', title: 'u', criteria: [{ verifier: { type: 'pushed', remote: 'mirror', branch: 'release' } }] })); P.C.save(r, c);
  commitAll(r, 'U'); sh(r, 'push', '-q', 'github', 'main');
  parentAfterContract(r);
  const g = P.E.verifyTask(r, 'U', { base: 'HEAD~1' });
  assert.equal(g.decision, 'FAIL');
  assert.match(P.E.steer(g, P.C.load(r)), /`git push mirror release`/);
  assert.match(P.E.brief(P.C.load(r), P.C.load(r).tasks.find((t) => t.id === 'U')), /HEAD == mirror\/release/);
});
