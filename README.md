# Proofline

**The agent says done. Proofline verifies and validates the work against a V&V contract, to assure agent performance.**

A coding agent reports that a task is finished. Proofline does not take the report: it holds the definition of done as a contract a machine can check, hands the agent one task at a time, re-runs every check itself when the agent reports, and lets a commit through only when the evidence says PASS. The agent gets a corrective prompt that names the file and the line to fix next, never a verdict it can argue with. Zero dependencies, Node 22+, Apache-2.0.

```mermaid
flowchart LR
    C["proofline.json<br/>tasks, criteria, scope,<br/>forbidden actions"] --> N["proofline next<br/>one task, its brief,<br/>the base revision pinned"]
    N --> A["the agent<br/>failing test first,<br/>then the fix"]
    A --> H1{"pre-commit hook<br/>forbidden actions,<br/>contract change without a marker"}
    H1 -- "refused" --> A
    H1 -- "clean" --> V["proofline verify<br/>every criterion re-run<br/>from the base revision"]
    V -- "FAIL or BLOCKED:<br/>corrective prompt,<br/>file and line" --> A
    V -- "PASS" --> G["proofline gate --claims<br/>the agent's report line<br/>against the evidence"]
    G -- "a claim the evidence<br/>does not support" --> A
    G -- "PASS, report written" --> H2{"pre-push hook<br/>does this HEAD gate PASS?"}
    H2 -- "no" --> A
    H2 -- "yes" --> M[("main")]
    M --> N
    O["owner marker<br/>sha256 of the approved<br/>proofline.json"] -. "approves a<br/>contract change" .-> H1
```

## See it catch

`node examples/demo/catch.mjs` builds a throwaway repository with one task, then plays five ways an agent "finishes" without doing the work, and the real work last. Real output, shortened only where a line ran long:

```text
proofline next -> TASK-1: Saves return a durable receipt on the default path

1. The lie: no work, reported "done | abc1234 | app.test.mjs"   -> FAIL
  claim rejected: claimed "done" but the independent gate says FAIL: ...
  claim rejected: commit abc1234 does not exist
  TASK-1-AC01 FAIL  test file test/durable.test.mjs not found
  TASK-1-AC02 FAIL  durableReceipt is not referenced from the default path (src/app.mjs; 2 files reachable). Built but not wired in.

2. The gap: a "durable" test that asserts what already held   -> FAIL
  TASK-1-AC01 FAIL  test PASSES on base 412bc3d9 without the change: it does not prove the change (tests how, not what?)

3. The shortcut: test.skip and a timeout raised 2000 -> 20000   -> FAIL
  forbidden: test_skip_only in test/app.test.mjs: test.skip('handle returns ok', { timeout: 20000 }, () => { assert.equal(handle('x').ok, true); });
  forbidden: timeout_raise in test/app.test.mjs: 2000 → 20000
  TASK-1-AC03 FAIL  1 skipped/todo > allowed 0

4. The stray change: README.md edited, outside the task's scope   -> FAIL
  TASK-1-AC04 FAIL  changes outside the approved scope: README.md

5. The weakening: proofline.json edited so "suite green" runs `true`, then git commit   -> REFUSED by the pre-commit hook
  contract weakened: TASK-1/TASK-1-AC03 command changed: "node --test" → "true"
  marker (no approvals directory configured)

6. The work: failing test first, durableReceipt wired in, committed through the hooks, pushed   -> PASS
  TASK-1-AC01 PASS  red on base (exit 1), green now
  TASK-1-AC02 PASS  durableReceipt used on the default path: src/app.mjs
  TASK-1-AC03 PASS  exit 0 in 234 ms
  TASK-1-AC04 PASS  2 changed files, all in scope
  TASK-1-AC05 PASS  HEAD f6234c72 is origin/main
  claim accepted: "TASK-1 | done | f6234c7 | save is durable, test/durable.test.mjs | - | -"
  evidence: 9 entries in the hash-chained log; report .proofline/reports/TASK-1-latest.md

Caught five, passed one.
```

## Sixty seconds

In the repository the agent works on:

```bash
npm install --save-dev @optitransfer/proofline@next && npx proofline init --approvals ~/.proofline/approved && cp node_modules/@optitransfer/proofline/AGENTS.md .
```

