import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { receiptZeroConfig, testCommandFindings } from '../src/infer.mjs';

const sh = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function fresh() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-tcc-'));
  sh(r, ['init', '-q', '-b', 'main']);
  sh(r, ['config', 'user.email', 't@t']);
  sh(r, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }) + '\n');
  sh(r, ['add', 'package.json']);
  sh(r, ['commit', '-q', '-m', 'base']);
  return r;
}

test('a scripts.test change is a forbidden finding, and the base command is what would run', () => {
  const r = fresh();
  const base = sh(r, ['rev-parse', 'HEAD']).trim();
  assert.equal(testCommandFindings(r, base).length, 0);
  const pkg = JSON.parse(fs.readFileSync(path.join(r, 'package.json'), 'utf8'));
  pkg.scripts.test = 'node --test --test-reporter=spec';
  fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify(pkg) + '\n');
  const findings = testCommandFindings(r, base);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'test_command_changed');
  assert.equal(findings[0].file, 'package.json');
  const got = receiptZeroConfig(r, { base });
  assert.equal(got.suites[0].command, 'node --test');
  assert.equal(got.findings[0].rule, 'test_command_changed');
});
