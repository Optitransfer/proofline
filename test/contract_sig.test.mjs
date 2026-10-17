import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { repo, commitBeforeBase, BIN } from './helpers.mjs';

const AGENTKEY = '/Users/imac27/programme-b/agentkey/bin/agentkey.mjs';

function agentEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-home-'));
  const keyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-ak-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-bin-'));
  fs.writeFileSync(path.join(binDir, 'agentkey'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(AGENTKEY)} "$@"\n`, { mode: 0o755 });
  const ak = path.join(home, '.agentkey');
  fs.mkdirSync(ak);
  fs.writeFileSync(path.join(ak, 'canary'), 'do-not-read');
  fs.chmodSync(ak, 0o000);
  const env = { ...process.env, HOME: home, AGENTKEY_HOME: keyHome, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
  return { home, keyHome, ak, env };
}

function run(root, args, env) {
  return spawnSync(process.execPath, [BIN, ...args, '--root', root], { encoding: 'utf8', env });
}

function pub(env) {
  const r = spawnSync('agentkey', ['pub', 'owner'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const COMMANDS = [
  ['next'],
  ['brief', 'T-01'],
  ['verify', 'T-01'],
  ['gate', 'T-01'],
  ['hook', 'pre-commit'],
  ['hook', 'pre-push'],
  ['contract', 'verify-sig'],
];

test('a pinned contract is refused until the owner signature matches, and the public key is read from guard/owner.pub only', () => {
  const box = agentEnv();
  const root = repo();
  try {
    const init = spawnSync('agentkey', ['init', 'owner'], { encoding: 'utf8', env: box.env });
    assert.equal(init.status, 0, init.stderr);
    const c = P.C.skeleton('t');
    c.tasks.push(P.C.makeTask({
      id: 'T-01', title: 'ok',
      criteria: [{ statement: 'true', verifier: { type: 'command', cmd: 'true', expect_exit: 0 } }],
    }));
    c.owner_public_key = 'not-the-pin';
    P.C.save(root, c);
    fs.mkdirSync(path.join(root, 'guard'));
    fs.writeFileSync(path.join(root, 'guard', 'owner.pub'), pub(box.env));
    const signed = run(root, ['contract', 'sign'], box.env);
    assert.equal(signed.status, 0, signed.stderr);
    commitBeforeBase(root);
    for (const args of COMMANDS) {
      const r = run(root, args, box.env);
      const text = `${r.stdout || ''}${r.stderr || ''}`;
      assert.equal(r.status, 0, `${args.join(' ')} ${text}`);
      assert.doesNotMatch(text, /contract not owner-signed/);
    }
    const sig = path.join(root, 'proofline.json.sig');
    const saved = fs.readFileSync(sig);
    fs.rmSync(sig);
    for (const args of COMMANDS) {
      const r = run(root, args, box.env);
      assert.equal(r.status, 2, args.join(' '));
      assert.match(r.stderr || '', /contract not owner-signed/);
    }
    fs.writeFileSync(sig, saved);
    const contract = path.join(root, 'proofline.json');
    const original = fs.readFileSync(contract);
    fs.writeFileSync(contract, original.toString('utf8').replace('ok', 'changed'));
    const bad = run(root, ['contract', 'verify-sig'], box.env);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr || '', /contract not owner-signed/);
    fs.writeFileSync(contract, original);
    const other = agentEnv();
    try {
      const again = spawnSync('agentkey', ['init', 'owner'], { encoding: 'utf8', env: other.env });
      assert.equal(again.status, 0, again.stderr);
      fs.writeFileSync(path.join(root, 'guard', 'owner.pub'), pub(other.env));
      const wrong = run(root, ['next'], box.env);
      assert.equal(wrong.status, 2);
      assert.match(wrong.stderr || '', /contract not owner-signed/);
    } finally {
      fs.chmodSync(other.ak, 0o700);
    }
  } finally {
    fs.chmodSync(box.ak, 0o700);
    assert.equal(fs.readFileSync(path.join(box.ak, 'canary'), 'utf8'), 'do-not-read');
  }
});