```text
initialised /path/to/your-repo
  proofline.json
  .proofline/config.json
  .gitignore
  hooks/pre-commit
  hooks/pre-push
```

That writes the contract skeleton, the local evidence log, the two git hooks, the directory where you (the owner) approve contract changes, and the loop the agent follows in `AGENTS.md`. Add one task and tell the agent to start:

```bash
cat > task.json <<'JSON'
{ "id": "TASK-1", "title": "Reject an empty body", "phase": "implement",
  "scope": { "allow": ["src/**", "test/**", "CHANGELOG.md"] },
  "criteria": [
    { "id": "TASK-1-AC01", "mandatory": true, "statement": "an empty body is refused",
      "verifier": { "type": "test_red_green", "test_file": "test/empty_body.test.mjs", "cmd": "node --test {test}" } },
    { "id": "TASK-1-AC02", "mandatory": true, "statement": "suite green",
      "verifier": { "type": "command", "cmd": "npm test" } },
    { "id": "TASK-1-AC03", "mandatory": true, "statement": "pushed", "verifier": { "type": "pushed" } } ] }
JSON
npx proofline contract create --from task.json     # TASK-1: valid
npx proofline next                                   # the agent's first command: the brief, with the base pinned
```

When the agent reports, Proofline checks. Before any work this is what it says, and the agent is told what to do next:

```text
$ npx proofline verify TASK-1
== TASK-1: FAIL
  base: 0a88576db5567f08c9f1cd9481c633001036d8e1 = 0a88576d (pinned at start)
  FAIL  TASK-1-AC01 [test_red_green] test file test/empty_body.test.mjs not found
  PASS  TASK-1-AC02 [command] exit 0 in 393 ms
  FAIL  TASK-1-AC03 [pushed] working tree not clean (3 paths); work held locally
  report: .proofline/reports/TASK-1-latest.md

PROOFLINE CORRECTIVE INSTRUCTION for TASK-1 (Reject an empty body): gate FAIL
1. TASK-1-AC01 [test_red_green] FAIL: an empty body is refused
   Next step: The test test/empty_body.test.mjs must FAIL on the base and PASS now.
2. TASK-1-AC03 [pushed] FAIL: pushed
   Next step: Commit everything and `git push origin main` (hooks on; never --no-verify).
DECISION: FAIL
```

Exit codes: `0` PASS, `1` FAIL, `2` BLOCKED, `3` usage. Every command takes `--json`. The published package is `@optitransfer/proofline` at `0.2.0-next.0` on the `next` dist-tag: `npx @optitransfer/proofline@next`.

## Why

An agent's report is a claim. Left to itself it says "done" for a test it skipped, a timeout it raised, a target it lowered, a commit it never pushed, or a number it did not measure. Reviewing every claim by hand does not scale past one agent, and asking a second model whether the first one is right only adds a second opinion.

Proofline replaces the opinion with a contract and a re-run. The contract is yours: it names each task, the files it may touch, and the checks that prove it, and it cannot be weakened by the agent, because a changed criterion, threshold or forbidden rule is refused at commit time unless a marker with the hash of the new contract sits in the directory only you write to. The checks are the kind a machine can settle: a test that fails on the base revision and passes now, a command and its exit code, a metric against its target, changed files inside the allowed scope, a HEAD that is on the contract's branch. Every result is appended to a hash-chained evidence log, so a report can be checked later against what actually ran.

## What it checks

Every criterion names a verifier. Each one is deterministic: no model reads the diff, no opinion decides.

