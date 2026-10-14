import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as P from '../src/index.mjs';
import { readLog, logPath } from '../src/evidence.mjs';
import { handle } from '../src/mcp.mjs';
import { repo, write, addTask, commitAll, sh, BIN } from './helpers.mjs';

/**
 * A repo with one task T whose command criterion appends a line to a counter file outside the repo on every run.
 * `reuse` sets defaults.reuse_results (null leaves it out). The task is committed and started: the tree is clean.
 */
function counterRepo({ reuse = true, cmd = (count) => `echo run >> '${count}'`, defaults = {} } = {}) {
  const r = repo();
  const count = path.join(path.dirname(r), 'count');
  const c = P.C.load(r);
  if (reuse !== null) c.defaults.reuse_results = reuse;
  Object.assign(c.defaults, defaults); P.C.save(r, c);
  addTask(r, { id: 'T', title: 't', criteria: [{ statement: 'suite', verifier: { type: 'command', cmd: cmd(count) } }] });
  commitAll(r, 'task');
  P.taskNext(r);
  const runs = () => (fs.existsSync(count) ? fs.readFileSync(count, 'utf8').split('\n').filter(Boolean).length : 0);
  return { r, runs, dir: path.dirname(r) };
}
const cli = (r, args, env = {}) => spawnSync(process.execPath, [BIN, ...args, '--root', r], { encoding: 'utf8', env: { ...process.env, ...env } });
const report = (r) => fs.readFileSync(path.join(r, '.proofline', 'reports', 'T-latest.md'), 'utf8');
const results = (r) => readLog(r).filter((e) => e.type === 'result');
const cacheFiles = (r) => { try { return fs.readdirSync(path.join(r, '.proofline', 'cache')); } catch { return []; } };
const ok = (p, code = 0) => assert.equal(p.status, code, p.stdout + p.stderr);
/** verify, then gate, on the clean commit: the command runs once and the gate reuses it. */
function primed(r, runs, env) {
  ok(cli(r, ['verify', 'T'], env)); assert.equal(runs(), 1, 'verify ran the command');
  ok(cli(r, ['gate', 'T'], env)); assert.equal(runs(), 1, 'the gate reused the PASS of verify');
}

test('reuse on: verify then gate on one clean commit runs the command once, and the gate report says reused', () => {
  const { r, runs } = counterRepo();
  ok(cli(r, ['verify', 'T'])); assert.equal(runs(), 1);
  const g = cli(r, ['gate', 'T']); ok(g); assert.equal(runs(), 1, 'the gate reused the PASS of verify');
  const [e] = results(r);
  const from = `reused from ${e.ts} (evidence entry ${e.seq})`;
  assert.equal(e.data.status, 'pass'); assert.equal(e.data.criterion, 'T-AC01'); assert.equal(e.data.head, sh(r, 'rev-parse', 'HEAD'));
  assert.ok(g.stdout.includes(`PASS  T-AC01 [command] ${from}`), g.stdout);
  const md = report(r);
  const reused = md.split('## Reused results')[1]?.split('\n## ')[0] || '';
  assert.ok(reused.includes(`- T-AC01 [command]: ${from}`), md);
  const gate = readLog(r).filter((x) => x.type === 'gate').at(-1);
  assert.deepEqual(gate.data.reused, [`T-AC01: ${from}`]);
  const files = cacheFiles(r); assert.equal(files.length, 1);
  const c = JSON.parse(fs.readFileSync(path.join(r, '.proofline', 'cache', files[0]), 'utf8'));
  assert.equal(files[0], `${c.key}.json`); assert.match(c.key, /^[0-9a-f]{64}$/);
  assert.equal(c.status, 'pass'); assert.equal(c.ts, e.ts); assert.equal(c.entry, e.seq); assert.equal(c.entry_hash, e.hash);
  assert.equal(c.evidence.exit, 0); assert.equal(typeof c.evidence.ms, 'number'); assert.ok(c.evidence.counts);
  const j = JSON.parse(fs.readFileSync(path.join(r, '.proofline', 'reports', 'T-latest.json'), 'utf8'));
  assert.deepEqual(j.reused, [{ id: 'T-AC01', type: 'command', ts: e.ts, entry: e.seq }]);
});

