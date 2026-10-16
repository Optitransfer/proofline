# Changelog

All notable project changes are recorded here. Dates use ISO 8601 (`YYYY-MM-DD`).

## [Unreleased]

### Fixed
- A failed `command` criterion's evidence names the failed tests. `out_tail` keeps the last 1,200 characters, where node's summary of repeated failures with their stacks held the last two or three names. The new `failing` field lists the failed test names found anywhere in the output (TAP `not ok` lines, the spec reporter's `✖ <name> (<ms>ms)` lines and the `failing tests:` section), without todos, skips or repeats, in order of first appearance and at most 100, with `failing_total` when there were more. The FAIL detail names the first 10, a flaky result keeps both runs' lists, and the gate report lists the names under Failing tests (#13).
- The forbidden scan no longer reads `proofline.json` or `.proofline/`: the commit that adds or amends the contract failed on its own deny-list. Contract changes stay covered by the weakening check, and the gate report says whether the contract was added, changed or unchanged vs the base (#4).
- `init` no longer replaces an existing `pre-commit` or `pre-push` hook: it keeps it as `<hook>.proofline-prev`, and the installed hook runs it first (same arguments and stdin) and stops on its failure. A second `init` changes nothing (#1).
- The corrective text for an unpushed task and the brief name the push target from the criterion's `remote`/`branch`, else `defaults.remote`/`defaults.branch`, instead of always `origin` (#8).
- A PASS no longer always says "Commit, push to main ... Then call task_next". On a HEAD already on the push target it says the task is verified on the pushed HEAD and gives the `gate` command with claims (and `--base` when one was passed); after accepted claims it points to `proofline next`; only an unpushed PASS says to push, to the configured remote and branch (#9).
- A verify or gate with no pinned base, where the default base is HEAD (a fresh clone after the push), is BLOCKED instead of passing every diff check on an empty diff (#5).

### Added
- The pre-commit hook accepts a contract change only when an approval marker is present. The marker is a file named with the sha256 of the staged `proofline.json` bytes, in the directory set by `init --approvals` and stored in `.proofline/config.json` (never committed). The refusal prints the weakenings, the sha256 and the marker path. A marker for other bytes does not count, what else is staged does not matter, and with no directory configured every contract change is refused.
- Opt-in result reuse: with `defaults.reuse_results` (validated, default `false`), a `command` or `metric` PASS on a clean tree is recorded in the evidence log and reused by a later `verify` or `gate` on the same HEAD, so `verify`, `gate` and the pre-push hook run the full suite once per commit. The key is the verifier, HEAD, `process.version` and the env vars the command names; only a PASS is stored; `defaults.reuse_max_age_h` (default 24) bounds its age; a metric is reused only within `max_load_per_cpu`. A result is reused only from an evidence entry still in an intact chain with the hash the cache file stored. Reused criteria say `reused from <time> (evidence entry <n>)` and are listed apart in the gate report and its evidence entry. `--fresh` on `verify` and `gate` (MCP: `fresh`) runs every check. Turning reuse on or off is not a weakening (#12).
- Metric evidence and report lines record the load before the run, the CPU count and the `node --version` the bench command resolves. Optional `defaults.max_load_per_cpu`: a metric run on a busier machine is BLOCKED (machine busy, with the numbers) and the bench is not run; raising or removing the limit is a weakening (#7).
- `defaults.remote` in the contract (validated as a string), used by `pushed`, by claim reconciliation and by the default base, which is now `defaults.base`, else `<remote>/<branch>`. A repository whose remote is not `origin` no longer gets a BLOCKED gate on an unresolved base, or a claim check that silently checks nothing (#6).
- Optional `owner` on a task and `defaults.owners` in the contract (validated); `--owner <name>` on `next`, `status` and `brief` (MCP: `task_next` and `status`). `next --owner` hands out that owner's tasks and unowned ones, never another owner's (#2).
- `--base <rev>` on `verify` and `gate` (MCP: `base`), an optional `Proofline-Base:` commit trailer, and the base source (`--base`, contract, pinned at start, commit trailer, default) in every report. The `next` brief prints the pinned base (#5).
- `brief <TASK> --base <rev>`: the brief ends with the base `verify` and `gate` will use, its source, and the reason it would be BLOCKED, if any (#5).

## [0.1.0] - 2026-10-14

### Added
- Executable MVP: CLI (`init`, `contract`, `next`, `brief`, `verify`, `gate`, `report`, `status`, `evidence`, `hook`, `mcp`).
- Contract schema `proofline/1` with ten deterministic verifier types, phase + dependency task graph, contract-weakening detection.
- Hash-chained append-only evidence log; red-green replay in a git worktree; flaky re-run policy; baseline regression check.
- Claim reconciliation of `TASK | status | commit | tests | numbers | missing` lines; corrective prompts per failed criterion.
- MCP stdio server, git pre-commit/pre-push hooks with no bypass variable, GitHub Actions self-gate.
- AGENTS.md agent loop, FAIL to PASS demo.
- Initial product scope, requirements, architecture, lifecycle, evidence model, security posture, verification strategy, delivery pipeline, roadmap, and dependency map.
- Initial Mermaid diagrams, ADRs, task-contract example, and project templates.
