import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BIN } from './helpers.mjs';

// The same stub as guided_setup: init owner writes keys/owner.key and keys/owner.pub under AGENTKEY_HOME.
function stubAgentkey(dir) {
  const file = path.join(dir, 'agentkey');
  fs.writeFileSync(file, `#!/bin/sh
printf '%s\\n' "$1 $2" > "$AGENTKEY_HOME/invoked"
[ "$1" = init ] && [ "$2" = owner ] || exit 1
mkdir -p "$AGENTKEY_HOME/keys"
printf '%s\\n' owner-key > "$AGENTKEY_HOME/keys/owner.key"
printf '%s\\n' owner-pub > "$AGENTKEY_HOME/keys/owner.pub"
echo "kabc owner created"
`, { mode: 0o755 });
  return file;
}

function emptyRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-pin-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  return root;
}

function world() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-home-'));
  const keyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-ak-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-bin-'));
  stubAgentkey(binDir);
  const root = emptyRepo();
  const env = { ...process.env, HOME: home, AGENTKEY_HOME: keyHome, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
  return { root, keyHome, env, pub: path.join(keyHome, 'keys', 'owner.pub'), pin: path.join(root, 'guard', 'owner.pub') };
}

const setup = (w) => spawnSync(process.execPath, [BIN, 'setup', '--root', w.root], { encoding: 'utf8', env: w.env });

function assertThreeLines(r, w) {
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(/\n/), [path.join(w.root, '.proofline', 'approvals'), 'hooks installed', 'proofline task']);
}

function assertNothingTouched(w) {
  assert.equal(fs.existsSync(path.join(w.keyHome, 'invoked')), false, 'agentkey ran before the refusal');
  assert.equal(fs.existsSync(path.join(w.root, '.proofline')), false, 'init ran before the refusal');
  assert.equal(fs.existsSync(path.join(w.root, 'proofline.json')), false, 'init ran before the refusal');
  assert.equal(fs.existsSync(path.join(w.root, '.git', 'hooks', 'pre-commit')), false, 'hooks were installed before the refusal');
}

test('a fresh setup writes guard/owner.pub with the bytes of the owner key it created', () => {
  const w = world();
  assert.equal(fs.existsSync(w.pin), false);
  assertThreeLines(setup(w), w);
  const pin = fs.lstatSync(w.pin);
  assert.equal(pin.isFile(), true);
  assert.equal(pin.isSymbolicLink(), false);
  assert.deepEqual(fs.readFileSync(w.pin), fs.readFileSync(w.pub));
  assert.deepEqual(fs.readFileSync(w.pin), Buffer.from('owner-pub\n'));
});

test('a second setup with the same pin present leaves it unchanged and succeeds', () => {
  const w = world();
  assertThreeLines(setup(w), w);
  const before = fs.lstatSync(w.pin);
  const bytes = fs.readFileSync(w.pin);
  assertThreeLines(setup(w), w);
  const after = fs.lstatSync(w.pin);
  assert.deepEqual(fs.readFileSync(w.pin), bytes);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('a guard/owner.pub with other bytes makes setup refuse, naming both paths, and the pin stays as it was', () => {
  const w = world();
  fs.mkdirSync(path.dirname(w.pub), { recursive: true });
  fs.writeFileSync(w.pub, 'owner-pub\n');
  fs.mkdirSync(path.dirname(w.pin), { recursive: true });
  fs.writeFileSync(w.pin, 'another-owner-pub\n');
  const r = setup(w);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes(w.pin), r.stderr);
  assert.ok(r.stderr.includes(w.pub), r.stderr);
  assert.match(r.stderr, /Next step: /);
  assert.doesNotMatch(r.stdout, /hooks installed/);
  assert.equal(fs.readFileSync(w.pin, 'utf8'), 'another-owner-pub\n');
  assert.equal(fs.readFileSync(w.pub, 'utf8'), 'owner-pub\n');
  assertNothingTouched(w);
});

test('a pin with no owner key yet in AGENTKEY_HOME is refused before a new key is made', () => {
  const w = world();
  fs.mkdirSync(path.dirname(w.pin), { recursive: true });
  fs.writeFileSync(w.pin, 'owner-pub-from-elsewhere\n');
  const r = setup(w);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes(w.pin), r.stderr);
  assert.ok(r.stderr.includes(w.pub), r.stderr);
  assert.equal(fs.readFileSync(w.pin, 'utf8'), 'owner-pub-from-elsewhere\n');
  assert.equal(fs.existsSync(w.pub), false);
  assertNothingTouched(w);
});
