# 02 — Requirements

This is the initial normative requirements baseline. IDs are stable references for issues, tests, reports, and changes. `MUST` is mandatory for MVP unless explicitly re-scoped through an ADR and changelog entry.

## Functional requirements

| ID | Priority | Requirement | Acceptance evidence |
|---|---|---|---|
| REQ-001 | MUST | The system MUST create or load a versioned task contract before enforcement. | Contract schema tests; invalid-contract rejection |
| REQ-002 | MUST | The contract MUST express acceptance criteria, exclusions, constraints, required checks, and risk/approval policy. | Schema and contract round-trip tests |
| REQ-003 | MUST | The system MUST preserve the accepted contract separately from agent-authored task notes. | Mutation/tampering tests |
| REQ-004 | MUST | The observer MUST ingest supported adapter events and validate event schema/version. | Adapter conformance suite |
| REQ-005 | MUST | Every evidence record MUST identify its source, timestamp, task/run, revision where applicable, and result state. | Evidence schema tests |
| REQ-006 | MUST | The system MUST distinguish `passed`, `failed`, `skipped`, `not_run`, and `inconclusive`. | State-transition tests |
| REQ-007 | MUST | Each acceptance criterion MUST resolve to evidence, an explicit exception, or an unresolved gap. | Traceability report tests |
| REQ-008 | MUST | Verification MUST be able to run configured checks independently of the implementing agent's claims. | End-to-end test with deliberately false claim |
| REQ-009 | MUST | The system MUST compare requested scope, observed changes, checks, and delivery claims. | Scope-drift and reconciliation fixtures |
| REQ-010 | MUST | Delivery status MUST distinguish `verified`, `partial`, `blocked`, and `unverified`. | Decision matrix tests |
| REQ-011 | MUST | Mandatory failed, skipped, stale, or absent evidence MUST NOT be reported as verified. | Negative delivery-gate tests |
| REQ-012 | MUST | Corrective feedback MUST cite the gap, requirement ID, supporting evidence, and next action. | Feedback contract tests |
| REQ-013 | MUST | Corrective retries MUST be bounded and repeated-loop detection MUST exist. | Retry-limit and loop fixtures |
| REQ-014 | MUST | The system MUST emit human-readable and machine-readable reports. | Snapshot/schema tests |
| REQ-015 | MUST | The system MUST work without any external context store or network connection for local workflows. | Offline integration test |
| REQ-016 | MUST | The system MUST record human-approved exceptions with actor, rationale, scope, and timestamp. | Exception audit tests |
| REQ-017 | SHOULD | The system SHOULD support baseline and final revision comparison. | Git integration tests |
| REQ-018 | SHOULD | The system SHOULD support report export and verification replay. | Replay integration test |
| REQ-019 | SHOULD | The system SHOULD expose a stable adapter contract for future agent integrations. | Contract test harness |
| REQ-020 | COULD | The system COULD integrate with an external context store for prior decisions and accepted exceptions. | Optional integration tests |

## Non-functional requirements

| ID | Requirement | Initial acceptance target |
|---|---|---|
| NFR-001 | Local-first | Core contract, evidence, and report path works offline. |
| NFR-002 | Deterministic decisions | Same contract, policy, evidence set, and verifier version produce the same gate decision. |
| NFR-003 | Explainability | Every block identifies one or more unmet gates and the evidence behind the decision. |
| NFR-004 | Performance | Establish a measured baseline; avoid arbitrary latency promises before pilot data. |
| NFR-005 | Safety | Commands run only through explicit policy; timeout and output-size limits exist. |
| NFR-006 | Privacy | No telemetry by default; evidence redaction and local storage documented. |
| NFR-007 | Portability | Reports are plain text/JSON with schema versions and no hosted-service dependency. |
| NFR-008 | Recoverability | Interrupted runs are recoverable without silently promoting status. |
| NFR-009 | Compatibility | Adapter and report schemas are versioned and migration policy documented. |
| NFR-010 | Testability | Core state machine and policy decisions are testable without live AI-provider calls. |

## MVP acceptance criteria

The MVP cannot be declared complete until all of the following are demonstrated:

- [ ] A contract can be created, validated, frozen for a run, and versioned.
- [ ] One supported agent can be observed through a real task lifecycle.
- [ ] The changed revision and permitted verification commands are captured.
- [ ] A deliberately omitted requirement is detected.
- [ ] A deliberately false “all tests passed” claim is rejected when evidence disagrees or is absent.
- [ ] A skipped mandatory check cannot produce `verified`.
- [ ] Scope drift is reported with changed paths and a contract reference.
- [ ] Retry limits prevent unbounded corrective loops.
- [ ] Human exceptions are explicit and visible in the final report.
- [ ] Reports can be read without Proofline running.
- [ ] Offline tests and end-to-end tests pass in CI.
- [ ] Security review covers command execution, secrets, path handling, and adapter trust.

## Change control

A requirement may be changed only with a recorded rationale, impact assessment, updated acceptance evidence, and (for architectural or trust-boundary changes) an ADR. The implementing agent cannot silently weaken the contract it is being evaluated against.
