// Guided flow: setup, task, contract approve, watch. Each refusal names the next command.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as C from './contract.mjs';
import * as E from './engine.mjs';
import { connectClaudeCode } from './hook-stop.mjs';
import { init, installHooks, approvalsDir, activeTask } from './index.mjs';
import { git, sha256 } from './util.mjs';

const TASK_SCOPE = 'src/**,bin/**,test/**,docs/**,README.md,CHANGELOG.md,package.json';
// A few seconds: one failing sample is visible, then the loop ends if the gate is still not PASS.
const WATCH_BOUND_MS = 6000;
const WATCH_INTERVAL_MS = 1000;

const refuse = (why, next) => new Error(`${why}\nNext step: ${next}`);

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** agentkey on PATH. AGENTKEY_HOME is required so the default key directory is never opened. */
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

function hooksReady(root) {
  const hd = git(['rev-parse', '--git-path', 'hooks'], root);
  if (!hd.ok) return false;
  const dir = path.resolve(root, hd.out);
  for (const name of ['pre-commit', 'pre-push']) {
    try {
      const f = path.join(dir, name);
      const st = fs.statSync(f);
      if (!st.isFile() || (st.mode & 0o111) === 0) return false;
      if (!fs.readFileSync(f, 'utf8').includes('# installed by proofline')) return false;
    } catch { return false; }
  }
  return true;
}

function createOwnerKey(env) {
  const home = env.AGENTKEY_HOME;
  if (typeof home !== 'string' || !home.trim()) throw refuse('AGENTKEY_HOME is not set, so no key directory was opened', 'proofline setup');
  const bin = agentkeyBin(env);
  if (!bin) throw refuse('agentkey is not on PATH', 'proofline setup');
  const r = spawnSync(bin, ['init', 'owner'], { encoding: 'utf8', env: { ...env, AGENTKEY_HOME: home } });
  if (r.error || r.status !== 0) throw refuse('agentkey init owner failed', 'proofline setup');
  const key = path.join(home, 'keys', 'owner.key');
  let st = null;
  try { st = fs.lstatSync(key); } catch { st = null; }
  if (!st || !st.isFile() || st.isSymbolicLink()) throw refuse('the owner key was not created', 'proofline setup');
}

function ownerPaths(root, env) {
  return { pub: path.join(env.AGENTKEY_HOME, 'keys', 'owner.pub'), pin: path.resolve(root, 'guard', 'owner.pub') };
}

/** The pinned bytes, or null when there is no pin. A pin that is not a regular file is refused. */
function readPin(pin) {
  let st;
  try { st = fs.lstatSync(pin); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw refuse(`${pin} cannot be read`, `ls -l ${pin}`);
  }
  if (!st.isFile()) throw refuse(`${pin} is not a regular file`, `ls -l ${pin}`);
  return fs.readFileSync(pin);
}

const pinMismatch = (pin, pub) => refuse(`${pin} does not hold the owner key at ${pub}, and a pinned owner key is never replaced`, 'AGENTKEY_HOME=<the directory that holds the pinned key> proofline setup');

/** Before anything is written: a pin that is there must hold the key AGENTKEY_HOME already has. */
function checkOwnerPin(root, env) {
  const { pub, pin } = ownerPaths(root, env);
  const have = readPin(pin);
  if (!have) return;
  let want = null;
  try { want = fs.readFileSync(pub); } catch { want = null; }
  if (!want || !have.equals(want)) throw pinMismatch(pin, pub);
}

/** guard/owner.pub is the only key verifyContractSignature reads. Written once from the key setup created. */
function pinOwnerKey(root, env) {
  const { pub, pin } = ownerPaths(root, env);
  let want;
  try { want = fs.readFileSync(pub); } catch { throw refuse(`the owner public key ${pub} was not created`, 'proofline setup'); }
  const have = readPin(pin);
  if (have) {
    if (!have.equals(want)) throw pinMismatch(pin, pub);
    return;
  }
  fs.mkdirSync(path.dirname(pin), { recursive: true });
  fs.writeFileSync(pin, want, { flag: 'wx', mode: 0o644 });
}

/**
 * init, hooks, the owner key, guard/owner.pub from that key, approvals at .proofline/approvals.
 * Prints three lines. Refuses, without those lines, when a hook is missing.
 * Refuses before init when guard/owner.pub holds a key other than the one in AGENTKEY_HOME.
 */
export function setup(root, { agent = 'none', env = process.env } = {}) {
  if (agent !== 'none' && agent !== 'claude-code') throw refuse(`unknown agent ${agent}`, 'proofline setup --agent none');
  if (!git(['rev-parse', '--show-toplevel'], root).ok) throw refuse('not a git repository', 'git init');
  const approvals = path.resolve(root, '.proofline', 'approvals');
  if (typeof env.AGENTKEY_HOME !== 'string' || !env.AGENTKEY_HOME.trim()) throw refuse('AGENTKEY_HOME is not set, so no key directory was opened', 'proofline setup');
  if (!agentkeyBin(env)) throw refuse('agentkey is not on PATH', 'proofline setup');
  checkOwnerPin(root, env);
  try {
    init(root, { hooks: true, approvals });
    installHooks(root);
  } catch {
    throw refuse('a hook is missing', 'proofline setup');
  }
  if (!hooksReady(root)) throw refuse('a hook is missing', 'proofline setup');
  createOwnerKey(env);
  pinOwnerKey(root, env);
  fs.mkdirSync(approvals, { recursive: true });
  if (agent === 'claude-code') {
    const connected = connectClaudeCode();
    if (!connected.ok) throw refuse(connected.reason, 'proofline setup --agent claude-code');
  }
  return `${approvals}\nhooks installed\nproofline task\n`;
}

