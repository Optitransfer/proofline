import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/contract.mjs';
import { repo, sh } from './helpers.mjs';

test('a vacuous grep is warned about with the base revision named', () => {
  const r = repo({ files: { 'README.md': 'hello\n' } });
  const sha = sh(r, 'rev-parse', 'HEAD');
  const c = C.load(r);
  c.tasks.push(C.makeTask({
    id: 'V',
    title: 'v',
    scope: ['README.md'],
    stop_rules: ['stop'],
    criteria: [
      { statement: 'already there', verifier: { type: 'grep', file: 'README.md', pattern: 'hello' } },
      { statement: 'not there', verifier: { type: 'grep', file: 'README.md', pattern: 'not-there' } },
      { statement: 'scope', verifier: { type: 'scope' } },
      { statement: 'pushed', verifier: { type: 'pushed' } },
    ],
  }));
  const { errors, warnings } = C.lint(c, { root: r, base: 'HEAD' });
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], new RegExp(sha));
  assert.match(warnings[0], /V\/V-AC01/);
  assert.match(warnings[0], /README\.md/);
});
