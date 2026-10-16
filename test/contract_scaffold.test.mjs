import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as C from '../src/contract.mjs';
import { BIN } from './helpers.mjs';

test('scaffold emits a valid task with the standard criteria and stop rules', () => {
  const task = C.scaffoldTask({ title: 'Add the thing', scope: 'src/**,test/**', id: 'EX-01' });
  assert.ok(task.stop_rules.length >= 1);
  const types = task.criteria.map((c) => c.verifier.type);
  assert.ok(types.includes('test_red_green'));
  assert.ok(types.includes('command'));
  assert.ok(types.includes('scope'));
  assert.ok(types.includes('pushed'));
  const contract = { ...C.skeleton('t'), tasks: [task] };
  assert.deepEqual(C.lint(contract).errors, []);
});

test('the scaffold command prints that task', () => {
  const out = execFileSync(process.execPath, [BIN, 'contract', 'scaffold', '--title', 'Add the thing', '--scope', 'src/**,test/**', '--id', 'EX-01', '--root', import.meta.dirname + '/..'], { encoding: 'utf8' });
  const task = JSON.parse(out);
  assert.equal(task.id, 'EX-01');
  assert.deepEqual(C.lint({ ...C.skeleton('t'), tasks: [task] }).errors, []);
});
