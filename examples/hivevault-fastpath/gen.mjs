// Generates proofline.json for hivevault from GROK-INSTRUCTIONS-fastpath (base 622a7cc). Run: node gen.mjs > proofline.json
import * as C from '../../src/contract.mjs';
const B4 = 'WAIT=durable HV_REPO=$PWD BENCH_DIR=/tmp/hvbench node bench/e2e.mjs 4000 47710';
const B10 = 'WAIT=durable HV_REPO=$PWD BENCH_DIR=/tmp/hvbench node bench/e2e.mjs 10000 47711';
const T = 'node --test {test}';
const SUITE = { type: 'command', cmd: 'cd server && node --test --test-concurrency=8 "test/*.test.mjs"', timeout_s: 1800, min_tests: 1088 };
const m = (cmd, n, key, op, value, labels = []) => ({ statement: `${key} ${op} ${value} at ${n}`, verifier: { type: 'metric', cmd, key, op, value, name: `${n}.${key}`, labels, timeout_s: 3600 } });
// The bench reports flushCommitted 1 only when the vault's HEAD commit holds every note of the batch, bytes included.
const committed = (cmd, n) => ({ ...m(cmd, n, 'flushCommitted', '==', 1), statement: `The flush's commit exists at ${n}: HEAD holds every note of the batch, bytes included` });
const rg = (file, name, statement) => ({ statement, verifier: { type: 'test_red_green', test_file: file, test_name: name, cmd: T } });
const common = (scope) => [
  { statement: 'Full parallel suite exits 0, nothing hung (≥ 1,088 tests: none deleted)', verifier: SUITE },
  { statement: 'Changes stay in scope', verifier: { type: 'scope', allow: scope } },
  { statement: 'Committed and pushed to main', verifier: { type: 'pushed' } },
];
const S = ['server/src/**', 'server/test/**', 'docs/**', 'bench/**'];
const c = C.skeleton('hivevault');
c.defaults.base = 'origin/main';
c.forbidden.protected_values = [
  { file: 'bench/e2e.mjs', pattern: 'Wn===1\\?(\\d+)', why: 'single-writer sample count must not shrink' },
  { file: 'bench/e2e.mjs', pattern: 'Math\\.ceil\\((\\d+)/Wn\\)', why: 'concurrent sample count must not shrink' },
];
c.baseline.metrics = { '4k.flushMs': 14400, '4k.writers1.p50': 128, '4k.writers32.savesPerSec': 9, '10k.flushMs': 45000, '10k.writers1.p50': 204, '10k.writers32.savesPerSec': 5 };
c.ci = { tasks: [] };
c.tasks = [
  C.makeTask({ id: 'FP-00', title: 'Bench rig committed in the repo', phase: 'plan', description: 'Copy the bench kit into bench/ and commit it, so every metric gate can be reproduced from a clean checkout (lesson: the rig lived only on one machine).', scope: ['bench/**'], criteria: [
    { statement: 'bench/e2e.mjs committed', verifier: { type: 'file_exists', path: 'bench/e2e.mjs' } },
    { statement: 'bench/lib.mjs committed', verifier: { type: 'file_exists', path: 'bench/lib.mjs' } },
    { statement: 'bench/hvtrace.mjs committed', verifier: { type: 'file_exists', path: 'bench/hvtrace.mjs' } },
    { statement: 'Committed and pushed', verifier: { type: 'pushed' } }] }),
  C.makeTask({ id: 'FP-01', title: 'Git commit without one process per file', depends_on: ['FP-00'], requirements: ['#407'],
    description: 'server/src/sync.mjs _fastImport: replace the per-file `git cat-file blob :path` loop with one `git ls-files -s -z` per batch; emit `M <mode> <blob-id> <path>`.',
    scope: S, criteria: [rg('server/test/fastimport_spawns.test.mjs', null, '200-file batch uses ≤ 3 _gitInput calls; git fsck exit 0; all 200 files correct'),
      m(B4, '4k', 'flushMs', '<=', 1500, ['seal', 'flush']), m(B10, '10k', 'flushMs', '<=', 4000, ['seal', 'flush']), ...common(S),
      committed(B4, '4k'), committed(B10, '10k')] }),
  C.makeTask({ id: 'FP-02', title: 'Durable writes do not save the index on the ack path', depends_on: ['FP-01'], requirements: ['#409'],
    description: "core.mjs _indexStep(paths, warnings, removed, { defer }): indexOne then a 50 ms debounced index.save() via _bg(); drain() flushes it.",
    scope: S, criteria: [rg('server/test/index_deferred.test.mjs', null, 'write resolves within 1 s with save stubbed to hang; 10 writes → 1 save after drain; search finds the note'), ...common(S)] }),
  C.makeTask({ id: 'FP-03', title: 'Durable writes do not await audit, commit or graph', depends_on: ['FP-02'], requirements: ['#409'],
    description: 'core.mjs write(): durable path runs _auditStep, _settleCommit and _graphAfter through _bg() without awaiting. Sealed path unchanged.',
    scope: S, criteria: [rg('server/test/durable_ack_path.test.mjs', null, 'durable write < 100 ms with audit/commit/graph stubbed at 500 ms; audit entry + git trailer present after drain'), ...common(S)] }),
  C.makeTask({ id: 'FP-04', title: 'One seal batch for many durable writes', depends_on: ['FP-03'], requirements: ['#407', '#442'],
    description: 'core.mjs _sealLater queues into _sealQ; one _sealDrain loop runs _sealOnce per batch. Update receipt_durable.test.mjs:146 to assert the OUTCOME (no loose entry; outside edit survives restart), not one job per write.',
    scope: S, criteria: [rg('server/test/seal_batch.test.mjs', null, '32 concurrent durable writes → ≤ 3 _sealNoted calls'),
      { statement: 'receipt_durable test passes', verifier: { type: 'command', cmd: 'node --test server/test/receipt_durable.test.mjs' } }, ...common(S)] }),
  C.makeTask({ id: 'FP-05', title: 'No O(N) work per write', depends_on: ['FP-04'], requirements: ['FI-05'],
    description: 'A: _receipt skips stateDigest for unsealed durable writes (document it). B: _caseClash uses an incremental fold index, not a per-write rebuild.',
    scope: S, criteria: [rg('server/test/write_flat_cost.test.mjs', null, 'p50 at 10k ≤ 1.3 × p50 at 1k'),
      { statement: 'stateDigest not called on the durable ack path', verifier: { type: 'grep', file: 'server/src/core.mjs', pattern: 'sealed === false', why: 'the durable receipt must skip the O(N) digest' } }, ...common(S)] }),
  C.makeTask({ id: 'FP-06', title: 'Fix the regressions: lock after stop, config docs, #294 #291 #301', depends_on: ['FP-05'], requirements: ['#31', '#365', '#294', '#291', '#301'],
    description: 'drain() waits for _sealRun, _idxTimer and every _bg job before flushDone; refuse new background jobs once stopping. Root-cause each failure with file:line.',
    scope: S, criteria: [
      { statement: 'cli_lifecycle passes unchanged', verifier: { type: 'command', cmd: 'node --test server/test/cli_lifecycle.test.mjs' } },
      { statement: 'Config docs regenerated', verifier: { type: 'docs', cmd: 'node scripts/gen-config-docs.mjs', paths: ['docs'] } }, ...common(S)] }),
  C.makeTask({ id: 'FP-07', title: 'The gate that reaches the target: in-process locks + daemon lease', depends_on: ['FP-06'], requirements: ['FI-05'],
    description: 'Take note and op-log locks in-process (Map of promise chains); hold the cross-process lock dir once as a daemon lease; skip _absorbDisk when log size+inode unchanged.',
    scope: S, stop_rules: ['If any number misses: STOP and report the per-stage trace of one PUT (lock / store.write / index / op log + fsync / unlock / http) from NODE_OPTIONS="--import ./bench/hvtrace.mjs". Do not start FP-08.'],
    criteria: [rg('server/test/lock_lease.test.mjs', null, '0 lock dirs during 32 in-process writes; a second process is refused or blocked, the op chain verifies'),
      m(B4, '4k', 'writers1.p50', '<=', 20, ['p50', 'durable p50']), m(B4, '4k', 'writers32.savesPerSec', '>=', 500, ['saves/s', '32 writers']), m(B4, '4k', 'writers32.max', '<=', 100, ['max']),
      m(B10, '10k', 'writers1.p50', '<=', 20, ['p50']), m(B10, '10k', 'writers32.savesPerSec', '>=', 500, ['saves/s']), m(B10, '10k', 'writers32.max', '<=', 100, ['max']),
      m(B4, '4k', 'flushMs', '<', 2000, ['seal']), ...common(S)] }),
  C.makeTask({ id: 'FP-08', title: 'Flip the default to durable, only after the gate', phase: 'integrate', depends_on: ['FP-07'],
    description: "Set wait_default: 'durable' in fastops.mjs, regenerate config docs, rerun suite and both benches.",
    scope: S, criteria: [
      { statement: 'Fast path is the DEFAULT (lesson: built but never wired in)', verifier: { type: 'grep', file: 'server/src/fastops.mjs', pattern: "wait_default:\\s*['\"]durable['\"]" } },
      { statement: 'Group commit reachable from the server entry', verifier: { type: 'wiring', entry: 'server/src/server.mjs', symbol: '_sealDrain' } },
      { statement: 'Config docs regenerated', verifier: { type: 'docs', cmd: 'node scripts/gen-config-docs.mjs', paths: ['docs'] } },
      m(B4, '4k', 'writers1.p50', '<=', 20), m(B4, '4k', 'writers32.savesPerSec', '>=', 500), m(B10, '10k', 'writers1.p50', '<=', 20), m(B10, '10k', 'writers32.savesPerSec', '>=', 500), ...common(S)] }),
  C.makeTask({ id: 'FP-09', title: 'test:fast tier under 5 minutes', phase: 'integrate', depends_on: ['FP-06'],
    description: 'Add test:fast (< 5 min) and test:slow; parallel, own tmpdir and port 0 per test, no sleeps. Move ops_file, check_docs_rules, offline_run, large imports to slow.',
    scope: ['server/package.json', 'package.json', 'server/test/**', 'scripts/**'],
    criteria: [{ statement: 'test:fast exits 0 within 300 s', verifier: { type: 'command', cmd: 'cd server && npm run test:fast', timeout_s: 300 } },
      { statement: 'test:slow script exists', verifier: { type: 'grep', file: 'server/package.json', pattern: '"test:slow"' } }, ...common(['server/package.json', 'package.json', 'server/test/**', 'scripts/**'])] }),
  C.makeTask({ id: 'FP-10', title: 'Restore the 10k crash-guard tests', phase: 'integrate', depends_on: ['FP-06'], requirements: ['scale'],
    description: 'Restore the deleted restart and large-index crash tests at 10k scale (lesson: the cap silently deleted coverage).',
    scope: ['server/test/**'], criteria: [
      { statement: 'restart crash test present', verifier: { type: 'test_exists', test_file: 'server/test/crash_restart.test.mjs' } },
      { statement: 'large-index crash test runs at 10k', verifier: { type: 'grep', file: 'server/test/crash_large_index.test.mjs', pattern: '10_?000' } }, ...common(['server/test/**'])] }),
];
const e = C.validate(c); if (e.length) { console.error(e.join('\n')); process.exit(1); }
console.log(JSON.stringify(c, null, 2));
