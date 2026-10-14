# Proofline

Independent verification and delivery gates for AI agents. **Private.** CI: see [ci/README.md](ci/README.md) (workflow not yet enabled). Licence: Apache-2.0 (as set by the source design; review before any public release).

The agent does the work. Proofline owns the definition of done: it turns each task into a machine-checkable contract, re-runs every check itself, rejects claims the evidence does not support, tells the agent exactly what to fix next, and gives a PASS / FAIL / BLOCKED release decision with an evidence report.

Zero dependencies. Node 22+.

```
contract ──► next (one task, full brief) ──► agent works ──► verify (independent) ──► steer (corrective prompt)
   ▲                                                              │ PASS
   └──────────── phases: intake → design → plan → implement → verify → integrate → release → monitor ◄── gate + report
```

## Quick start

```bash
cd /path/to/target-repo
node /path/to/proofline/bin/proofline.mjs init          # proofline.json, .proofline/, git hooks (an existing hook is kept, see below)
node /path/to/proofline/bin/proofline.mjs contract create --from task.json
node /path/to/proofline/bin/proofline.mjs next          # the single next task + meticulous brief
node /path/to/proofline/bin/proofline.mjs verify FP-01  # independent checks + corrective prompt
node /path/to/proofline/bin/proofline.mjs gate FP-01 --claims "FP-01 | done | abc1234 | x.test.mjs | 4k.flushMs=1100 | -"
node /path/to/proofline/bin/proofline.mjs gate FP-01 --base 1a2b3c4   # in a fresh clone: the revision the task started from
node /path/to/proofline/bin/proofline.mjs status
```

Exit codes: `0` PASS, `1` FAIL, `2` BLOCKED, `3` usage. Every command takes `--json`.

## Owners

Two or more builders can share one contract. A task may carry an `owner`, and `defaults.owners` may list the names (`contract validate` then refuses an owner outside the list). `next --owner <name>` (MCP: `task_next` with `owner`) hands out only that owner's tasks and unowned ones, never another owner's; the phase gate applies to that lane, and `depends_on` still waits on any owner's task. `status --owner <name>` and `brief <TASK> --owner <name>` take the same filter, and `brief` refuses another owner's task. Without `--owner`, nothing changes.

## Git hooks

`init` installs `pre-commit` (forbidden actions and contract weakening vs HEAD) and `pre-push` (the active task must gate PASS). If the repository already has one of these hooks and it is not proofline's, `init` keeps it as `<hook>.proofline-prev` and says so. The installed hook runs it first, with the same arguments and stdin; if it fails, its exit code stands and the gate does not run. Running `init` again changes nothing. If both `<hook>` and `<hook>.proofline-prev` exist and neither is proofline's, `init` stops rather than lose one.

## Base revision

Every diff check (forbidden scan, `scope`, `test_red_green`, contract weakening) compares the base revision with the working tree. The base is taken from, first match wins:

1. `--base <rev>` on `verify` or `gate` (MCP: `base`);
2. the task's own `base` in the contract;
3. the base pinned when the task started (`proofline next` records it in the local `.proofline/` log, and the brief prints it);
4. a `Proofline-Base: <sha>` trailer on the HEAD commit (optional; it must name an ancestor of HEAD, or the gate is BLOCKED);
5. the default: `defaults.base`, else `<defaults.remote>/<defaults.branch>` (`origin/main` when neither is set).

A repository whose remote is not called `origin` sets `defaults.remote` (for example `"github"`) and leaves `defaults.base` out; `pushed`, claim reconciliation and the default base then use that remote.

Every report says which one it used, and `brief <TASK> [--base <rev>]` says which base `verify` and `gate` will use and whether it would block. A fresh clone has no log, and after the push the default base is HEAD, so the diff is empty and every diff check would pass on nothing. In that case the gate is BLOCKED, never PASS, and the corrective line asks for `--base <rev>` (for one commit, its parent) or `proofline next`. The CI workflow passes the previous tip of the pushed branch as `--base`.

Demo (claimed done with no evidence → FAIL, then real work → PASS): `npm run demo`.

## Verifier types (deterministic; no LLM opinion)

| Type | Passes only when |
|---|---|
| `command` | exit code matches; no hung/cancelled tests; optional `max_skipped`, `min_tests` (catches deleted tests). A fail-then-pass is **flaky**, not a pass |
| `test_red_green` | the test exists, **fails** on the base revision (replayed in a git worktree) and **passes** now; named test actually executed |
| `test_exists` | test file (and name) present |
| `metric` | bench command's JSON (`key` dotted path) meets `op value`; also fails on >20% regression vs `baseline.metrics`. One bench run feeds all its metrics. Missing rig → BLOCKED |
| `grep` | pattern present/absent (e.g. the fast path is the **default** config) |
| `wiring` | the symbol is **called** in a file reachable by static imports from the default entry (catches "built but not wired in") |
| `scope` | every changed file matches the allowlist |
| `docs` | generator leaves no diff in the given paths |
| `pushed` | tree clean and HEAD == `<remote>/<branch>` (the criterion's `remote`/`branch`, else `defaults.remote`/`defaults.branch`, else `origin`/`main`) |
| `file_exists` | path exists (e.g. the bench rig is committed) |

Always on: forbidden-action scan of the diff (skip/only/todo, raised timeouts, net assertion loss, deleted tests, `--no-verify`, bypass env vars, lowered protected caps; `proofline.json` and `.proofline/` are left out, because the contract declares the deny-list and would match it), contract-weakening check vs the base revision (loosened thresholds, removed criteria, changed commands → BLOCKED), hash-chained evidence log integrity, claim reconciliation.

## How Grok uses it

Read [GROK.md](GROK.md) (also [AGENTS.md](AGENTS.md)). MCP config: [examples/mcp-config.json](examples/mcp-config.json). Tools: `contract_create`, `task_next`, `evidence_record`, `verify`, `gate`, `report`, `status`.

## Layout

```
bin/proofline.mjs        CLI
src/contract.mjs         contract schema, validation, task graph, weakening detection
src/checks.mjs           verifiers
src/forbidden.mjs        forbidden-action scan
src/claims.mjs           status-line parser + claim reconciliation
src/evidence.mjs         append-only hash-chained evidence log (.proofline/evidence.jsonl)
src/engine.mjs           verify, steer (corrective prompts), gate (reports), next/brief, phases
src/mcp.mjs              MCP stdio server
src/index.mjs            API, init, hooks
examples/demo/           FAIL → PASS demo
examples/hivevault-fastpath/  worked contract (FP-00..FP-10) + bench rig
docs/                    source design: scope, requirements, architecture, lifecycle, evidence, roadmap …
plans/                   backlog, definition of done, risk register, pilot plan
proofline.json           Proofline's own contract (self-gate, also run in CI)
```

## Known limits

See `KNOWN_LIMITS` in `src/engine.mjs`; they are printed in every report. In short: same-machine agents can edit local state (tampering is detected, and CI re-verifies, but protect `proofline.json` with branch protection/CODEOWNERS); `--no-verify` can skip local hooks (CI catches it); static wiring/forbidden checks are heuristics; contracts are JSON only.