test('a dirty tree reruns the command; a clean tree again reuses the clean PASS', () => {
  const { r, runs } = counterRepo();
  primed(r, runs);
  write(r, { 'src/new.mjs': 'export const x = 1;\n' });
  ok(cli(r, ['gate', 'T'])); assert.equal(runs(), 2, 'an untracked file');
  assert.match(report(r), /## Reused results\n\n- none\n/);
  fs.rmSync(path.join(r, 'src'), { recursive: true });
  write(r, { 'package.json': '{ "type": "module", "x": 1 }\n' });
  ok(cli(r, ['gate', 'T'])); assert.equal(runs(), 3, 'an uncommitted edit of a tracked file');
  assert.equal(results(r).length, 1, 'a run on a dirty tree is not stored');
  sh(r, 'checkout', '--', 'package.json');
  ok(cli(r, ['gate', 'T'])); assert.equal(runs(), 3, 'clean again: the PASS on this HEAD is reused');
});

test('a new commit reruns the command', () => {
  const { r, runs } = counterRepo();
  primed(r, runs);
  write(r, { 'src/new.mjs': 'export const x = 1;\n' }); commitAll(r, 'next');
  ok(cli(r, ['gate', 'T'])); assert.equal(runs(), 2);
  ok(cli(r, ['gate', 'T'])); assert.equal(runs(), 2, 'the new HEAD has its own PASS');
});

test('--fresh reruns the command and stores the new PASS', () => {
  const { r, runs } = counterRepo();
  primed(r, runs);
  ok(cli(r, ['gate', 'T', '--fresh'])); assert.equal(runs(), 2);
  assert.match(report(r), /## Reused results[^#]*- none \(--fresh\)/);
  ok(cli(r, ['verify', '--fresh', 'T'])); assert.equal(runs(), 3, '--fresh before the task id');
  ok(cli(r, ['gate', 'T'])); assert.equal(runs(), 3);
  assert.match(report(r), new RegExp(`reused from ${results(r).at(-1).ts.replace(/\./g, '\\.')}`), 'the newest PASS is the one reused');
  const mcp = (name, args) => handle(r, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { task: 'T', ...args } } }).result;
  for (const name of ['verify', 'gate']) {
    const before = runs();
    let m = mcp(name, { fresh: true }); assert.equal(m.isError, false); assert.match(m.content[0].text, /DECISION: PASS/);
    assert.equal(runs(), before + 1, `MCP ${name} with fresh: true`);
    m = mcp(name, {}); assert.match(m.content[0].text, /DECISION: PASS/);
    assert.equal(runs(), before + 1, `MCP ${name} without fresh reuses`);
  }
});

test('only command and metric results are reused: a docs check on the same commit runs every time', () => {
  const r = repo();
  const at = (n) => path.join(path.dirname(r), n);
  const c = P.C.load(r); c.defaults.reuse_results = true; P.C.save(r, c);
  addTask(r, { id: 'T', title: 't', criteria: [
    { verifier: { type: 'command', cmd: `echo run >> '${at('cmd')}'` } },
    { verifier: { type: 'docs', cmd: `echo run >> '${at('docs')}'`, paths: ['package.json'] } }] });
  commitAll(r, 'task'); P.taskNext(r);
  const runs = (n) => fs.readFileSync(at(n), 'utf8').split('\n').filter(Boolean).length;
  ok(cli(r, ['verify', 'T'])); ok(cli(r, ['gate', 'T']));
  assert.equal(runs('cmd'), 1); assert.equal(runs('docs'), 2);
  assert.deepEqual(results(r).map((e) => e.data.criterion), ['T-AC01']);
  const j = JSON.parse(fs.readFileSync(path.join(r, '.proofline', 'reports', 'T-latest.json'), 'utf8'));
  assert.deepEqual(j.reused.map((x) => x.id), ['T-AC01']);
});

test('a FAIL is not cached: it runs every time, and the first PASS after it is', () => {
  const { r, runs, dir } = counterRepo({ cmd: (count) => `echo run >> '${count}'; test ! -f '${path.join(path.dirname(count), 'red')}'`, defaults: { flaky_reruns: 0 } });
  fs.writeFileSync(path.join(dir, 'red'), '');
  ok(cli(r, ['verify', 'T']), 1); assert.equal(runs(), 1);
  ok(cli(r, ['gate', 'T']), 1); assert.equal(runs(), 2);
  assert.deepEqual(cacheFiles(r), []); assert.deepEqual(results(r), []);
  fs.rmSync(path.join(dir, 'red'));
  ok(cli(r, ['verify', 'T'])); assert.equal(runs(), 3);
  ok(cli(r, ['gate', 'T'])); assert.equal(runs(), 3);
});

test('reuse off (false or left out): the command runs every time and nothing is stored', () => {
  for (const reuse of [false, null]) {
    const { r, runs } = counterRepo({ reuse });
    ok(cli(r, ['verify', 'T'])); ok(cli(r, ['gate', 'T'])); ok(cli(r, ['gate', 'T']));
    assert.equal(runs(), 3, `reuse_results ${reuse}`);
    assert.deepEqual(cacheFiles(r), []); assert.deepEqual(results(r), []);
    assert.match(report(r), /## Reused results\n\n- none \(defaults\.reuse_results is off\)/);
  }
});

test('a tampered evidence log reruns the command', () => {
  // The entry that recorded the PASS is edited: the chain breaks, the command reruns and the gate is BLOCKED.
  const a = counterRepo();
  primed(a.r, a.runs);
  const f = logPath(a.r);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/"detail":"exit 0 in \d+ ms"/, '"detail":"exit 0 in 1 ms"'));
  ok(cli(a.r, ['gate', 'T']), 2); assert.equal(a.runs(), 2);
  assert.match(report(a.r), /evidence log tampered/);
  // The entry is cut from the end of the log: the chain is intact, but the entry is gone, so the command reruns.
  const b = counterRepo();
  primed(b.r, b.runs);
  const seq = results(b.r)[0].seq;
  const g = logPath(b.r);
  fs.writeFileSync(g, fs.readFileSync(g, 'utf8').split('\n').slice(0, seq).join('\n') + '\n');
  ok(cli(b.r, ['evidence', 'verify']));
  ok(cli(b.r, ['gate', 'T'])); assert.equal(b.runs(), 2);
  // The cache file names another hash for its entry: the command reruns.
  const c = counterRepo();
  primed(c.r, c.runs);
  const [cf] = cacheFiles(c.r); const p = path.join(c.r, '.proofline', 'cache', cf);
  const body = JSON.parse(fs.readFileSync(p, 'utf8')); body.entry_hash = '0'.repeat(64); fs.writeFileSync(p, JSON.stringify(body));
  ok(cli(c.r, ['gate', 'T'])); assert.equal(c.runs(), 2);
});

