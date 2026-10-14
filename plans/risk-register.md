# Initial risk register

| ID | Risk | Likelihood | Impact | Mitigation / evidence required |
|---|---|---|---|---|
| R-01 | Contracts are vague or incomplete | High | High | Contract validation, human review, ambiguity findings |
| R-02 | Verifier creates false confidence from weak tests | High | High | Separate test success from test sufficiency; adversarial fixtures |
| R-03 | Adapter misses critical lifecycle events | Medium | High | Adapter conformance tests; fail closed for enforcement-critical gaps |
| R-04 | Excessive false-positive blocks harm adoption | Medium | High | Observe mode, pilot metrics, explainable findings, calibrated thresholds |
| R-05 | Command runner executes unsafe code | Medium | Critical | Allowlist, structured argv, timeouts, environment filtering, explicit approvals |
| R-06 | Secrets are persisted in logs/evidence | Medium | High | Redaction, output bounds, secret fixtures, no telemetry by default |
| R-07 | Stale evidence passes after code changes | Medium | High | Revision binding and freshness invalidation |
| R-08 | Corrective feedback loops indefinitely | Medium | Medium | Retry budget, repeated-finding detection, escalation |
| R-09 | HiveVault integration couples core too tightly | Medium | Medium | Optional connector; standalone conformance test |
| R-10 | Product adds complexity without measurable value | Medium | High | Pilot go/no-go metrics and deferred dashboard/hosted control plane |
