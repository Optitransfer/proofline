import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { verifyReceipt } from '../src/verify-receipt.mjs';

const PAYLOAD_TYPE = 'application/vnd.in-toto+json';

function pae(payloadType, payload) {
  const t = Buffer.from(payloadType);
  const b = Buffer.from(payload);
  return Buffer.concat([Buffer.from(`DSSEv1 ${t.length} `), t, Buffer.from(` ${b.length} `), b]);
}

function statement(predicate) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'repo', digest: { sha256: 'ab'.repeat(32) } }],
    predicateType: 'https://proofline.dev/receipt/v1',
    predicate,
  };
}

function sign(obj, privateKey, keyid) {
  const payload = JSON.stringify(obj);
  const sig = crypto.sign(null, pae(PAYLOAD_TYPE, payload), privateKey);
  return { payloadType: PAYLOAD_TYPE, payload: Buffer.from(payload).toString('base64'), signatures: [{ keyid, sig: sig.toString('base64') }] };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-vr-'));
  const keys = path.join(root, 'keys');
  fs.mkdirSync(keys);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(keys, 'local.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  return { root, keys, privateKey };
}

function writeEnv(root, envelope) {
  const file = path.join(root, 'receipt.json');
  fs.writeFileSync(file, JSON.stringify(envelope));
  return file;
}

test('a valid envelope verifies and prints the level', async () => {
  const { root, keys, privateKey } = fixture();
  const file = writeEnv(root, sign(statement({ level: 'L1', green_on_head: true }), privateKey, 'local'));
  const got = await verifyReceipt(file, { keys, root });
  assert.equal(got.exitCode, 0);
  assert.equal(got.level, 'L1');
  assert.match(got.message, /level L1/);
});

test('a schema failure and a bad signature exit 1, and an unknown key exits 2', async () => {
  const { root, keys, privateKey } = fixture();
  const broken = sign(statement({ level: 'nope' }), privateKey, 'local');
  const schema = await verifyReceipt(writeEnv(root, broken), { keys, root });
  assert.equal(schema.exitCode, 1);

  const env = sign(statement({ level: 'L1', green_on_head: true }), privateKey, 'local');
  env.signatures[0].sig = Buffer.from('not-the-signature').toString('base64');
  const bad = await verifyReceipt(writeEnv(root, env), { keys, root });
  assert.equal(bad.exitCode, 1);

  const unknown = await verifyReceipt(writeEnv(root, sign(statement({ level: 'L1' }), privateKey, 'other')), { keys, root });
  assert.equal(unknown.exitCode, 2);
});

test('an altered green_on_head is reported as differing under --recompute', async () => {
  const { root, keys, privateKey } = fixture();
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }) + '\n');
  execFileSync('git', ['add', 'package.json'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: root });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const file = writeEnv(root, sign(statement({ level: 'L1', green_on_head: true }), privateKey, 'local'));
  const got = await verifyReceipt(file, { keys, root, recompute: true, base });
  assert.equal(got.exitCode, 1);
  assert.ok(got.differences.some((d) => d.startsWith('green_on_head:')));
});
