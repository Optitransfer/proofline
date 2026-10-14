#!/usr/bin/env node
// Demo: an agent claims "done" with no evidence → FAIL. Then it does the work properly → PASS.
// Creates a throwaway git repo + bare "origin" under the OS temp dir. Usage: node examples/demo/demo.mjs [--quiet]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as P from '../../src/index.mjs';

const quiet = process.argv.includes('--quiet');
const log = (...a) => { if (!quiet) console.log(...a); };
export function sh(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

export function makeDemo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proofline-demo-'));
  const origin = path.join(tmp, 'origin.git'); const repo = path.join(tmp, 'repo');
  sh(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(tmp, 'clone', '-q', origin, repo);
  sh(repo, 'config', 'user.email', 'demo@proofline.local'); sh(repo, 'config', 'user.name', 'demo'); sh(repo, 'checkout', '-q', '-b', 'main');
  const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), s); };
  w('package.json', '{ "type": "module" }\n');
  w('src/app.mjs', "import { save } from './store.mjs';\nexport function handle(note) { return save(note); }\n");
  w('src/store.mjs', "export function save(note) { return { ok: true, durable: false, note }; }\n");
  w('src/receipt.mjs', '// built, but not yet wired into the default path\nexport function durableReceipt(note) { return { ok: true, durable: true, note }; }\n');
  w('test/app.test.mjs', "import test from 'node:test'; import assert from 'node:assert';\nimport { handle } from '../src/app.mjs';\ntest('handle returns ok', () => { assert.equal(handle('x').ok, true); });\n");
  P.init(repo, { project: 'demo' });
  const c = P.C.load(repo);
  c.defaults.base = 'origin/main';
  c.tasks.push(P.C.makeTask({
    id: 'DEMO-01', title: 'Saves return a durable receipt on the default path', phase: 'implement', requirements: ['REQ-DUR-1'],
    description: 'handle() must return durable:true via durableReceipt(), wired into the default path.',
    scope: ['src/**', 'test/**'],
    criteria: [
      { statement: 'A test proves saves are durable (fails before, passes after)', verifier: { type: 'test_red_green', test_file: 'test/durable.test.mjs', test_name: 'save is durable', cmd: 'node --test {test}' } },
      { statement: 'durableReceipt is reachable from the default entry point', verifier: { type: 'wiring', entry: 'src/app.mjs', symbol: 'durableReceipt' } },
      { statement: 'Full suite green, nothing skipped or hung', verifier: { type: 'command', cmd: 'node --test', max_skipped: 0 } },
      { statement: 'Only src/ and test/ change', verifier: { type: 'scope' } },
      { statement: 'Committed and pushed to main', verifier: { type: 'pushed' } },
    ],
  }));
  P.C.save(repo, c);
  sh(repo, 'add', '-A'); sh(repo, 'commit', '-q', '--no-verify', '-m', 'baseline'); // bootstrap commit before any task is active
  sh(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
}

export function runDemo() {
  const { tmp, repo } = makeDemo();
  const n = P.taskNext(repo);
  log('== task_next →', n.task); log(n.brief.split('\n').slice(0, 4).join('\n'), '\n…');

  // Act 1: the agent wires nothing, writes no test, and claims done.
  const claim1 = 'DEMO-01 | done | - | - | should work | -';
  const g1 = P.E.gate(repo, 'DEMO-01', { claims: claim1 });
  log('\n== Act 1: claimed done with no evidence →', g1.decision); log(g1.corrective_prompt);

  // Act 2: test first, wire it in, commit, push (hooks on), then report honestly.
  fs.writeFileSync(path.join(repo, 'test/durable.test.mjs'), "import test from 'node:test'; import assert from 'node:assert';\nimport { handle } from '../src/app.mjs';\ntest('save is durable', () => { assert.equal(handle('x').durable, true); });\n");
  fs.writeFileSync(path.join(repo, 'src/app.mjs'), "import { durableReceipt } from './receipt.mjs';\nexport function handle(note) { return durableReceipt(note); }\n");
  sh(repo, 'add', '-A'); sh(repo, 'commit', '-q', '-m', 'DEMO-01: durable receipt on the default path');
  sh(repo, 'push', '-q', 'origin', 'main');
  const head = sh(repo, 'rev-parse', '--short', 'HEAD');
  const claim2 = `DEMO-01 | done | ${head} | save is durable, test/durable.test.mjs | - | -`;
  const g2 = P.E.gate(repo, 'DEMO-01', { claims: claim2 });
  log('\n== Act 2: test-first, wired, pushed →', g2.decision); log(g2.results.map((r) => `  ${r.status} ${r.id} ${r.detail.split('\n')[0]}`).join('\n'));
  log('\nreport:', g2.report);
  return { tmp, repo, g1, g2 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runDemo();
  process.exitCode = r.g1.decision === 'FAIL' && r.g2.decision === 'PASS' ? 0 : 1;
  log(`\nDemo ${process.exitCode === 0 ? 'OK: FAIL then PASS' : 'UNEXPECTED'}  (repo: ${r.repo})`);
}
