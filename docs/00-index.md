# Documentation index

This is the source of truth for the Proofline design. Requirements are normative where marked **MUST**; roadmap dates and implementation details remain provisional until explicitly accepted.

## Product and design

- [01 — Scope and product brief](01-scope.md)
- [02 — Requirements](02-requirements.md)
- [03 — Domain model and terminology](03-domain-model.md)
- [04 — Architecture](04-architecture.md)
- [05 — Task lifecycle and state machine](05-lifecycle.md)
- [06 — Verification and reconciliation](06-verification.md)
- [07 — Evidence model](07-evidence.md)
- [08 — Agent adapters](08-adapters.md)
- [09 — Security and trust boundaries](09-security.md)

## Delivery and validation

- [10 — Test and conformance strategy](10-conformance.md)
- [11 — Development and release pipeline](11-development-pipeline.md)
- [12 — Roadmap](12-roadmap.md)
- [13 — Interdependencies](13-interdependencies.md)
- [14 — Metrics and evaluation](14-metrics.md)
- [Decomposition: from a scope file to a signed contract](DECOMPOSITION.md)

## Decisions and examples

- [Architecture decision records](adr/)
- [Example task contract](../examples/demo-contract/proofline.json)
- [Change log](../CHANGELOG.md)

## Status vocabulary

| Status | Meaning |
|---|---|
| `planned` | Defined but not implemented |
| `in_progress` | Active implementation; not yet accepted |
| `implemented` | Code exists; tests may still be incomplete |
| `verified` | Required checks passed and evidence is available for the identified revision |
| `blocked` | A mandatory gate or dependency prevents progress |
| `partial` | Some requirements are met; remaining gaps are explicit |
| `unverified` | Evidence is absent, stale, inconclusive, or insufficient |

A status label is not a substitute for evidence. In particular, `implemented` is not equivalent to `verified`.
