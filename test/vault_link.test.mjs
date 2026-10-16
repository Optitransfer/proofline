import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attachMemory, probeDigest, receiptNote, writeReceiptNote } from '../src/vault.mjs';

const require = createRequire(import.meta.url);
const hivevaultBin = path.join(path.dirname(require.resolve('hivevault/package.json')), 'cli', 'hivevault.mjs');

function redact(s) {
  return String(s).replace(/vmt_[A-Za-z0-9]+_[A-Za-z0-9]+/g, 'vmt_redacted');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function runHivevault(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hivevaultBin, ...args], {
      env,
      cwd: env.HOME,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(redact(`hivevault ${args.join(' ')} timed out\n${out}\n${err}`)));
    }, 120000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(redact(`hivevault ${args.join(' ')} exited ${code}\n${out}\n${err}`)));
      else resolve(out);
    });
  });
}

async function throwawayVault() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pl05-home-'));
  const root = path.join(home, 'vault');
  const port = await freePort();
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') };
  delete env.HIVEVAULT_TOKEN;
  delete env.HIVEVAULT_URL;
  env.HIVEVAULT_ROOT = root;
  env.HIVEVAULT_PORT = String(port);
  const flags = ['--yes', '--no-connect', '--no-hook', '--no-start', '--no-demo', '--no-service', '--no-default', '--no-tunnel-key', '--port', String(port)];
  let started = false;
  try {
  await runHivevault(['init', root, ...flags], env);
  await runHivevault(['--root', root, '--port', String(port), 'start'], env);
  started = true;
  const token = fs.readFileSync(path.join(root, '.vault', 'admin-token.txt'), 'utf8').trim();
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  let live = null;
  while (Date.now() < deadline) {
    live = await probeDigest(url, token, { timeout: 1000 });
    if (live && typeof live.digest === 'string') break;
    live = null;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!live) throw new Error('the throwaway daemon did not answer GET /v1/state/digest');
  return {
    url,
    token,
    live,
    async stop() {
      await runHivevault(['--root', root, 'stop'], env).catch(() => {});
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
  } catch (err) {
    if (started) await runHivevault(['--root', root, 'stop'], env).catch(() => {});
    fs.rmSync(home, { recursive: true, force: true });
    throw err;
  }
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

test('with a daemon the digest is copied, ci keeps only the commitment, and the note lands', { timeout: 180000 }, async () => {
  const vault = await throwawayVault();
  try {
    const { url, token } = vault;
    const live = await probeDigest(url, token);
    assert.equal(typeof live.digest, 'string');
    assert.match(live.digest, /^[0-9a-f]{64}$/);
    assert.equal(typeof live.replica, 'string');
    assert.ok(live.replica.length > 0);
    const l1 = attachMemory({ level: 'L1', exitCode: 0 }, live);
    assert.equal(l1.exitCode, 0);
    assert.equal(l1.receipt.memory.vault_digest, live.digest);
    assert.deepEqual(l1.receipt.memory.frontier, live.frontier ?? null);
    const ci = attachMemory({ level: 'L2', exitCode: 0 }, live, { mode: 'ci', vaultId: 'vault-1' });
    assert.equal(ci.receipt.memory, undefined);
    assert.equal(ci.receipt.memory_commitment, sha256(`vault-1${live.digest}${JSON.stringify(live.frontier ?? null)}`));
    assert.equal(JSON.stringify(ci.receipt).includes(live.replica), false);
    const note = receiptNote({
      receipt: l1.receipt, role: 'claude-code', subject: 'repo', agent: 'local',
      summary: 'green', envelopeSha: 'abcdef1234567890', date: new Date('2026-10-16T00:00:00Z'),
    });
    assert.equal(note.path, 'work/receipts/2026-10-16-claude-code-abcdef1.md');
    assert.equal(note.frontmatter.kind, 'proof-receipt');
    assert.equal(note.frontmatter.origin, 'proofline');
    const wrote = await writeReceiptNote(note, { url, token, vault: true });
    assert.equal(wrote && wrote.path, note.path);
    const stored = await fetch(new URL(`/v1/notes/${note.path}?raw=1`, url), {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(stored.ok, true);
    const body = await stored.json();
    assert.match(body.raw, /^---\n[\s\S]*\norigin: proofline\n[\s\S]*\n---\n/);
    assert.match(body.raw, /envelope_sha256: abcdef1234567890/);
  } finally {
    await vault.stop();
  }
});

test('without a daemon the memory field is absent and the exit code stays 0', async () => {
  const hung = http.createServer(() => {});
  await new Promise((resolve) => hung.listen(0, '127.0.0.1', resolve));
  const { port } = hung.address();
  try {
    const live = await probeDigest(`http://127.0.0.1:${port}`, 'test-token');
    assert.equal(live, null);
    const got = attachMemory({ level: 'L1', exitCode: 0, green_on_head: true }, live);
    assert.equal(got.exitCode, 0);
    assert.equal(got.receipt.memory, undefined);
    assert.equal(got.receipt.memory_commitment, undefined);
    assert.equal(got.receipt.green_on_head, true);
  } finally {
    await new Promise((resolve) => hung.close(resolve));
  }
});
