# Pilot plan

## Purpose

Evaluate whether Proofline catches real omissions and false completion claims without excessive false blocks or workflow cost.

## Preparation

- Choose a small set of representative coding tasks.
- Write and freeze task contracts before implementation begins.
- Identify expected outcomes and known edge cases.
- Record baseline completion time and user review burden without Proofline.
- Define pilot labels and go/no-go thresholds before reviewing results.

## Run sequence

1. Run observe mode on a normal task.
2. Capture contract, adapter events, revision changes, checks, findings, and report.
3. Independently label each finding as true positive, false positive, duplicate, or inconclusive.
4. Repeat with a deliberately seeded omission or unsupported claim in a controlled fixture.
5. Only after observe-mode behaviour is understood, test guide mode with bounded corrective cycles.
6. Test enforce mode on synthetic fixtures before any real workflow can be blocked.
7. Compare latency, interruptions, review burden, and useful catches against baseline.

## Pilot exit

- Mandatory negative fixtures produce expected non-verified outcomes.
- No false `verified` status is observed in the pilot set.
- Useful catches are demonstrated on realistic tasks.
- False blocks and review burden are measured, not guessed.
- Limitations, missed cases, and next decision are written down.
