import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { repo, BIN } from './helpers.mjs';
import { spawnSync } from 'node:child_process';

const ok = [{ verifier: { type: 'command', cmd: 'true' } }];

test('a task spec may carry the scope as the contract writes it, { allow: [...] }, or as the bare list', () => {
  const a = P.C.makeTask({ id: 'T-1', title: 't', scope: ['src/**', 'test/**'], criteria: ok });
  const b = P.C.makeTask({ id: 'T-2', title: 't', scope: { allow: ['src/**', 'test/**'] }, criteria: ok });
  assert.deepEqual(a.scope, { allow: ['src/**', 'test/**'] });
  assert.deepEqual(b.scope, a.scope, 'an object scope is not wrapped a second time');
});

test('validate refuses a task whose scope.allow is not a list of patterns, so next cannot crash on it', () => {
  const r = repo();
  const c = P.C.load(r);
  c.tasks.push({ ...P.C.makeTask({ id: 'T-3', title: 't', criteria: ok }), scope: { allow: { allow: ['src/**'] } } });
  const errs = P.C.validate(c);
  assert.ok(errs.some((e) => /T-3: scope\.allow must be a list of path patterns/.test(e)), errs.join('; '));
});

test('contract create --from a file whose task has { scope: { allow } } gives a task next can brief', () => {
  const r = repo();
  const spec = { id: 'T-4', title: 'from a file', scope: { allow: ['src/**'] }, criteria: ok };
  const out = P.contractCreate(r, spec);
  assert.equal(out.valid, true, out.problems.join('; '));
  const n = spawnSync(process.execPath, [BIN, '--root', r, 'next'], { encoding: 'utf8' });
  assert.equal(n.status, 0, n.stderr);
  assert.match(n.stdout, /## Scope \(allowed paths\)\n- src\/\*\*/);
});
