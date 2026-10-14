# Initial development backlog

This backlog is intentionally ordered by dependency. Issue IDs are local planning IDs until GitHub issues are created.

## Epic A — Contract and schemas

- [ ] **AVV-001** Define and implement task-contract schema and validator. Maps to REQ-001, REQ-002, REQ-003.
- [ ] **AVV-002** Define normalized event schema and adapter version rules. Maps to REQ-004, REQ-019.
- [ ] **AVV-003** Define evidence, finding, exception, and report schemas. Maps to REQ-005, REQ-014, REQ-016.
- [ ] **AVV-004** Define schema compatibility and migration policy. Maps to NFR-009.

## Epic B — Deterministic core

- [ ] **AVV-010** Implement run state machine and terminal statuses. Maps to REQ-010, REQ-011.
- [ ] **AVV-011** Implement append-oriented local evidence ledger. Maps to REQ-005, NFR-006, NFR-008.
- [ ] **AVV-012** Implement revision identity and evidence freshness rules. Maps to REQ-017, NFR-002.
- [ ] **AVV-013** Implement requirement-to-evidence traceability. Maps to REQ-007.
- [ ] **AVV-014** Implement deterministic gate engine and decision matrix. Maps to REQ-008, REQ-010, REQ-011.
- [ ] **AVV-015** Implement Markdown and JSON reports. Maps to REQ-014, NFR-007.

## Epic C — Safe verification

- [ ] **AVV-020** Implement allowlisted command runner with timeout and output limits. Maps to NFR-005.
- [ ] **AVV-021** Implement secret redaction and redaction metadata. Maps to NFR-006.
- [ ] **AVV-022** Build adversarial fixture suite for false claims, skipped checks, stale evidence, and scope drift. Maps to REQ-008, REQ-009, REQ-011.
- [ ] **AVV-023** Implement reconciliation findings and dispositions. Maps to REQ-009, REQ-012.
- [ ] **AVV-024** Implement bounded corrective cycle and repeated-finding detection. Maps to REQ-012, REQ-013.

## Epic D — First adapter and CLI

- [ ] **AVV-030** Run adapter feasibility spike and record selection ADR.
- [ ] **AVV-031** Implement `init`, `start`, `watch`, `verify`, and `report` CLI path. Maps to REQ-015.
- [ ] **AVV-032** Implement normalized event ingestion and adapter diagnostics. Maps to REQ-004.
- [ ] **AVV-033** Implement workspace diff capture and final revision check.
- [ ] **AVV-034** Run first real-task pilot in `observe` mode.

## Epic E — Enforce mode and release

- [ ] **AVV-040** Implement human approval and scoped exception records. Maps to REQ-016.
- [ ] **AVV-041** Add enforce-mode policy integration and fail-closed behaviour.
- [ ] **AVV-042** Complete threat-model review and security tests.
- [ ] **AVV-043** Add software CI stages, packaging, and release provenance.
- [ ] **AVV-044** Run pilot evaluation and document go/no-go decision.

## Epic F — Optional integrations

- [ ] **AVV-050** Design optional read-only HiveVault context connector.
- [ ] **AVV-051** Define second-adapter requirements from pilot findings.
- [ ] **AVV-052** Evaluate evidence replay/export requirements.
