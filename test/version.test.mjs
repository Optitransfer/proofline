// proofline --version prints the package version, so a user can say which build they run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BIN } from './helpers.mjs';

const VERSION = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')).version;

test('--version and -v print the package version and exit 0, outside any repository', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-ver-'));
  for (const flag of ['--version', '-v']) {
    const r = spawnSync(process.execPath, [BIN, flag], { encoding: 'utf8', cwd });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${VERSION}\n`);
  }
});

test('--version on a subcommand is still an unknown flag', () => {
  const r = spawnSync(process.execPath, [BIN, 'status', '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown flag --version/);
});
