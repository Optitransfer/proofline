import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { receiptZeroConfig } from '../src/infer.mjs';

const sh = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const present = (bin) => spawnSync('bash', ['-lc', `command -v ${bin}`], { encoding: 'utf8' }).status === 0;

function fresh() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-tc-'));
  sh(r, ['init', '-q', '-b', 'main']);
  sh(r, ['config', 'user.email', 't@t']);
  sh(r, ['config', 'user.name', 't']);
  return r;
}

function commit(r) {
  sh(r, ['add', '-A']);
  sh(r, ['commit', '-q', '-m', 'fixture']);
  return sh(r, ['rev-parse', 'HEAD']).trim();
}

function expectSuite(id, bin, write) {
  test(`${id} is blocked when ${bin} is absent, and passes when it is present`, () => {
    const r = fresh();
    write(r);
    const base = commit(r);
    const got = receiptZeroConfig(r, { base });
    const suite = got.suites.find((s) => s.id === id);
    assert.ok(suite);
    if (present(bin)) assert.equal(suite.status, 'pass');
    else {
      assert.equal(suite.status, 'blocked');
      assert.notEqual(suite.status, 'pass');
      assert.equal(suite.ran, false);
    }
  });
}

expectSuite('rust', 'cargo', (r) => {
  fs.mkdirSync(path.join(r, 'src'));
  fs.writeFileSync(path.join(r, 'Cargo.toml'), [
    '[package]', 'name = "fix"', 'version = "0.1.0"', 'edition = "2021"', '',
  ].join('\n'));
  fs.writeFileSync(path.join(r, 'src', 'lib.rs'), '#[cfg(test)]\nmod t { #[test] fn ok() { assert_eq!(1, 1); } }\n');
});

expectSuite('python', 'pytest', (r) => {
  fs.writeFileSync(path.join(r, 'pytest.ini'), '[pytest]\n');
  fs.writeFileSync(path.join(r, 'test_ok.py'), 'def test_ok():\n    assert 1 == 1\n');
});

expectSuite('go', 'go', (r) => {
  fs.writeFileSync(path.join(r, 'go.mod'), 'module example.com/fix\n\ngo 1.22\n');
  fs.writeFileSync(path.join(r, 'fix_test.go'), 'package fix\nimport "testing"\nfunc TestOk(t *testing.T) {}\n');
});
