# ADR-0002: Evidence-based delivery states

- Status: Proposed
- Date: 2026-10-14

## Context

Agent completion messages and process exit codes are insufficient to establish that all requirements were met. Skipped checks and stale evidence must not be confused with passing checks.

## Decision

Use explicit check states (`passed`, `failed`, `skipped`, `not_run`, `inconclusive`, `stale`, `waived`) and terminal delivery states (`verified`, `partial`, `blocked`, `unverified`). Every gate decision is derived from the contract, policy, evidence freshness, and unresolved findings.

## Consequences

- Reports are more nuanced than a single green/red result.
- The gate engine and state machine require thorough negative tests.
- Human-approved exceptions remain visible and do not rewrite the evidence history.

## Revisit when

Pilot workflows demonstrate a required terminal state not covered by the model.
