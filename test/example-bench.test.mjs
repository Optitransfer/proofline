import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import * as L from '../examples/hivevault-fastpath/bench/lib.mjs';

const EX = path.resolve(import.meta.dirname, '../examples/hivevault-fastpath');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A stand-in vault: a git repo plus an HTTP server whose flush answers at once and commits `commitAfterMs` later. */
async function stubVault({ commitAfterMs, paths, commitPaths = paths }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-vault-'));
  git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'empty vault');
  const bodies = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      bodies.push(JSON.parse(b || '{}'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
      if (commitAfterMs !== null) setTimeout(() => {
        for (const p of commitPaths) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), `# ${p}\n`); }
        git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'batch');
      }, commitAfterMs);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const v = { root, admin: 'token', base: `http://127.0.0.1:${server.address().port}` };
  return { v, bodies, close: () => new Promise((r) => server.close(r)) };
}
const PATHS = ['work/p/n0.md', 'work/p/n1.md', 'work/p/n2.md'];

test('flushMs runs to the commit that holds the batch; the answer time is flushAnswerMs', async () => {
  const s = await stubVault({ commitAfterMs: 400, paths: PATHS });
  try {
    const f = await L.flushToCommit(s.v, PATHS, { timeoutMs: 10000, pollMs: 10 });
    assert.deepEqual(s.bodies, [{ flush: true, wait: 'sealed' }]);
    assert.equal(f.flushStatus, 200);
    assert.ok(f.flushAnswerMs < 300, `answer ${f.flushAnswerMs} ms`);
    assert.ok(f.flushMs >= 400, `flushMs ${f.flushMs} must include the late commit`);
    assert.equal(f.flushCommitted, 1);
    assert.equal(f.flushCommit, git(s.v.root, 'rev-parse', 'HEAD'));
  } finally { await s.close(); }
});

test('a flush whose commit never holds the whole batch records a failure, not a number', async () => {
  for (const [commitAfterMs, commitPaths, re] of [[null, PATHS, /0 of 3/], [50, PATHS.slice(0, 2), /2 of 3/]]) {
    const s = await stubVault({ commitAfterMs, paths: PATHS, commitPaths });
    try {
      const f = await L.flushToCommit(s.v, PATHS, { timeoutMs: 700, pollMs: 10 });
      assert.equal(f.flushCommitted, 0);
      assert.equal('flushMs' in f, false);
      assert.match(f.flushErr, /no commit held all 3 paths within 700 ms/); assert.match(f.flushErr, re);
    } finally { await s.close(); }
  }
});

test('the e2e bench times the flush with flushToCommit', () => {
  const src = fs.readFileSync(path.join(EX, 'bench/e2e.mjs'), 'utf8');
  assert.match(src, /L\.flushToCommit\(v,/);
  assert.doesNotMatch(src, /\{body:\{flush:true\}\}/);
});

test('FP-01 checks that the flush commit exists, at 4k and 10k, and gen.mjs matches the contract', () => {
  const c = JSON.parse(fs.readFileSync(path.join(EX, 'proofline.json'), 'utf8'));
  const fp1 = c.tasks.find((t) => t.id === 'FP-01');
  const commits = fp1.criteria.filter((a) => a.verifier.key === 'flushCommitted');
  assert.deepEqual(commits.map((a) => [a.verifier.name, a.verifier.op, a.verifier.value]), [['4k.flushCommitted', '==', 1], ['10k.flushCommitted', '==', 1]]);
  assert.deepEqual(fp1.criteria.slice(0, 6).map((a) => a.id), ['FP-01-AC01', 'FP-01-AC02', 'FP-01-AC03', 'FP-01-AC04', 'FP-01-AC05', 'FP-01-AC06'], 'existing criterion ids keep their numbers');
  const gen = execFileSync(process.execPath, ['gen.mjs'], { cwd: EX, encoding: 'utf8' });
  assert.equal(gen, fs.readFileSync(path.join(EX, 'proofline.json'), 'utf8'));
});

test('every example task allows CHANGELOG.md and docs/MAP.md, and nothing else is widened', () => {
  const c = JSON.parse(fs.readFileSync(path.join(EX, 'proofline.json'), 'utf8'));
  const S = ['server/src/**', 'server/test/**', 'docs/**', 'bench/**'];
  const before = { 'FP-00': ['bench/**'], 'FP-09': ['server/package.json', 'package.json', 'server/test/**', 'scripts/**'], 'FP-10': ['server/test/**'] };
  for (const t of c.tasks) {
    const want = [...(before[t.id] || S), 'CHANGELOG.md', 'docs/MAP.md'];
    assert.deepEqual(t.scope.allow, want, `${t.id} scope.allow`);
    for (const a of t.criteria.filter((x) => x.verifier.type === 'scope')) assert.deepEqual(a.verifier.allow, want, `${a.id} allow`);
  }
});

test('the bench writers send WAIT as the wait of each PUT, and the output records it', () => {
  const lib = path.join(EX, 'bench/lib.mjs');
  const body = (env) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(lib)}).then((L) => console.log(JSON.stringify(L.putBody('x'))))`], { encoding: 'utf8', env: { ...process.env, ...env } }));
  assert.deepEqual(body({ WAIT: 'durable' }), { body: 'x', wait: 'durable' });
  assert.deepEqual(body({ WAIT: '' }), { body: 'x' });
  const src = fs.readFileSync(path.join(EX, 'bench/e2e.mjs'), 'utf8');
  assert.match(src, /L\.http\(v,'PUT',`\/v1\/notes\/work\/c\/w\$\{Wn\}-\$\{w\}-\$\{k\}\.md`,\{body:L\.putBody\(/);
  assert.match(src, /wait:process\.env\.WAIT\|\|null/);
});
