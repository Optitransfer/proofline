// Shared helpers for the user-simulation bot: vault setup, REST + MCP (stdio and Streamable HTTP) clients, timing.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const REPO = process.env.HV_REPO || process.cwd();
export const CLI = path.join(REPO, 'cli', 'hivevault.mjs');
export const SERVER = path.join(REPO, 'server', 'src', 'server.mjs');

export function cli(args, { home, root, port, allowFail = false, input } = {}) {
  const env = { ...process.env, HOME: home, HIVEVAULT_ROOT: root ?? '', HIVEVAULT_PORT: String(port ?? '') };
  if (!root) delete env.HIVEVAULT_ROOT;
  const t0 = Date.now();
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input, timeout: 120000 });
    return { code: 0, out, ms: Date.now() - t0 };
  } catch (e) {
    if (!allowFail) throw new Error(`hivevault ${args.join(' ')} failed (${e.status}): ${e.stdout}\n${e.stderr}`);
    return { code: e.status, out: (e.stdout ?? '') + (e.stderr ?? ''), ms: Date.now() - t0 };
  }
}

export async function initVault({ home, dir, port }) {
  fs.mkdirSync(home, { recursive: true });
  const r = cli(['init', dir, '--yes', '--no-capture', '--no-service', '--no-connect', '--no-default', '--port', String(port)], { home, port });
  const admin = fs.readFileSync(path.join(dir, '.vault', 'admin-token.txt'), 'utf8').trim();
  return { home, root: dir, port, admin, base: `http://127.0.0.1:${port}`, initMs: r.ms, initOut: r.out };
}

export async function http(v, method, p, { token, body, headers = {}, raw } = {}) {
  const t0 = performance.now();
  const h = { ...headers };
  if (token !== null) h.authorization = `Bearer ${token ?? v.admin}`;
  let payload = raw;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  try {
    const res = await fetch(v.base + p, { method, headers: h, body: payload });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, json, text, ms: performance.now() - t0, headers: res.headers };
  } catch (e) {
    return { status: 0, error: String(e.cause?.code ?? e.message), ms: performance.now() - t0 };
  }
}

export async function mint(v, agent, subject, extra = {}) {
  const r = await http(v, 'POST', '/v1/tokens', { body: { agent, subject, scopes: ['read', 'write'], ...extra } });
  if (r.status >= 300) throw new Error(`mint ${agent}: ${r.status} ${r.text}`);
  return r.json.token ?? r.json.secret ?? r.json.value;
}

// MCP over stdio: the way a local AI client (Claude Code, Cursor) runs hivevault.
export class StdioMcp {
  constructor(v, token, clientName, env = {}) {
    this.p = spawn(process.execPath, [SERVER, '--stdio', ...(v.noRoot ? [] : ['--root', v.root])], { env: { ...process.env, HOME: v.home, HIVEVAULT_ROOT: v.root, HIVEVAULT_PORT: String(v.port), HIVEVAULT_TOKEN: token, ...env }, cwd: v.cwd ?? v.root, stdio: ['pipe', 'pipe', 'pipe'] });
    this.id = 0; this.pending = new Map(); this.stderr = ''; this.clientName = clientName; this.notifications = [];
    this.p.stderr.on('data', (d) => { this.stderr += d; });
    readline.createInterface({ input: this.p.stdout }).on('line', (l) => {
      let m; try { m = JSON.parse(l); } catch { this.badLines = (this.badLines ?? 0) + 1; return; }
      if (m.id !== undefined && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); } else this.notifications.push(m);
    });
    this.exit = new Promise((r) => this.p.on('exit', (code) => r(code)));
  }
  send(method, params, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.pending.delete(id); resolve({ timeout: true }); }, timeout);
      this.pending.set(id, (m) => { clearTimeout(t); resolve(m); });
      this.p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  sendRaw(line) { this.p.stdin.write(line + '\n'); }
  async init() { return this.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: this.clientName, version: '1.0' } }); }
  async tool(name, args, to) { const t0 = performance.now(); const m = await this.send('tools/call', { name, arguments: args }, to); return { ...m, ms: performance.now() - t0, data: parseTool(m) }; }
  close() { try { this.p.stdin.end(); } catch {} setTimeout(() => this.p.kill(), 500); return this.exit; }
}

