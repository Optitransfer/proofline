import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { repo, commitBeforeBase, parentAfterContract, BIN } from './helpers.mjs';

function flagRepo() {
  const root = repo();
  const c = P.C.skeleton('t');
  c.tasks.push(P.C.makeTask({
    id: 'T-01', title: 'flag',
    criteria: [{ statement: 'the flag exists', verifier: { type: 'command', cmd: 'test -f ready.flag', expect_exit: 0 } }],
  }));
  P.C.save(root, c);
  commitBeforeBase(root);
  // The default base must contain the setup contract and must not be HEAD.
  parentAfterContract(root);
  return root;
}

test('watch exits non-zero when the gate is still not PASS at the end of the bound', () => {
  const root = flagRepo();
  const started = Date.now();
  let caught;
  try {
    execFileSync(process.execPath, [BIN, 'watch', 'T-01', '--root', root], { encoding: 'utf8' });
  } catch (e) { caught = e; }
  assert.ok(caught, 'watch should exit non-zero');
  assert.notEqual(caught.status, 0);
  assert.match(caught.stdout, /FAIL/);
  assert.match(caught.stdout, /T-01-AC01/);
  assert.ok(caught.stdout.split('T-01-AC01').length - 1 >= 2);
  assert.ok(Date.now() - started >= 3000);
});

test('watch shows the FAIL criterion and exits 0 once the gate is PASS', async () => {
  const root = flagRepo();
  const child = spawn(process.execPath, [BIN, 'watch', 'T-01', '--root', root], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let wrote = false;
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`watch hung\n${out}`)); }, 20000);
    child.stdout.on('data', (b) => {
      out += b.toString();
      if (!wrote && out.includes('FAIL') && out.includes('T-01-AC01')) {
        wrote = true;
        fs.writeFileSync(path.join(root, 'ready.flag'), '1\n');
      }
    });
    child.on('close', (status) => { clearTimeout(timer); resolve(status); });
  });
  assert.equal(wrote, true);
  assert.equal(code, 0);
  assert.match(out, /PASS/);
});
