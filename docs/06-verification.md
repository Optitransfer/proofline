# 06 — Verification and reconciliation

## Verification gates

| Gate | Question | Minimum evidence |
|---|---|---|
| G1 — Contract | Is the accepted scope complete and testable? | Validated, frozen contract; criteria and exclusions |
| G2 — Traceability | Does each requirement map to a change and/or verification record? | Requirement-to-evidence matrix |
| G3 — Execution | Were required checks actually run against the relevant revision? | Command identity, environment, revision, exit status, bounded output |
| G4 — Independent challenge | What plausible failure modes or regressions are not covered by the agent's own checks? | Diff review, negative/edge-case tests, regression challenges |
| G5 — Reconciliation | Do requested scope, observed changes, results, and agent claims agree? | Discrepancy list with dispositions |
| G6 — Delivery | Is the report accurate and are artifacts present? | Final revision, report, mandatory gate status, exceptions |

## Reconciliation dimensions

For each requirement, compare:

1. **Requested:** what the accepted contract requires.
2. **Changed:** what the workspace diff actually changed.
3. **Tested:** what the recorded checks actually exercised.
4. **Observed:** what adapter and repository events show.
5. **Claimed:** what the agent says it completed.
6. **Accepted:** what a human explicitly waived or changed through contract amendment.

A mismatch must create a finding. The system must not silently choose the most optimistic interpretation.

## Finding format

Each finding should include:
- stable finding ID and severity;
- affected requirement IDs;
- category (`omission`, `scope_drift`, `failed_check`, `stale_evidence`, `unsupported_claim`, `security`, `ambiguity`, `policy_denial`);
- concise statement;
- supporting evidence IDs and revision;
- confidence/verification method where probabilistic;
- recommended next action;
- disposition (`open`, `resolved`, `accepted_exception`, `not_applicable`) and who recorded it.

## Independence model

Independence is layered, not absolute:
- **Deterministic:** schema validation, status rules, diff paths, command exit codes, freshness checks, traceability completeness.
- **Test-based:** tests generated or selected from acceptance criteria and run independently.
- **Heuristic:** static analysis, diff heuristics, suspicious claim checks.
- **Model-assisted:** a separate reviewer/model may challenge the work, but its output is a finding to corroborate, not proof by itself.
- **Human:** domain judgement for ambiguous requirements, high-risk changes, or inadequate automated oracles.

## Decision matrix

| Condition | Permitted outcome |
|---|---|
| All mandatory requirements have fresh sufficient evidence; no open mandatory findings | `verified` |
| Work is useful but one or more requirements remain incomplete or explicitly waived | `partial` |
| Mandatory check failed, policy denied a required action, or dependency blocks required validation | `blocked` |
| Evidence is absent, stale, contradictory, or too weak to decide | `unverified` |

No status may be inferred from an agent's final message alone.
