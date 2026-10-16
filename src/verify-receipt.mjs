// Verify a receipt envelope. Offline unless --sigstore is asked for, and that import is lazy.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { receiptZeroConfig } from './infer.mjs';

const STATEMENT = 'https://in-toto.io/Statement/v1';
const PAYLOAD_TYPE = 'application/vnd.in-toto+json';
const PREDICATE_TYPE = 'https://proofline.dev/receipt/v1';

export function pae(payloadType, payload) {
  const t = Buffer.from(payloadType);
  const b = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return Buffer.concat([Buffer.from(`DSSEv1 ${t.length} `), t, Buffer.from(` ${b.length} `), b]);
}

function fromB64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/_=-]+$/.test(s)) return null;
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function loadKeys(dir) {
  const out = new Map();
  if (!dir || !fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.pem')) continue;
    const pem = fs.readFileSync(path.join(dir, name), 'utf8');
    out.set(name.slice(0, -4), crypto.createPublicKey(pem));
  }
  return out;
}

function schemaProblem(statement) {
  if (!statement || statement._type !== STATEMENT) return 'statement _type';
  if (statement.predicateType !== PREDICATE_TYPE) return 'predicateType';
  const p = statement.predicate;
  if (!p || typeof p !== 'object') return 'predicate';
  if (!['L0', 'L1', 'L2'].includes(p.level)) return 'predicate.level';
  if (p.agent != null && typeof p.agent !== 'object') return 'predicate.agent';
  return null;
}

function result(exitCode, message, extra = {}) {
  return { exitCode, message, differences: extra.differences || [], level: extra.level || null, ...extra };
}

function verifySignatures(envelope, keys) {
  if (!envelope || typeof envelope.payloadType !== 'string' || typeof envelope.payload !== 'string' || !Array.isArray(envelope.signatures) || !envelope.signatures.length) {
    return { problem: 'schema', detail: 'a DSSE envelope needs payloadType, payload and one signature' };
  }
  const body = fromB64(envelope.payload);
  if (!body) return { problem: 'schema', detail: 'payload is not base64' };
  const data = pae(envelope.payloadType, body);
  let verified = 0;
  let unknown = 0;
  let failed = 0;
  for (const s of envelope.signatures) {
    const id = typeof s?.keyid === 'string' ? s.keyid : '';
    const sig = fromB64(s?.sig || '');
    const key = keys.get(id);
    if (!key || !sig) { unknown++; continue; }
    const ok = crypto.verify(null, data, key, sig);
    if (ok) verified++;
    else failed++;
  }
  return { body, verified, unknown, failed };
}

/**
 * @param {string} envelopePath
 * @param {{ root?: string, keys?: string, sigstore?: boolean, recompute?: boolean, base?: string, suite?: boolean }} [opts]
 */
export async function verifyReceipt(envelopePath, opts = {}) {
  if (!envelopePath) return result(3, 'usage: verify-receipt <envelope>');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(envelopePath, 'utf8')); }
  catch { return result(1, 'envelope is not JSON'); }
  if (opts.sigstore) return verifySigstore(raw);
  const keys = loadKeys(opts.keys || (process.env.AGENTKEY_HOME ? path.join(process.env.AGENTKEY_HOME, 'keys') : ''));
  const sig = verifySignatures(raw, keys);
  if (sig.problem) return result(1, sig.detail);
  if (sig.failed) return result(1, 'signature failed');
  if (!sig.verified) return result(2, 'unknown key');
  let statement;
  try { statement = JSON.parse(sig.body.toString('utf8')); }
  catch { return result(1, 'payload is not a statement'); }
  if (raw.payloadType !== PAYLOAD_TYPE) return result(1, 'payloadType is not an in-toto statement');
  const schema = schemaProblem(statement);
  if (schema) return result(1, `schema: ${schema}`);
  const level = statement.predicate.level;
  if (!opts.recompute) return result(0, `verified\nlevel ${level}`, { level });
  if (!opts.base) return result(3, '--recompute needs --base');
  const live = receiptZeroConfig(opts.root || process.cwd(), { base: opts.base });
  const recomputed = live.exitCode === 0 && live.level === 'L1' && live.suites.every((s) => s.status === 'pass');
  const differences = [];
  if (Boolean(statement.predicate.green_on_head) !== recomputed) {
    differences.push(`green_on_head: envelope ${Boolean(statement.predicate.green_on_head)} recomputed ${recomputed}`);
  }
  if (differences.length) return result(1, differences.join('\n'), { level, differences });
  return result(0, `verified\nlevel ${level}`, { level });
}

async function verifySigstore(bundle) {
  const sigs = bundle?.verificationMaterial?.tlogEntries || bundle?.signatures || [];
  if (sigs.length !== 1) return result(1, 'a sigstore bundle carries exactly one signature');
  try { await import('sigstore'); }
  catch { return result(2, 'sigstore verifier is not available'); }
  return result(2, 'sigstore verification is not confirmed offline');
}
