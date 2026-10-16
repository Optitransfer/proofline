// Attach a hivevault digest to a receipt, and write the note when asked.
// A missing daemon leaves the receipt unchanged. The probe gives up after 2 seconds.
import crypto from 'node:crypto';

const DIGEST_PATH = '/v1/state/digest';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** GET the digest. Returns null when the daemon is absent, refuses, or exceeds the timeout. */
export async function probeDigest(url, token, { timeout = 2000 } = {}) {
  const base = url || process.env.HIVEVAULT_URL || 'http://127.0.0.1:7788';
  const bearer = token ?? process.env.HIVEVAULT_TOKEN ?? '';
  try {
    const res = await fetch(new URL(DIGEST_PATH, base), {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body.digest !== 'string') return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Copy a digest onto a receipt.
 * L1 gets memory.vault_digest and memory.frontier.
 * mode `ci` (an L2 receipt) gets only memory_commitment, so a replica id stays inside the hash.
 * No digest: the receipt is returned without a memory field, and exitCode is unchanged.
 */
export function attachMemory(receipt, digest, { mode = 'local', vaultId = '' } = {}) {
  const exitCode = receipt?.exitCode ?? 0;
  if (!digest) {
    const next = { ...receipt };
    delete next.memory;
    delete next.memory_commitment;
    return { receipt: next, exitCode };
  }
  if (mode === 'ci' || receipt?.level === 'L2') {
    const commitment = sha256(`${vaultId || digest.vault_id || digest.replica || ''}${digest.digest}${JSON.stringify(digest.frontier ?? null)}`);
    const next = { ...receipt, memory_commitment: commitment };
    delete next.memory;
    return { receipt: next, exitCode };
  }
  const next = {
    ...receipt,
    memory: { vault_digest: digest.digest, frontier: digest.frontier ?? null },
  };
  delete next.memory_commitment;
  return { receipt: next, exitCode };
}

export function receiptNotePath({ date, role = 'agent', sha }) {
  const day = (date instanceof Date ? date : new Date(date || Date.now())).toISOString().slice(0, 10);
  const short = String(sha || '').slice(0, 7);
  return `work/receipts/${day}-${role}-${short}.md`;
}

export function receiptNote({ receipt, role = 'agent', subject = '', agent = '', summary = '', envelopeSha = '', date } = {}) {
  const level = receipt?.level || 'L1';
  const frontmatter = {
    kind: 'proof-receipt',
    level,
    subject,
    agent,
    predicate_type: 'https://proofline.dev/receipt/v1',
    summary,
    envelope_sha256: envelopeSha,
    origin: 'proofline',
  };
  const lines = ['| field | value |', '| --- | --- |', `| level | ${level} |`, `| subject | ${subject} |`];
  if (receipt?.memory) lines.push(`| vault_digest | ${receipt.memory.vault_digest} |`);
  if (receipt?.memory_commitment) lines.push('| memory_commitment | present |');
  const body = `${lines.join('\n')}\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n`;
  const rel = receiptNotePath({ date, role, sha: envelopeSha });
  const fm = ['---', ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`), '---', ''].join('\n');
  return { path: rel, frontmatter, body, text: fm + body };
}

/** PUT the note. origin is proofline. Returns null when the write does not land. */
export async function writeReceiptNote(note, { url, token, timeout = 2000, vault = false } = {}) {
  const base = url || process.env.HIVEVAULT_URL || 'http://127.0.0.1:7788';
  const bearer = token ?? process.env.HIVEVAULT_TOKEN ?? '';
  if (process.env.PROOFLINE_VAULT !== '1' && vault !== true) return null;
  try {
    const res = await fetch(new URL(`/v1/notes/${note.path}`, base), {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({
        frontmatter: note.frontmatter,
        body: note.body,
        origin: 'proofline',
        commit_message: `proofline receipt ${note.path}`,
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    return { path: note.path, status: res.status };
  } catch {
    return null;
  }
}