| Type | Passes only when |
|---|---|
| `command` | exit code matches; no hung/cancelled tests; optional `max_skipped`, `min_tests` (catches deleted tests). A fail-then-pass is **flaky**, not a pass. Test counts and failing-test names are parsed from the Node test runner's output (TAP or spec reporter); for other runners use `command` criteria without `min_tests` |
| `test_red_green` | the test exists, **fails** on the base revision (replayed in a git worktree) and **passes** now; named test actually executed |
| `test_exists` | test file (and name) present |
| `metric` | bench command's JSON (`key` dotted path) meets `op value`; also fails on >20% regression vs `baseline.metrics`. One bench run feeds all its metrics. Missing rig → BLOCKED. The evidence and report line record the 1-minute load, the CPU count and the `node --version` the command resolves; with `defaults.max_load_per_cpu` set, a load per CPU above it before the run is BLOCKED (machine busy), never PASS or FAIL, and raising or removing that limit is a contract weakening |
| `grep` | pattern present/absent (e.g. the new code path is the default config) |
| `wiring` | the symbol is **called** in a file reachable by static imports from the default entry (catches "built but not wired in") |
| `scope` | every changed file matches the allowlist |
| `docs` | generator leaves no diff in the given paths |
| `pushed` | tree clean and HEAD == `<remote>/<branch>` (the criterion's `remote`/`branch`, else `defaults.remote`/`defaults.branch`, else `origin`/`main`) |
| `file_exists` | path exists (e.g. the bench rig is committed) |

Always on: forbidden-action scan of the diff (skip/only/todo, raised timeouts, net assertion loss, deleted tests, `--no-verify`, bypass env vars, lowered protected caps; `proofline.json` and `.proofline/` are left out, because the contract declares the deny-list and would match it), contract-weakening check vs the base revision (loosened thresholds, removed criteria, changed commands → BLOCKED), hash-chained evidence log integrity, claim reconciliation.


## How it decides

### Owners

Two or more builders can share one contract. A task may carry an `owner`, and `defaults.owners` may list the names (`contract validate` then refuses an owner outside the list). `next --owner <name>` (MCP: `task_next` with `owner`) hands out only that owner's tasks and unowned ones, never another owner's; the phase gate applies to that lane, and `depends_on` still waits on any owner's task. `status --owner <name>` and `brief <TASK> --owner <name>` take the same filter, and `brief` refuses another owner's task. Without `--owner`, nothing changes.


### Git hooks

`init` installs `pre-commit` (forbidden actions and contract weakening vs HEAD) and `pre-push` (the active task must gate PASS). If the repository already has one of these hooks and it is not proofline's, `init` keeps it as `<hook>.proofline-prev` and says so. The installed hook runs it first, with the same arguments and stdin; if it fails, its exit code stands and the gate does not run. Running `init` again changes nothing. If both `<hook>` and `<hook>.proofline-prev` exist and neither is proofline's, `init` stops rather than lose one.

A contract change is refused unless an approval marker is present. `proofline init --approvals <dir>` (re-runnable) stores that directory in `.proofline/config.json`, which is never committed. The marker is a file in that directory named with the sha256 of the staged `proofline.json` bytes. The refusal prints the weakenings, the sha256 and the marker path. A marker named for any other bytes does not count, and what else the commit stages makes no difference. With no directory configured, every contract change is refused. There is no bypass.

`verify` and `gate` read the same marker for the current `proofline.json` bytes. When that marker is a regular file, the weakenings are an approved contract change: the report names the marker path, and the decision is not blocked. A missing marker, a marker for other bytes, or a symlink still blocks.


### Base revision

Every diff check (forbidden scan, `scope`, `test_red_green`, contract weakening) compares the base revision with the working tree. The base is taken from, first match wins:

1. `--base <rev>` on `verify` or `gate` (MCP: `base`);
2. the task's own `base` in the contract;
3. the base pinned when the task started (`proofline next` records it in the local `.proofline/` log, and the brief prints it);
4. a `Proofline-Base: <sha>` trailer on the HEAD commit (optional; it must name an ancestor of HEAD, or the gate is BLOCKED);
5. the default: `defaults.base`, else `<defaults.remote>/<defaults.branch>` (`origin/main` when neither is set).

A repository whose remote is not called `origin` sets `defaults.remote` (for example `"github"`) and leaves `defaults.base` out; `pushed`, claim reconciliation and the default base then use that remote.

Every report says which one it used, and `brief <TASK> [--base <rev>]` says which base `verify` and `gate` will use and whether it would block. A fresh clone has no log, and after the push the default base is HEAD, so the diff is empty and every diff check would pass on nothing. In that case the gate is BLOCKED, never PASS, and the corrective line asks for `--base <rev>` (for one commit, its parent) or `proofline next`. The CI workflow passes the previous tip of the pushed branch as `--base`.


### Reusing results (verify, then gate)

`verify` and `gate` run every check each time. When a task's slowest check is the full suite, `verify`, `gate` and the pre-push hook on the same commit run it two or three times with nothing changed. A contract can opt in to reuse:

```json
"defaults": { "reuse_results": true, "reuse_max_age_h": 24 }
```

- `reuse_results` (`true`/`false`, default `false`): with it off, or left out, every check runs every time, as before. Turning it on or off is not a contract weakening.
- Only `command` and `metric` results are reused. `test_red_green`, `scope`, `wiring`, `grep`, `docs`, `pushed`, the forbidden scan and the weakening check always run: they are cheap, or they depend on the base.
- Only a PASS is stored. A FAIL, a flaky result, a busy-machine block or an error runs again every time.
- A PASS is reused only on the same HEAD with a clean tree: `git status` shows nothing outside `.proofline/`, untracked files included. An uncommitted edit never reuses a result, and a check run on a dirty tree is not stored.
- The key is the criterion's verifier object (canonical JSON), the HEAD sha, `process.version` and the values of the env vars the command names (`$VAR`, `${VAR}`; `{VAR}` in a metric's `output_file`); for a metric also its baseline and the regression tolerance. Change any of them and the check runs again. Gitignored files, env vars the command does not name and tools outside the repo are not in the key: a check that depends on them needs `--fresh`.
- `reuse_max_age_h` (a positive number, default 24): an older PASS runs again.
- A metric PASS is reused only if the load per CPU it recorded is within `defaults.max_load_per_cpu`, when that is set. Its measured value is reused with it, so claims are checked against it.
- A fresh PASS is recorded in the evidence log (a `result` entry) and `.proofline/cache/<sha256 of key>.json` points at that entry with its hash, time, status, detail and evidence (exit code, test counts, duration). A result is reused only from that entry, and only while it is in an intact chain with the same hash; an edited or truncated log, or a cache file that names another hash, means the check runs again.
- Every reused criterion says `reused from <time> (evidence entry <n>)` in its report line, the gate report lists reused criteria under **Reused results** (not run again in that gate), and the gate's evidence entry carries the same lines.
- `--fresh` on `verify` and `gate` (MCP: `fresh: true`) ignores stored results and runs every check; a PASS it gets replaces the stored one.

