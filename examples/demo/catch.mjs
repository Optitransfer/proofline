#!/usr/bin/env node
// Demo: five ways an agent "finishes" a task without doing it, each caught; then the real work, which passes.
// A throwaway git repository with a bare origin is created under the OS temp dir. Usage: node examples/demo/catch.mjs [--quiet]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as P from '../../src/index.mjs';

const quiet = process.argv.includes('--quiet');
const out = [];
const log = (s = '') => { out.push(s); if (!quiet) console.log(s); };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proofline-catch-'));
  const origin = path.join(tmp, 'origin.git'); const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'demo@proofline.local'); git(repo, 'config', 'user.name', 'demo'); git(repo, 'checkout', '-q', '-b', 'main');
  const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), s); };
  w('package.json', '{ "type": "module", "scripts": { "test": "node --test" } }\n');
  w('README.md', '# notes\n');
  w('src/app.mjs', "import { save } from './store.mjs';\nexport function handle(note) { return save(note); }\n");
  w('src/store.mjs', "export function save(note) { return { ok: true, durable: false, note }; }\n");
  w('src/receipt.mjs', '// built, not yet wired into the default path\nexport function durableReceipt(note) { return { ok: true, durable: true, note }; }\n');
  w('test/app.test.mjs', "import test from 'node:test'; import assert from 'node:assert';\nimport { handle } from '../src/app.mjs';\ntest('handle returns ok', { timeout: 2000 }, () => { assert.equal(handle('x').ok, true); });\n");
  P.init(repo, { project: 'catch' });
  const c = P.C.load(repo);
  c.defaults.base = 'origin/main';
  c.tasks.push(P.C.makeTask({
    id: 'TASK-1', title: 'Saves return a durable receipt on the default path', phase: 'implement',
    description: 'handle() returns durable:true through durableReceipt(), wired into the default path.',
    scope: ['src/**', 'test/**'],
    criteria: [
      { statement: 'a test proves saves are durable: it fails on the base and passes now', verifier: { type: 'test_red_green', test_file: 'test/durable.test.mjs', test_name: 'save is durable', cmd: 'node --test {test}' } },
      { statement: 'durableReceipt is reached from the default entry point', verifier: { type: 'wiring', entry: 'src/app.mjs', symbol: 'durableReceipt' } },
      { statement: 'the suite is green, nothing skipped', verifier: { type: 'command', cmd: 'node --test', max_skipped: 0 } },
      { statement: 'only src/ and test/ change', verifier: { type: 'scope' } },
      { statement: 'committed and pushed to main', verifier: { type: 'pushed' } },
    ],
  }));
  P.C.save(repo, c);
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '--no-verify', '-m', 'baseline'); // the bootstrap commit, before any task is active
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
}

const first = (s) => String(s || '').split('\n')[0];
const failing = (g) => g.results.filter((r) => r.status !== 'pass').map((r) => `  ${r.id} ${r.status.toUpperCase().padEnd(5)} ${first(r.detail)}`);
const claimIssues = (g) => (g.claims || []).flatMap((c) => c.issues || []).map((i) => `  claim rejected: ${first(i)}`);
const forbidden = (g) => (g.forbidden || []).map((f) => `  forbidden: ${f.rule} in ${f.file}: ${first(f.line)}`);
const reset = (repo) => { git(repo, 'checkout', '-q', '--', '.'); git(repo, 'clean', '-qfd', '--', 'src', 'test', 'README.md'); };
const write = (repo, f, s) => fs.writeFileSync(path.join(repo, f), s);
const read = (repo, f) => fs.readFileSync(path.join(repo, f), 'utf8');

