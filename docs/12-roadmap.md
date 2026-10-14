# 12 — Roadmap

This is a dependency-ordered roadmap, not a promise of calendar dates. A phase is complete only when its exit criteria are evidenced.

## Phase 0 — Contract and feasibility spike

**Goal:** remove ambiguity before building a broad framework.

Deliverables:
- Agree initial adapter choice based on a small integration spike.
- Define task-contract, event, evidence, finding, and report schemas.
- Select implementation language/runtime based on the adapter and existing project conventions.
- Validate that required lifecycle events and revision identity can be captured.
- Write 5–10 adversarial scenarios.

Exit criteria:
- A real agent session can be correlated with a workspace revision.
- The team can state which lifecycle facts are available and which are not.
- The MVP scope and first adapter are recorded in an ADR.

## Phase 1 — Local contract and evidence core

**Goal:** establish the trustworthy core without agent integration complexity.

Deliverables:
- Contract validation and versioning.
- Local run state machine.
- Evidence schema and append-oriented local ledger.
- Deterministic gate engine.
- JSON/Markdown report.
- Synthetic fixtures and negative tests.

Exit criteria:
- Missing, stale, skipped, and failed mandatory evidence cannot produce `verified`.
- A report is reproducible from the same contract, policy, and evidence set.

## Phase 2 — First real adapter

**Goal:** observe one supported agent end-to-end.

Deliverables:
- Adapter event normalization.
- Workspace/diff observation.
- Start, observe, verify, report workflow.
- Safe failure and adapter diagnostics.

Exit criteria:
- Real task can be observed in `observe` mode without breaking the agent workflow.
- Event gaps and adapter limitations are documented.

## Phase 3 — Verification and corrective guidance

**Goal:** catch useful omissions without creating noisy loops.

Deliverables:
- Requirement traceability.
- Independent configured checks.
- Scope drift detection.
- Unsupported completion-claim detection.
- Bounded corrective feedback and loop detection.

Exit criteria:
- Mandatory adversarial fixtures pass.
- Pilot measures both true catches and false blocks.

## Phase 4 — Enforce mode and hardening

**Goal:** allow policy-based delivery gates.

Deliverables:
- Enforce-mode gate integration.
- Human approval/exception records.
- Command policy and security hardening.
- CI/release report integration.

Exit criteria:
- Security review and failure-mode tests pass.
- Enforcement does not silently fail open when required signals are missing.

## Phase 5 — Optional ecosystem integrations

**Goal:** add value without compromising standalone operation.

Candidates:
- HiveVault connector for prior decisions and accepted exceptions.
- Additional agent adapters.
- CI provider integrations.
- Export/import and evidence replay tooling.

Exit criteria:
- Core remains standalone; integrations are optional and cannot bypass evidence gates.

## Deferred until justified

- Dashboard.
- Hosted control plane.
- Multi-agent orchestration.
- Broad domain packs outside software engineering.
- CRDT-backed replicated evidence store.
- Commercial/team policy management.

## Go/no-go criteria

Continue beyond the pilot only if measured omission detection and false-completion prevention justify added latency and review overhead. The key metric is useful, verified catches per interruption—not the number of events collected.
