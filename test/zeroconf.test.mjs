import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { receiptZeroConfig } from '../src/infer.mjs';

const sh = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function fresh() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-zc-'));
  sh(r, ['init', '-q', '-b', 'main']);
  sh(r, ['config', 'user.email', 't@t']);
  sh(r, ['config', 'user.name', 't']);
  return r;
}

function commit(r, message) {
  sh(r, ['add', '-A']);
  sh(r, ['commit', '-q', '-m', message]);
  return sh(r, ['rev-parse', 'HEAD']).trim();
}

test('an empty fixture yields L0 and exit 2, and does not throw', () => {
  const r = fresh();
  fs.writeFileSync(path.join(r, 'README.md'), 'empty\n');
  const base = commit(r, 'init');
  const got = receiptZeroConfig(r, { base });
  assert.equal(got.level, 'L0');
  assert.equal(got.exitCode, 2);
  assert.equal(got.suites.length, 0);
});

test('a node fixture infers the suite, finds the changed test, and produces L1', () => {
  const r = fresh();
  fs.mkdirSync(path.join(r, 'test'));
  fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({
    type: 'module', scripts: { test: 'node --test' },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(r, 'test', 'ok.test.mjs'), [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "test('ok', () => { assert.equal(1, 1); });",
    '',
  ].join('\n'));
  const base = commit(r, 'suite');
  fs.appendFileSync(path.join(r, 'test', 'ok.test.mjs'), '// changed\n');
  const got = receiptZeroConfig(r, { base });
  assert.equal(got.level, 'L1');
  assert.equal(got.exitCode, 0);
  assert.equal(got.suites[0].id, 'node');
  assert.equal(got.suites[0].command, 'node --test');
  assert.equal(got.suites[0].status, 'pass');
  assert.ok(got.changed.includes('test/ok.test.mjs'));
});
