// The AGENTS.md the README tells users to copy must pass the forbidden scan of a freshly initialised contract.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { scanForbidden } from '../src/forbidden.mjs';

test('copying the shipped AGENTS.md into a repository trips no forbidden rule', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-agents-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'README.md'), 'x\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.copyFileSync(path.resolve(import.meta.dirname, '..', 'AGENTS.md'), path.join(root, 'AGENTS.md'));
  git('add', '-A');
  const rules = P.C.skeleton('t').forbidden;
  assert.deepEqual(scanForbidden(root, base, rules), []);
});