export function runCatch() {
  const { tmp, repo } = makeRepo();
  const n = P.taskNext(repo);
  log(`proofline next -> ${n.task}: ${P.C.load(repo).tasks.find((t) => t.id === n.task).title}`);
  const acts = [];

  // 1. The lie: nothing done, "done" reported with a made-up commit and a test that exists but proves nothing new.
  const g1 = P.E.gate(repo, 'TASK-1', { claims: 'TASK-1 | done | abc1234 | app.test.mjs | - | -' });
  log(`\n1. The lie: no work, reported "done | abc1234 | app.test.mjs"   -> ${g1.decision}`);
  for (const l of [...claimIssues(g1).slice(0, 3), ...failing(g1).slice(0, 2)]) log(l);
  acts.push(g1.decision);

  // 2. The gap: a test that passes on the base too, so it proves nothing about the change.
  write(repo, 'test/durable.test.mjs', "import test from 'node:test'; import assert from 'node:assert';\nimport { handle } from '../src/app.mjs';\ntest('save is durable', () => { assert.equal(handle('x').ok, true); });\n");
  const g2 = P.E.gate(repo, 'TASK-1');
  log(`\n2. The gap: a "durable" test that asserts what already held   -> ${g2.decision}`);
  for (const l of failing(g2).filter((l) => /AC01/.test(l))) log(l);
  acts.push(g2.decision);
  reset(repo);

  // 3. The shortcut: skip the test that would fail and raise a timeout.
  write(repo, 'test/app.test.mjs', read(repo, 'test/app.test.mjs').replace("test('handle returns ok', { timeout: 2000 }", "test.skip('handle returns ok', { timeout: 20000 }"));
  const g3 = P.E.gate(repo, 'TASK-1');
  log(`\n3. The shortcut: test.skip and a timeout raised 2000 -> 20000   -> ${g3.decision}`);
  for (const l of [...forbidden(g3), ...failing(g3).filter((l) => /AC03/.test(l))]) log(l);
  acts.push(g3.decision);
  reset(repo);

  // 4. The stray change: a file the task may not touch.
  write(repo, 'README.md', '# notes\n\nrewritten while nobody was looking\n');
  const g4 = P.E.gate(repo, 'TASK-1');
  log(`\n4. The stray change: README.md edited, outside the task's scope   -> ${g4.decision}`);
  for (const l of failing(g4).filter((l) => /AC04/.test(l))) log(l);
  acts.push(g4.decision);
  reset(repo);

  // 5. The weakening: the agent edits the contract so the checks get easier, and tries to commit it.
  const c = P.C.load(repo); const t = c.tasks.find((x) => x.id === 'TASK-1');
  t.criteria[2].verifier = { type: 'command', cmd: 'true' }; // "the suite is green" becomes a no-op
  P.C.save(repo, c);
  let refused = '';
  try { git(repo, 'add', 'proofline.json'); git(repo, 'commit', '-q', '-m', 'relax the suite check'); } catch (e) { refused = String(e.stderr || e.message); }
  log(`\n5. The weakening: proofline.json edited so "suite green" runs \`true\`, then git commit   -> ${refused ? 'REFUSED by the pre-commit hook' : 'COMMITTED'}`);
  for (const l of refused.split('\n').filter((l) => /weaken|marker|approval/i.test(l)).slice(0, 2)) log(`  ${l.trim()}`);
  acts.push(refused ? 'REFUSED' : 'COMMITTED');
  git(repo, 'reset', '-q', 'HEAD', '--', 'proofline.json'); git(repo, 'checkout', '-q', '--', 'proofline.json');

  // 6. The work: a test that fails on the base, the fix on the default path, a commit through the hooks, a push, an honest report.
  write(repo, 'test/durable.test.mjs', "import test from 'node:test'; import assert from 'node:assert';\nimport { handle } from '../src/app.mjs';\ntest('save is durable', () => { assert.equal(handle('x').durable, true); });\n");
  write(repo, 'src/app.mjs', "import { durableReceipt } from './receipt.mjs';\nexport function handle(note) { return durableReceipt(note); }\n");
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'TASK-1: durable receipt on the default path'); git(repo, 'push', '-q', 'origin', 'main');
  const head = git(repo, 'rev-parse', '--short', 'HEAD');
  const g6 = P.E.gate(repo, 'TASK-1', { claims: `TASK-1 | done | ${head} | save is durable, test/durable.test.mjs | - | -` });
  log(`\n6. The work: failing test first, durableReceipt wired in, committed through the hooks, pushed   -> ${g6.decision}`);
  for (const r of g6.results) log(`  ${r.id} ${r.status.toUpperCase().padEnd(5)} ${first(r.detail)}`);
  log(`  claim accepted: "${`TASK-1 | done | ${head} | save is durable, test/durable.test.mjs | - | -`}"`);
  log(`  evidence: ${g6.evidence_seq} entries in the hash-chained log; report ${path.relative(repo, g6.report)}`);
  acts.push(g6.decision);

  const ok = acts.slice(0, 4).every((d) => d === 'FAIL') && acts[4] === 'REFUSED' && acts[5] === 'PASS';
  log(`\n${ok ? 'Caught five, passed one.' : 'UNEXPECTED: ' + acts.join(', ')}  (repository: ${repo})`);
  return { tmp, repo, acts, ok, transcript: out.join('\n') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runCatch();
  process.exitCode = r.ok ? 0 : 1;
}