// MCP over Streamable HTTP: the way a cloud client (claude.ai through the tunnel) reaches it.
export class HttpMcp {
  constructor(v, token, clientName) { this.v = v; this.token = token; this.clientName = clientName; this.id = 0; this.session = null; }
  async send(method, params) {
    const headers = { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (this.session) headers['mcp-session-id'] = this.session;
    const t0 = performance.now();
    const res = await fetch(this.v.base + '/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }) });
    if (res.headers.get('mcp-session-id')) this.session = res.headers.get('mcp-session-id');
    let text = await res.text();
    if ((res.headers.get('content-type') ?? '').includes('event-stream')) text = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? '';
    let m; try { m = JSON.parse(text); } catch { m = { parseError: text.slice(0, 200), status: res.status }; }
    return { ...m, httpStatus: res.status, ms: performance.now() - t0 };
  }
  async init() { return this.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: this.clientName, version: '1.0' } }); }
  async tool(name, args) { const m = await this.send('tools/call', { name, arguments: args }); return { ...m, data: parseTool(m) }; }
}

export function parseTool(m) {
  if (!m?.result) return undefined;
  if (m.result.structuredContent) return m.result.structuredContent;
  try { return JSON.parse(m.result.content?.[0]?.text); } catch { return m.result.content?.[0]?.text; }
}

export function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }); }

/** Does the vault's HEAD commit hold every path in `want`, with the bytes that are on disk? */
export function commitHolds(root, want) {
  let sha; try { sha = execFileSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return { ok: false, sha: null, have: 0 }; }
  const blobs = new Map();
  for (const e of execFileSync('git', ['-C', root, 'ls-tree', '-r', '-z', '--full-tree', 'HEAD'], { encoding: 'utf8', maxBuffer: 256 << 20 }).split('\0')) {
    const tab = e.indexOf('\t'); if (tab < 0) continue;
    const p = e.slice(tab + 1); if (want.has(p)) blobs.set(p, e.slice(0, tab).split(' ')[2]);
  }
  if (blobs.size < want.size) return { ok: false, sha, have: blobs.size };
  // Every path is in the commit; it holds the batch only if each blob is the file as written (#465: a commit can hold later bytes).
  const paths = [...want];
  const disk = execFileSync('git', ['-C', root, 'hash-object', '--stdin-paths'], { input: paths.join('\n') + '\n', encoding: 'utf8', maxBuffer: 256 << 20 }).trim().split('\n');
  const same = paths.filter((p, i) => blobs.get(p) === disk[i]).length;
  return { ok: same === paths.length, sha, have: same };
}

/**
 * Time a batch flush to completion. The flush asks for wait: "sealed" (hivevault answers before the seal and the
 * commit unless it honours that, mgillr/hivevault#468), then polls until the vault's HEAD commit holds the batch.
 * flushAnswerMs is the time to the answer; flushMs the time to the commit. A timeout records flushCommitted: 0 and
 * flushErr, never a flushMs.
 */
export async function flushToCommit(v, paths, { timeoutMs = 600000, pollMs = 25 } = {}) {
  const t0 = performance.now();
  const f = await http(v, 'POST', '/v1/notes/batch', { body: { flush: true, wait: 'sealed' } });
  const out = { flushAnswerMs: +(performance.now() - t0).toFixed(0), flushStatus: f.status, flushResp: (f.text || f.error || '').slice(0, 300) };
  if (!(f.status >= 200 && f.status < 300)) return { ...out, flushCommitted: 0, flushErr: `flush answered ${f.status}` };
  const want = new Set(paths);
  let last = { sha: null, have: 0 }, seen = null;
  for (;;) {
    const head = (() => { try { return execFileSync('git', ['-C', v.root, 'rev-parse', '--verify', '--quiet', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } })();
    if (head && head !== seen) { seen = head; last = commitHolds(v.root, want); if (last.ok) return { ...out, flushMs: +(performance.now() - t0).toFixed(0), flushCommit: last.sha, flushCommitted: 1 }; }
    if (performance.now() - t0 > timeoutMs) return { ...out, flushCommitted: 0, flushErr: `no commit held all ${want.size} paths within ${timeoutMs} ms (HEAD ${last.sha || 'none'} held ${last.have} of ${want.size})` };
    await sleep(pollMs);
  }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function pct(arr, p) { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); }
