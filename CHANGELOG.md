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

### Added
- Initial product scope, requirements, architecture, lifecycle, evidence model, security posture, verification strategy, delivery pipeline, roadmap, and dependency map.
- Initial Mermaid diagrams, ADRs, task-contract example, and project templates.
- Initial documentation CI workflow.

