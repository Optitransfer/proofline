# ADR-0001: Product boundary and independence

- Status: Accepted
- Date: 2026-10-14

## Context

Agent frameworks already expose hooks and lifecycle events. A thin hook wrapper would be easy to copy and would not solve the central problem: whether the requested work was actually completed and independently verified.

## Decision

Build the product around an accepted task contract, evidence ledger, independent verification, reconciliation, and delivery decision. Hooks/adapters are replaceable integration layers. HiveVault is optional.

## Consequences

Positive:
- Core value is not tied to a single agent.
- Evidence can be exported and audited independently.
- Standalone use is possible.

Trade-offs:
- More upfront design and conformance work than a prompt-only tool.
- Verification quality is limited by the quality of the contract and available oracles.
- The first adapter must be selected carefully to avoid premature generalization.

## Revisit when

Pilot evidence shows that the core abstraction is too heavy, or a specific host imposes lifecycle constraints that materially change the architecture.
