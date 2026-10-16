import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/contract.mjs';

function task() {
  return C.scaffoldTask({ title: 'Add the thing', scope: 'src/**,test/**', id: 'EX-01' });
}
function errs(t) {
  return C.lint({ ...C.skeleton('t'), tasks: [t] }).errors.join('\n');
}

test('validate refuses each of the five shapes and accepts a clean contract', () => {
  const clean = task();
  assert.deepEqual(C.lint({ ...C.skeleton('t'), tasks: [clean] }).errors, []);

  const noStop = task();
  delete noStop.stop_rules;
  assert.match(errs(noStop), /EX-01: no stop_rules/);

  const noScope = task();
  noScope.criteria = noScope.criteria.filter((c) => c.verifier.type !== 'scope');
  assert.match(errs(noScope), /EX-01: no scope criterion/);

  const outside = task();
  const red = outside.criteria.find((c) => c.verifier.type === 'test_red_green');
  red.verifier.test_file = 'outside/x.test.mjs';
  assert.match(errs(outside), new RegExp(`${red.id}: test_file outside/x.test.mjs is outside scope`));

  const shell = task();
  const cmd = shell.criteria.find((c) => c.verifier.type === 'command');
  cmd.verifier.cmd = 'sh -c "echo $HOME"';
  assert.match(errs(shell), new RegExp(`${cmd.id}: command is a double-quoted sh -c or bash -c that contains \\$`));

  const quoted = task();
  quoted.criteria.find((c) => c.verifier.type === 'command').verifier.cmd = "sh -c 'echo $HOME'";
  assert.deepEqual(C.lint({ ...C.skeleton('t'), tasks: [quoted] }).errors, []);

  const missing = task();
  const bare = missing.criteria.find((c) => c.verifier.type === 'test_red_green');
  delete bare.verifier.test_file;
  assert.match(errs(missing), new RegExp(`${bare.id}: test_red_green verifier missing "test_file"`));
});
