import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/util.mjs';

test('a command run by the gate does not inherit the hook git directory', () => {
  const keys = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR'];
  const prev = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    process.env[k] = '/not/this/repository';
  }
  try {
    const r = run('printf %s "${GIT_DIR-unset} ${GIT_WORK_TREE-unset} ${GIT_INDEX_FILE-unset} ${GIT_PREFIX-unset} ${GIT_COMMON_DIR-unset}"', { cwd: import.meta.dirname });
    assert.equal(r.exit, 0, r.stderr);
    assert.equal(r.stdout, 'unset unset unset unset unset');
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});
