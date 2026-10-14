# 14 — Metrics and evaluation

## Primary product question

Does Proofline catch meaningful omissions and unsupported completion claims at an acceptable cost in latency, false blocks, and user attention?

## Metrics

| Metric | Definition | Why it matters |
|---|---|---|
| Verified omission catches | Confirmed missing requirements caught before delivery | Core value |
| False completion claims blocked | Delivery claims contradicted by evidence | Trust value |
| False-positive blocks | Blocks later judged unnecessary or incorrect | Adoption risk |
| Missed defects/omissions | Known pilot issues not detected | Reliability risk |
| Mandatory evidence coverage | Mandatory criteria with fresh, sufficient evidence / all mandatory criteria | Traceability |
| Stale-evidence rejection rate | Stale evidence correctly prevented from satisfying gates | Evidence freshness |
| Mean verification latency | Time added by verification, split by deterministic and model-assisted steps | Workflow cost |
| Interruptions per task | Agent/user interruptions introduced by the tool | Usability |
| Corrective cycles | Number of guidance/retry cycles per run | Loop/noise risk |
| Human review burden | Minutes spent reviewing findings and reports | Adoption |
| Reproducible decision rate | Decisions replayed from captured contract/policy/evidence with same result | Auditability |

## Pilot design

- Select a representative set of real tasks, including known failure examples.
- Establish expected acceptance criteria before running the agent.
- Compare normal agent workflow with observe mode first.
- Label each finding as true positive, false positive, duplicate, or inconclusive.
- Measure total added time and user intervention.
- Include cases where the agent succeeds cleanly; do not evaluate only failures.
- Do not claim statistical generality from a small pilot.

## Initial go/no-go

No numerical threshold is asserted before baseline data exists. The pilot should agree thresholds in advance for:
- minimum confirmed useful catches;
- maximum false-positive block rate;
- maximum added latency;
- maximum user review burden;
- no tolerance for a false `verified` status in the mandatory negative fixtures.
