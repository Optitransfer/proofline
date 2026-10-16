// Owner signature over the canonical contract. The public key is read from guard/owner.pub only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as C from './contract.mjs';
import { git, sha256 } from './util.mjs';

export const PAYLOAD_TYPE = 'application/vnd.proofline.contract-sha256';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalHash(root) {
  return sha256(canonical(JSON.parse(fs.readFileSync(C.contractPath(root), 'utf8'))));
}

function pae(payloadType, body) {
  const t = Buffer.from(payloadType);
  const b = Buffer.from(body);
  return Buffer.concat([Buffer.from(`DSSEv1 ${t.length} `), t, Buffer.from(` ${b.length} `), b]);
}

function agentkeyBin(env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, 'agentkey');
    try {
      const st = fs.statSync(f);
      if (st.isFile() && (st.mode & 0o111)) return f;
    } catch { /* keep looking */ }
  }
  return null;
}

/** Armed only when guard/owner.pub is present. A missing pin is reported, and no other key path is opened. */
export function verifyContractSignature(root) {
  const pubPath = path.join(root, 'guard', 'owner.pub');
  let pem;
  try { pem = fs.readFileSync(pubPath, 'utf8'); }
  catch { return { ok: false, armed: false, detail: 'guard/owner.pub is missing' }; }
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(path.join(root, 'proofline.json.sig'), 'utf8')); }
  catch { return { ok: false, armed: true, detail: 'proofline.json.sig is missing or not a signature' }; }
  if (!envelope || envelope.payloadType !== PAYLOAD_TYPE || typeof envelope.payload !== 'string') {
    return { ok: false, armed: true, detail: 'proofline.json.sig is not an owner signature' };
  }
  let payload;
  try { payload = Buffer.from(envelope.payload, 'base64').toString('utf8'); }
  catch { return { ok: false, armed: true, detail: 'signature payload is not base64' }; }
  const hash = canonicalHash(root);
  if (payload !== hash) return { ok: false, armed: true, detail: 'signature is not over the current contract' };
  const sig = envelope.signatures?.[0]?.sig;
  if (typeof sig !== 'string') return { ok: false, armed: true, detail: 'signature is missing' };
  try {
    const key = crypto.createPublicKey(pem);
    const ok = crypto.verify(null, pae(PAYLOAD_TYPE, Buffer.from(payload)), key, Buffer.from(sig, 'base64'));
    if (!ok) return { ok: false, armed: true, detail: 'signature does not verify against guard/owner.pub' };
  } catch {
    return { ok: false, armed: true, detail: 'guard/owner.pub is not a usable public key' };
  }
  return { ok: true, armed: true, detail: 'owner signature matches' };
}

/** Owner laptop: agentkey signs the canonical hash. AGENTKEY_HOME is required, so the default key directory is never opened. */
export function signContract(root, env = process.env) {
  const home = env.AGENTKEY_HOME;
  if (typeof home !== 'string' || !home.trim()) {
    throw new Error('AGENTKEY_HOME is not set, so no key directory was opened\nNext step: proofline contract sign');
  }
  const bin = agentkeyBin(env);
  if (!bin) throw new Error('agentkey is not on PATH\nNext step: proofline contract sign');
  const hash = canonicalHash(root);
  const r = spawnSync(bin, ['sign', 'owner', '--type', PAYLOAD_TYPE], {
    input: hash, encoding: 'utf8', env: { ...env, AGENTKEY_HOME: home },
  });
  if (r.error || r.status !== 0) throw new Error(`agentkey sign owner failed\nNext step: proofline contract sign`);
  JSON.parse(r.stdout);
  fs.writeFileSync(path.join(root, 'proofline.json.sig'), r.stdout.endsWith('\n') ? r.stdout : `${r.stdout}\n`);
  return `${hash}\n`;
}

function unified(before, after) {
  const a = path.join(os.tmpdir(), `pl-sig-a-${process.pid}`);
  const b = path.join(os.tmpdir(), `pl-sig-b-${process.pid}`);
  fs.writeFileSync(a, before);
  fs.writeFileSync(b, after);
  const r = spawnSync('diff', ['-u', a, b], { encoding: 'utf8' });
  fs.rmSync(a, { force: true });
  fs.rmSync(b, { force: true });
  return r.stdout || '';
}

/** The agent path: write proposals/<sha256>.diff and print the hash. It does not change proofline.json. */
export function proposeContract(root) {
  const current = fs.readFileSync(C.contractPath(root));
  const shown = git(['show', 'HEAD:proofline.json'], root);
  const diff = unified(shown.ok ? shown.out : '', current);
  const hex = sha256(diff);
  const dir = path.join(root, '.proofline', 'proposals');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${hex}.diff`), diff);
  return `${hex}\n`;
}