Demo (claimed done with no evidence, FAIL, then real work, PASS): `npm run demo`.


## For agents

Read [AGENTS.md](AGENTS.md): the loop, the exact report line, what is never allowed and the stop rules. MCP config: [examples/mcp-config.json](examples/mcp-config.json). Tools: `contract_create`, `task_next`, `evidence_record`, `verify`, `gate`, `report`, `status`.

## Repository layout

```text
proofline/
├── bin/proofline.mjs        the command: init, contract, next, brief, verify, gate, report, status, evidence, hook, mcp
├── src/contract.mjs         contract schema, validation, task graph, weakening detection
├── src/checks.mjs           the verifiers
├── src/forbidden.mjs        the forbidden-action scan
├── src/claims.mjs           report-line parser and claim reconciliation
├── src/evidence.mjs         the append-only, hash-chained evidence log (.proofline/evidence.jsonl)
├── src/engine.mjs           verify, the corrective prompt, gate and its report, next and brief, phases
├── src/mcp.mjs              the MCP server on stdio
├── src/index.mjs            the API, init, hooks
├── examples/demo/           demo.mjs (FAIL then PASS, npm run demo) and catch.mjs (five catches, one pass)
├── examples/demo-contract/  an example contract with one task; the self-gate validates it
├── docs/                    the source design: scope, requirements, architecture, lifecycle, evidence, roadmap
├── plans/                   definition of done, risk register, pilot plan
└── proofline.json           Proofline's own contract: the repository gates itself
```

## Documentation

[docs/00-index.md](docs/00-index.md) lists the design documents. [CONTRIBUTING.md](CONTRIBUTING.md) has the sign-off rule; [SECURITY.md](SECURITY.md) says how to report a vulnerability.

## Known limits

See `KNOWN_LIMITS` in `src/engine.mjs`; they are printed in every report. In short: same-machine agents can edit local state (tampering is detected, and CI re-verifies, but protect `proofline.json` with branch protection/CODEOWNERS); `--no-verify` can skip local hooks (CI catches it); static wiring/forbidden checks are heuristics; contracts are JSON only; with `reuse_results` on, a reused PASS is keyed on HEAD, node and the env vars the command names, not on gitignored files or tools outside the repo.


## License

Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). Contributions are accepted under the same licence with a Developer Certificate of Origin sign-off on each commit.
