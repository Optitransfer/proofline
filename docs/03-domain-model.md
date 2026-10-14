# 03 — Domain model and terminology

## Core entities

- **Task contract:** accepted statement of scope, acceptance criteria, exclusions, constraints, required checks, risk tier, and approval rules.
- **Run:** one bounded attempt to fulfil one frozen contract against a repository/workspace revision.
- **Event:** timestamped observation from an adapter, runner, repository inspector, or human action.
- **Evidence record:** normalized, attributable record of a check, diff, claim, approval, or observation.
- **Requirement link:** mapping from a requirement to one or more implementation and verification records.
- **Finding:** a discrepancy, risk, failure, omission, or ambiguity produced by a verifier.
- **Exception:** explicit, attributable acceptance of a known gap or policy deviation.
- **Gate decision:** a deterministic decision derived from contract, policy, evidence freshness, and findings.
- **Delivery report:** portable summary of the decision, evidence, requirements coverage, exceptions, and residual risks.

## Trust distinctions

| Item | What it can establish | What it cannot establish alone |
|---|---|---|
| Agent statement | The agent asserted something | That the assertion is true |
| Exit code | A process returned a status | That the command tested the right property |
| Test output | A test produced the recorded output | That test coverage is sufficient |
| Git diff | Files changed between revisions | That all changes are justified |
| Hash/signature | Record integrity/authorship under key assumptions | Semantic correctness of the underlying work |
| Human approval | A named actor accepted a stated risk/scope | That the risk no longer exists |

## Required result vocabulary

- `passed`: the configured check ran and met its explicit success condition.
- `failed`: the configured check ran and did not meet its success condition.
- `skipped`: the check was deliberately not run; reason required.
- `not_run`: no execution evidence exists for this check.
- `inconclusive`: the check ran but could not establish pass or fail.
- `stale`: evidence applies to a different or superseded revision/context.
- `waived`: an authorized actor explicitly accepted a named gap; never equivalent to passed.

## Terminal delivery states

- `verified`: all mandatory requirements and gates have fresh sufficient evidence; no unresolved mandatory finding remains.
- `partial`: useful work is delivered, but one or more requirements remain incomplete or waived and are clearly reported.
- `blocked`: a mandatory gate, policy, or dependency prevents delivery.
- `unverified`: there is insufficient evidence to determine whether the contract was met.

The system must never infer `verified` merely because the agent stopped or returned a success message.
