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
node /path/to/proofline/bin/proofline.mjs init          # proofline.json, .proofline/, git hooks
node /path/to/proofline/bin/proofline.mjs contract create --from task.json
node /path/to/proofline/bin/proofline.mjs next          # the single next task + meticulous brief
node /path/to/proofline/bin/proofline.mjs verify FP-01  # independent checks + corrective prompt
node /path/to/proofline/bin/proofline.mjs gate FP-01 --claims "FP-01 | done | abc1234 | x.test.mjs | 4k.flushMs=1100 | -"
node /path/to/proofline/bin/proofline.mjs status
```

Exit codes: `0` PASS, `1` FAIL, `2` BLOCKED, `3` usage. Every command takes `--json`.

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
| `pushed` | tree clean and HEAD == origin/main |
| `file_exists` | path exists (e.g. the bench rig is committed) |

Always on: forbidden-action scan of the diff (skip/only/todo, raised timeouts, net assertion loss, deleted tests, `--no-verify`, bypass env vars, lowered protected caps), contract-weakening check vs the base revision (loosened thresholds, removed criteria, changed commands → BLOCKED), hash-chained evidence log integrity, claim reconciliation.

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
