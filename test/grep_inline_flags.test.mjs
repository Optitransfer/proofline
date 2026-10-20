import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { repo, addTask, commitBeforeBase } from './helpers.mjs';

// Contracts shared with a Python verifier write flags inline. The same pattern must mean the same thing here.
test('a grep pattern that starts with (?i) or (?s) runs with those flags instead of crashing', () => {
  const r = repo({ files: { 'README.md': 'An EXPERIMENTAL suite.\n', 'docs/R.md': 'my proposal\n| M1 |\n| M6 |\n' } });
  addTask(r, {
    id: 'G', title: 'g', criteria: [
      { id: 'G-AC01', statement: 'i', verifier: { type: 'grep', file: 'README.md', pattern: '(?i)experimental', must: 'present' } },
      { id: 'G-AC02', statement: 's', verifier: { type: 'grep', file: 'docs/R.md', pattern: '(?s)my proposal.*\\| M1 \\|.*\\| M6 \\|', must: 'present' } },
      { id: 'G-AC03', statement: 'absent', verifier: { type: 'grep', file: 'README.md', pattern: '(?i)stable', must: 'absent' } },
    ],
  });
  commitBeforeBase(r);
  P.taskNext(r);
  const g = P.E.verifyTask(r, 'G');
  for (const id of ['G-AC01', 'G-AC02', 'G-AC03']) assert.equal(g.results.find((x) => x.id === id).status, 'pass', `${id}: ${JSON.stringify(g.results.find((x) => x.id === id))}`);
});

test('without the inline flag the match stays case-sensitive', () => {
  const r = repo({ files: { 'README.md': 'An EXPERIMENTAL suite.\n' } });
  addTask(r, { id: 'G', title: 'g', criteria: [{ id: 'G-AC01', statement: 'i', verifier: { type: 'grep', file: 'README.md', pattern: 'experimental', must: 'present' } }] });
  commitBeforeBase(r);
  P.taskNext(r);
  assert.equal(P.E.verifyTask(r, 'G').results[0].status, 'fail');
});