function freshId(text) {
  const have = new Set((JSON.parse(text).tasks || []).map((t) => t.id));
  let id = 'TASK';
  let n = 2;
  while (have.has(id)) id = `TASK-${n++}`;
  return id;
}

/** Scaffold a task from plain words and write the proposal bytes. The contract file stays as it is. */
export function task(root, words) {
  const title = String(words || '').trim();
  if (!title) throw refuse('name the task in plain words', 'proofline task "<plain words>"');
  const file = C.contractPath(root);
  if (!fs.existsSync(file)) throw refuse('no contract yet', 'proofline setup');
  const before = fs.readFileSync(file, 'utf8');
  let proposal;
  try {
    const spec = C.scaffoldTask({ title, scope: TASK_SCOPE, kind: 'feature', id: freshId(before) });
    proposal = C.appendTaskText(before, [spec]);
  } catch (e) {
    throw refuse(e.message, 'proofline task "<plain words>"');
  }
  const problems = C.validate(JSON.parse(proposal));
  if (problems.length) throw refuse(`proposal is not valid: ${problems.join('; ')}`, 'proofline task "<plain words>"');
  const hex = sha256(proposal);
  const dir = path.join(root, '.proofline', 'proposals');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, hex), proposal);
  return `${hex}\nproofline contract approve ${hex}\n`;
}

function unified(current, next) {
  const a = path.join(os.tmpdir(), `pl-now-${process.pid}`);
  const b = path.join(os.tmpdir(), `pl-new-${process.pid}`);
  fs.writeFileSync(a, current);
  fs.writeFileSync(b, next);
  const r = spawnSync('diff', ['-u', a, b], { encoding: 'utf8' });
  fs.rmSync(a, { force: true });
  fs.rmSync(b, { force: true });
  return r.stdout || '';
}

function readAnswer() {
  process.stderr.write('Apply? [y/N] ');
  if (process.stdin.isTTY) {
    const buf = Buffer.alloc(256);
    let n = 0;
    try { n = fs.readSync(0, buf, 0, buf.length, null); } catch { n = 0; }
    return buf.toString('utf8', 0, n).split(/\r?\n/, 1)[0].trim();
  }
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = ''; }
  return (raw.split(/\r?\n/, 1)[0] ?? '').trim();
}

function proposalBytes(root, hash) {
  const dir = path.join(root, '.proofline', 'proposals');
  if (!hash) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /^[0-9a-f]{64}$/.test(n)); } catch { names = []; }
    if (names.length !== 1) throw refuse('name the proposal hash', 'proofline task "<plain words>"');
    hash = names[0];
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) throw refuse('name the proposal hash', 'proofline contract approve');
  const file = path.join(dir, hash);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { throw refuse(`no proposal ${hash}`, 'proofline task "<plain words>"'); }
  if (sha256(bytes) !== hash) throw refuse(`proposal bytes do not match ${hash}`, 'proofline task "<plain words>"');
  return { hash, bytes };
}

/** Show the diff, then apply only on y. The marker is a regular file named by the proposal sha256. */
export function approve(root, hash) {
  if (!fs.existsSync(C.contractPath(root))) throw refuse('no contract yet', 'proofline setup');
  const { hash: hex, bytes } = proposalBytes(root, hash);
  const current = fs.readFileSync(C.contractPath(root));
  const diff = unified(current, bytes);
  const answer = readAnswer();
  if (answer !== 'y' && answer !== 'Y') return `${diff}${diff.endsWith('\n') || diff === '' ? '' : '\n'}nothing applied\n`;
  const dir = approvalsDir(root);
  if (!dir) throw refuse('no approvals directory configured', 'proofline setup');
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, hex);
  let st = null;
  try { st = fs.lstatSync(marker); } catch { st = null; }
  if (st && (!st.isFile() || st.isSymbolicLink())) throw refuse(`marker ${marker} is not a regular file`, `proofline contract approve ${hex}`);
  if (!st) fs.writeFileSync(marker, '', { flag: 'wx', mode: 0o644 });
  fs.writeFileSync(C.contractPath(root), bytes);
  return `${diff}${diff.endsWith('\n') || diff === '' ? '' : '\n'}applied ${hex}\n`;
}

/** Print the task's criteria until the gate is PASS, or return non-zero when the bound ends. */
export function watch(root, taskArg) {
  const id = taskArg || activeTask(root);
  if (!id) throw refuse('no active task', 'proofline next');
  const start = Date.now();
  for (;;) {
    let g;
    try { g = E.gate(root, id); }
    catch (e) { throw refuse(e.message, 'proofline next'); }
    const lines = (g.results || []).map((r) => `  ${String(r.status).toUpperCase()} ${r.id} ${r.statement || ''}`.trimEnd());
    process.stdout.write(`${g.task} ${g.decision}\n${lines.join('\n')}\n`);
    if (g.decision === 'PASS') return 0;
    if (Date.now() - start >= WATCH_BOUND_MS) return 1;
    pause(Math.min(WATCH_INTERVAL_MS, WATCH_BOUND_MS - (Date.now() - start)));
  }
}