test('a change of an env var the command names reruns it', () => {
  const { r, runs } = counterRepo({ cmd: (count) => `echo "run \${PL_CACHE_MODE:-none}" >> '${count}'` });
  primed(r, runs, { PL_CACHE_MODE: 'a' });
  ok(cli(r, ['gate', 'T'], { PL_CACHE_MODE: 'b' })); assert.equal(runs(), 2);
  ok(cli(r, ['gate', 'T'], { PL_CACHE_MODE: 'b' })); assert.equal(runs(), 2);
  ok(cli(r, ['gate', 'T'])); assert.equal(runs(), 3, 'unset');
  ok(cli(r, ['gate', 'T'], { PL_CACHE_MODE: 'a' })); assert.equal(runs(), 3, 'back to a: its PASS is reused');
  ok(cli(r, ['gate', 'T'], { PL_CACHE_UNNAMED: 'x', PL_CACHE_MODE: 'a' })); assert.equal(runs(), 3, 'a var the command does not name');
});

test('a PASS older than defaults.reuse_max_age_h runs again', () => {
  const { r, runs } = counterRepo({ defaults: { reuse_max_age_h: 1e-9 } });
  ok(cli(r, ['verify', 'T'])); ok(cli(r, ['gate', 'T']));
  assert.equal(runs(), 2); assert.equal(results(r).length, 2, 'each fresh PASS is recorded');
});

test('a metric PASS is reused with its measured value, and only within max_load_per_cpu', async () => {
  const r = repo();
  const count = path.join(path.dirname(r), 'count');
  write(r, { 'bench/b.mjs': `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(count)}, 'run\\n'); console.log(JSON.stringify({ flushMs: 1200 }));\n` });
  const c = P.C.load(r); c.defaults.reuse_results = true; P.C.save(r, c);
  addTask(r, { id: 'M', title: 'm', criteria: [{ verifier: { type: 'metric', cmd: 'node bench/b.mjs', key: 'flushMs', op: '<', value: 2000 } }] });
  commitAll(r, 'task'); P.taskNext(r);
  const runs = () => fs.readFileSync(count, 'utf8').split('\n').filter(Boolean).length;
  const machine = () => ({ load1: 3, cpus: 4 });
  assert.equal(P.E.verifyTask(r, 'M', { machine }).decision, 'PASS'); assert.equal(runs(), 1);
  const g = P.E.gate(r, 'M', { machine, claims: `M | done | ${sh(r, 'rev-parse', 'HEAD')} | bench/b.mjs | flushMs=1200 | -` });
  assert.equal(g.decision, 'PASS', g.failing.join('\n')); assert.equal(runs(), 1);
  assert.equal(g.measured.flushMs, 1200); assert.match(g.results[0].detail, /^reused from .*flushMs = 1200 < 2000 \(load 3\.00 \/ 4 CPUs/);
  const { lookup } = await import('../src/cache.mjs');
  const key = fs.readdirSync(path.join(r, '.proofline', 'cache'))[0].replace(/\.json$/, '');
  assert.equal(lookup(r, key, { maxLoad: 1 })?.data.evidence.machine.load_per_cpu, 0.75);
  assert.equal(lookup(r, key, { maxLoad: 0.5 }), null, 'recorded at 0.75 per CPU, over a limit of 0.5');
  assert.equal(lookup(r, key, {})?.type, 'result');
});

test('reuse_results and reuse_max_age_h are validated, and turning reuse on or off is not a weakening', () => {
  const a = P.C.skeleton('p'); a.defaults.reuse_results = 'yes'; a.defaults.reuse_max_age_h = 0;
  const errs = P.C.validate(a).join('\n');
  assert.match(errs, /defaults\.reuse_results must be true or false/);
  assert.match(errs, /defaults\.reuse_max_age_h must be a positive number of hours/);
  const off = P.C.skeleton('p'); off.defaults.reuse_results = false;
  const on = structuredClone(off); on.defaults.reuse_results = true; on.defaults.reuse_max_age_h = 48;
  assert.deepEqual(P.C.validate(on), []);
  assert.deepEqual(P.C.weakenings(off, on), []); assert.deepEqual(P.C.weakenings(on, off), []);
});
