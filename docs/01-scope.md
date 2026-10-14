# 01 — Scope and product brief

## Problem

AI agents can complete a plausible-looking task while omitting requirements, changing behaviour outside the requested scope, skipping mandatory checks, relying on stale assumptions, or overstating what was validated. The same agent that performs the work is not a sufficient independent authority on whether the work meets its contract.

## Product statement

**Proofline is an independent verification and delivery gate for AI-agent work.** It keeps the task contract separate from implementation, records evidence, tests the implementation against the contract, reconciles discrepancies, and reports what can legitimately be claimed at delivery.

## Target user

A developer, technical lead, researcher, or team using coding agents and needing reliable control over scope, validation, and delivery—not just more generated code.

## Primary jobs to be done

1. Turn a request into a reviewable contract with explicit acceptance criteria.
2. Observe work without assuming that narrated progress is accurate.
3. Map each requirement to a change, test, or explicit exception.
4. Execute or independently evaluate required checks under controlled policy.
5. Detect missing coverage, scope drift, contradictory evidence, and unsupported claims.
6. Provide bounded, specific corrective feedback.
7. Produce an auditable delivery decision and portable report.

## Core workflow

1. **Contract:** establish requirements, constraints, exclusions, risk tier, required evidence, and approval rules.
2. **Observe:** capture permitted lifecycle events, commands, diffs, and revision identifiers.
3. **Verify:** run policy-approved checks and independent challenges.
4. **Reconcile:** compare requested, implemented, tested, and reported outcomes.
5. **Correct or escalate:** return specific gaps, retry within configured limits, or request human judgement.
6. **Deliver:** produce status, residual risks, exceptions, and evidence references.

## MVP — in scope

- Local CLI and local task/session state.
- Versioned task-contract schema.
- One deeply supported agent adapter, chosen after a spike.
- Event ingestion with schema validation.
- Evidence ledger with immutable record IDs and revision/environment context.
- Configurable command/check runner with allowlists and timeouts.
- Requirement-to-evidence traceability.
- Reconciliation rules and explicit terminal states.
- Bounded corrective feedback and loop detection.
- Markdown and JSON delivery reports.
- Unit, integration, adapter-contract, and end-to-end tests.
- A standalone mode with no required hosted service or HiveVault dependency.

## Explicitly out of scope for MVP

- A general-purpose multi-agent orchestration platform.
- A hosted SaaS control plane or central telemetry service.
- A mandatory HiveVault integration.
- Automatic approval of production deployment, financial actions, or other irreversible changes.
- A claim that arbitrary natural-language work can be fully proven correct.
- A dashboard before the CLI and evidence model are validated.
- A universal policy pack for every programming language and domain.
- An agent marketplace or broad adapter matrix before one adapter is reliable.

## Product boundaries

- The implementing agent proposes and changes; Proofline evaluates against the accepted contract.
- The user/team owns the contract and can explicitly approve changes to it.
- The verifier may identify a likely defect, but domain-specific correctness still depends on the available oracle and evidence.
- An evidence record establishes what was recorded and under what conditions; it does not automatically establish that the chosen test was sufficient.
- HiveVault may provide prior decisions, but prior context cannot satisfy a current-run verification gate by itself.

## Success criteria for the first pilot

The MVP is worth continuing only if a real workflow shows that it catches meaningful omissions or false completion claims while keeping false blocks, latency, and interruptions tolerable. See [metrics](14-metrics.md).
