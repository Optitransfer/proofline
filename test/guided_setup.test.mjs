import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BIN } from './helpers.mjs';

function stubAgentkey(dir) {
  const file = path.join(dir, 'agentkey');
  fs.writeFileSync(file, `#!/bin/sh
printf '%s\\n' "$1 $2" > "$AGENTKEY_HOME/invoked"
printf '%s\\n' "$AGENTKEY_HOME" > "$AGENTKEY_HOME/home-used"
[ "$1" = init ] && [ "$2" = owner ] || exit 1
mkdir -p "$AGENTKEY_HOME/keys"
printf '%s\\n' owner-key > "$AGENTKEY_HOME/keys/owner.key"
printf '%s\\n' owner-pub > "$AGENTKEY_HOME/keys/owner.pub"
echo "kabc owner created"
`, { mode: 0o755 });
  return file;
}

function emptyRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-setup-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  return root;
}

function envFor(home, keyHome, binDir) {
  return { ...process.env, HOME: home, AGENTKEY_HOME: keyHome, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
}

test('setup leaves hooks, an owner key and the approvals directory, and prints three lines', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-home-'));
  const keyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-ak-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-bin-'));
  const ak = path.join(home, '.agentkey');
  fs.mkdirSync(ak);
  fs.writeFileSync(path.join(ak, 'canary'), 'do-not-read');
  fs.chmodSync(ak, 0o000);
  stubAgentkey(binDir);
  const root = emptyRepo();
  try {
    const out = execFileSync(process.execPath, [BIN, 'setup', '--root', root], { encoding: 'utf8', env: envFor(home, keyHome, binDir) });
    const lines = out.trim().split(/\n/);
    assert.equal(lines.length, 3);
    const approvals = path.join(root, '.proofline', 'approvals');
    assert.equal(lines[0], approvals);
    assert.equal(lines[1], 'hooks installed');
    assert.equal(lines[2], 'proofline task');
    const hooks = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8' }).trim();
    for (const name of ['pre-commit', 'pre-push']) {
      const f = path.resolve(root, hooks, name);
      const st = fs.statSync(f);
      assert.equal(st.isFile(), true);
      assert.ok(st.mode & 0o111);
      assert.match(fs.readFileSync(f, 'utf8'), /installed by proofline/);
    }
    assert.equal(fs.readFileSync(path.join(keyHome, 'invoked'), 'utf8').trim(), 'init owner');
    assert.equal(fs.readFileSync(path.join(keyHome, 'home-used'), 'utf8').trim(), keyHome);
    const key = fs.lstatSync(path.join(keyHome, 'keys', 'owner.key'));
    assert.equal(key.isFile(), true);
    assert.equal(key.isSymbolicLink(), false);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.proofline', 'config.json'), 'utf8'));
    assert.equal(cfg.approvals, approvals);
    assert.equal(fs.existsSync(approvals), true);
    assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false);
    const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'));
    for (const name of Object.keys(pkg.dependencies || {})) assert.equal(name, '@optitransfer/agentkey');
  } finally {
    fs.chmodSync(ak, 0o700);
    assert.equal(fs.readFileSync(path.join(ak, 'canary'), 'utf8'), 'do-not-read');
  }
});

test('setup refuses to finish when a hook is missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-home-'));
  const keyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-ak-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-bin-'));
  stubAgentkey(binDir);
  const root = emptyRepo();
  fs.rmSync(path.join(root, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'hooks'), 'not a directory\n');
  let caught;
  try {
    execFileSync(process.execPath, [BIN, 'setup', '--root', root], { encoding: 'utf8', env: envFor(home, keyHome, binDir) });
  } catch (e) { caught = e; }
  assert.ok(caught, 'setup should refuse');
  assert.notEqual(caught.status, 0);
  assert.match(caught.stderr, /a hook is missing/);
  assert.match(caught.stderr, /Next step: proofline setup/);
  assert.doesNotMatch(caught.stdout || '', /hooks installed/);
});

test('setup --agent claude-code connects that agent under HOME', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-home-'));
  const keyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-ak-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-bin-'));
  stubAgentkey(binDir);
  const root = emptyRepo();
  execFileSync(process.execPath, [BIN, 'setup', '--agent', 'claude-code', '--root', root], { encoding: 'utf8', env: envFor(home, keyHome, binDir) });
  const settings = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  assert.match(settings, /proofline hook stop/);
});
