import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyReceipt } from '../src/verify-receipt.mjs';

const PAYLOAD_TYPE = 'application/vnd.in-toto+json';

function pae(payloadType, payload) {
  const t = Buffer.from(payloadType);
  const b = Buffer.from(payload);
  return Buffer.concat([Buffer.from(`DSSEv1 ${t.length} `), t, Buffer.from(` ${b.length} `), b]);
}

test('offline verification needs no network and does not load sigstore', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-vro-'));
  const keys = path.join(root, 'keys');
  fs.mkdirSync(keys);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(keys, 'local.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  const payload = JSON.stringify({
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'repo', digest: { sha256: 'cd'.repeat(32) } }],
    predicateType: 'https://proofline.dev/receipt/v1',
    predicate: { level: 'L1', green_on_head: false },
  });
  const sig = crypto.sign(null, pae(PAYLOAD_TYPE, payload), privateKey);
  const file = path.join(root, 'receipt.json');
  fs.writeFileSync(file, JSON.stringify({
    payloadType: PAYLOAD_TYPE, payload: Buffer.from(payload).toString('base64'),
    signatures: [{ keyid: 'local', sig: sig.toString('base64') }],
  }));
  const prev = {
    HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY,
    http_proxy: process.env.http_proxy, https_proxy: process.env.https_proxy,
  };
  process.env.HTTP_PROXY = '';
  process.env.HTTPS_PROXY = '';
  process.env.http_proxy = '';
  process.env.https_proxy = '';
  try {
    const got = await verifyReceipt(file, { keys, root });
    assert.equal(got.exitCode, 0);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const src = fs.readFileSync(new URL('../src/verify-receipt.mjs', import.meta.url), 'utf8');
  assert.match(src, /import\('sigstore'\)/);
  assert.equal(src.includes("from 'sigstore'"), false);
});
