# Changelog

All notable project changes are recorded here. Dates use ISO 8601 (`YYYY-MM-DD`).

## [0.1.0] - 2026-10-14

### Added
- Executable MVP: CLI (`init`, `contract`, `next`, `brief`, `verify`, `gate`, `report`, `status`, `evidence`, `hook`, `mcp`).
- Contract schema `proofline/1` with ten deterministic verifier types, phase + dependency task graph, contract-weakening detection.
- Hash-chained append-only evidence log; red-green replay in a git worktree; flaky re-run policy; baseline regression check.
- Claim reconciliation of `TASK | status | commit | tests | numbers | missing` lines; corrective prompts per failed criterion.
- MCP stdio server, git pre-commit/pre-push hooks with no bypass variable, GitHub Actions self-gate.
- GROK.md/AGENTS.md loop, FAIL→PASS demo, hivevault fast-path worked contract with bench rig.

## [Unreleased]

### Fixed
- The forbidden scan no longer reads `proofline.json` or `.proofline/`: the commit that adds or amends the contract failed on its own deny-list. Contract changes stay covered by the weakening check, and the gate report says whether the contract was added, changed or unchanged vs the base (#4).
- `init` no longer replaces an existing `pre-commit` or `pre-push` hook: it keeps it as `<hook>.proofline-prev`, and the installed hook runs it first (same arguments and stdin) and stops on its failure. A second `init` changes nothing (#1).
- The corrective text for an unpushed task and the brief name the push target from the criterion's `remote`/`branch`, else `defaults.remote`/`defaults.branch`, instead of always `origin` (#8).
- A PASS no longer always says "Commit, push to main ... Then call task_next". On a HEAD already on the push target it says the task is verified on the pushed HEAD and gives the `gate` command with claims (and `--base` when one was passed); after accepted claims it points to `proofline next`; only an unpushed PASS says to push, to the configured remote and branch (#9).
- The hivevault fast-path example timed the flush answer, which no longer covers the seal or the commit. `bench/e2e.mjs` now sends `wait: "sealed"` and polls until the vault's HEAD commit holds the batch with the bytes on disk: `flushMs` is the time to that commit, `flushAnswerMs` the answer, and a timeout records `flushCommitted: 0` instead of a number. FP-01 gains criteria that the flush's commit exists at 4k and 10k (#3).
- Every task in the hivevault fast-path example allows `CHANGELOG.md` and `docs/MAP.md`, which hivevault's own rules require with each change; no other path is added (#10).
- The hivevault example's bench commands set `WAIT=durable`, which `bench/e2e.mjs` never read. The writers now send it as each PUT's `wait` and the output records it, so the writer metrics measure the durable writes their targets are for. The commands are unchanged (#11).
- A verify or gate with no pinned base, where the default base is HEAD (a fresh clone after the push), is BLOCKED instead of passing every diff check on an empty diff (#5).

### Added
- Metric evidence and report lines record the load before the run, the CPU count and the `node --version` the bench command resolves. Optional `defaults.max_load_per_cpu`: a metric run on a busier machine is BLOCKED (machine busy, with the numbers) and the bench is not run; raising or removing the limit is a weakening (#7).
- `defaults.remote` in the contract (validated as a string), used by `pushed`, by claim reconciliation and by the default base, which is now `defaults.base`, else `<remote>/<branch>`. A repository whose remote is not `origin` no longer gets a BLOCKED gate on an unresolved base, or a claim check that silently checks nothing (#6).
- Optional `owner` on a task and `defaults.owners` in the contract (validated); `--owner <name>` on `next`, `status` and `brief` (MCP: `task_next` and `status`). `next --owner` hands out that owner's tasks and unowned ones, never another owner's (#2).
- `--base <rev>` on `verify` and `gate` (MCP: `base`), an optional `Proofline-Base:` commit trailer, and the base source (`--base`, contract, pinned at start, commit trailer, default) in every report. The `next` brief prints the pinned base (#5).
- `brief <TASK> --base <rev>`: the brief ends with the base `verify` and `gate` will use, its source, and the reason it would be BLOCKED, if any (#5).
- Initial product scope, requirements, architecture, lifecycle, evidence model, security posture, verification strategy, delivery pipeline, roadmap, and dependency map.
- Initial Mermaid diagrams, ADRs, task-contract example, and project templates.
- Initial documentation CI workflow.

