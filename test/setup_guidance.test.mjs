// proofline setup and contract sign name the exact commands that provide what they need, never just "run setup again".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BIN } from './helpers.mjs';

function emptyRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-guide-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  return root;
}

// A PATH that holds git and nothing named agentkey, whatever the machine has installed.
function pathWithoutAgentkey() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-path-'));
  const git = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.symlinkSync(git, path.join(dir, 'git'));
  return dir;
}

function run(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });
}

test('setup without AGENTKEY_HOME says what it is for and how to set it', () => {
  const root = emptyRepo();
  const env = { ...process.env };
  delete env.AGENTKEY_HOME;
  const r = run(['setup', '--root', root], env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /AGENTKEY_HOME is not set/);
  assert.match(r.stderr, /holds your owner key/);
  assert.match(r.stderr, /Next step: export AGENTKEY_HOME=/);
  assert.equal(fs.existsSync(path.join(root, 'proofline.json')), false);
});

test('setup without agentkey on PATH names the package and the install command', () => {
  const root = emptyRepo();
  const keyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-ak-'));
  const env = { ...process.env, AGENTKEY_HOME: keyHome, PATH: pathWithoutAgentkey() };
  const r = run(['setup', '--root', root], env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /agentkey is not on PATH/);
  assert.match(r.stderr, /npm install --save-dev @optitransfer\/agentkey/);
  assert.equal(fs.existsSync(path.join(root, 'proofline.json')), false);
});

test('contract sign without AGENTKEY_HOME names the variable to export', () => {
  const root = emptyRepo();
  const env = { ...process.env };
  delete env.AGENTKEY_HOME;
  const r = run(['contract', 'sign', '--root', root], env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /AGENTKEY_HOME is not set/);
  assert.match(r.stderr, /Next step: export AGENTKEY_HOME=/);
});
