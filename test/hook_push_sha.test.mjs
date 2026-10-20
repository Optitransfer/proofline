// Regression for #21: the pre-push hook gates the commit being pushed, not the checked-out HEAD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { repo, write, addTask, commitBeforeBase, sh } from './helpers.mjs';

test('pushing the first commit of a two-commit branch gates that commit, not the tip', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'T', title: 't', criteria: [{ verifier: { type: 'command', cmd: 'grep -qx first mark.txt' } }] });
  commitBeforeBase(r);
  write(r, { 'mark.txt': 'first\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'first commit (T)');
  const first = sh(r, 'rev-parse', 'HEAD');
  write(r, { 'mark.txt': 'tip\n' });
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'tip commit (T)');
  const tip = sh(r, 'rev-parse', 'HEAD');
  const p = spawnSync('git', ['push', 'origin', `${first}:main`], { cwd: r, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stderr, new RegExp(`gated T at ${first}`));
  assert.doesNotMatch(p.stderr, new RegExp(`gated T at ${tip}`));
});
