# 10 — Test and conformance strategy

## Test layers

1. **Schema tests:** valid/invalid contracts, event records, evidence records, and reports.
2. **Unit tests:** state machine, freshness, gate decisions, retry limits, traceability, redaction.
3. **Property tests:** deterministic decisions; evidence append/supersede rules; no `verified` state with unmet mandatory gates.
4. **Adapter contract tests:** event normalization, failure behaviour, version compatibility.
5. **Integration tests:** CLI + local workspace + check runner + ledger + report.
6. **End-to-end tests:** realistic agent session with controlled fixtures; no live provider required in default CI.
7. **Adversarial fixtures:** false completion claims, skipped tests, stale test results, scope drift, malformed events, secret output, repeated corrective loops.
8. **Security tests:** command injection attempts, path traversal, environment leakage, oversized output, unsafe symlinks, permission denial.
9. **Usability/pilot tests:** interruption count, false blocks, caught omissions, latency, user review burden.

## Mandatory negative fixtures

| Fixture | Expected result |
|---|---|
| Agent says tests passed; no test evidence exists | Not `verified`; report missing evidence |
| Mandatory test exits non-zero | `blocked` unless authorized policy explicitly defines a different non-verified disposition |
| Mandatory test was skipped | Not `verified` |
| Tests pass on old revision, then relevant code changes | Mark evidence stale and re-run or block |
| Required acceptance criterion has no evidence mapping | Finding; not `verified` |
| Diff changes excluded path or unrelated behaviour | Scope-drift finding |
| Same finding repeats without meaningful change | Stop retry loop |
| Agent claims a file changed but diff does not contain it | Unsupported-claim finding |
| Check output contains a secret-shaped value | Redact before persistence; test redaction metadata |
| Adapter drops an enforcement-critical event | Enforcement cannot silently pass |
| Gate in a fresh clone with no pinned base, where the default base is HEAD | `BLOCKED` with a corrective naming `--base`; never a pass on an empty diff |
| Same gate with `--base <parent>` and a change outside the task's scope | Scope-drift finding |
| Repository already has a pre-push hook that refuses the push | After `init` the push is still refused by that hook; a passing hook hands over to the gate |
| Two builders share a contract with owners | `next --owner a` never returns a task owned by `b`; an owner outside `defaults.owners` fails validation |
| Metric run while the machine's load per CPU is above `defaults.max_load_per_cpu` | `BLOCKED` (machine busy, with the numbers); no measured value recorded |
| Commit adds or amends `proofline.json` with the default deny-list | No forbidden finding in the contract itself; the change is judged by the weakening check |
| `defaults.reuse_results` on (`true`/`false`, default `false`; `defaults.reuse_max_age_h`, a positive number, default 24): `verify` then `gate` on one clean commit | A `command` or `metric` PASS runs once; the gate report lists it under Reused results as `reused from <time> (evidence entry <n>)`, and the gate entry says the same |
| Same, with an uncommitted edit or untracked file, a new commit, `--fresh`, a changed env var the command names, a PASS older than `reuse_max_age_h`, or a log that no longer holds the recording entry intact with its hash | The check runs again |
| Same, where the check FAILs, is flaky, is blocked or cannot run | Nothing is stored; it runs every time |
| `reuse_results` left out or `false` | Every check runs every time; nothing is stored |

## Conformance fixture format

Each fixture should include:
- contract;
- initial and final workspace state or synthetic diff;
- event stream;
- check results;
- agent delivery claims;
- expected findings;
- expected terminal status;
- rationale.

## Release gate

No release candidate may be described as verified until:
- all required CI checks pass;
- all mandatory conformance fixtures pass;
- security-sensitive changes have explicit review;
- release artifacts and checksums are recorded;
- documentation and known limitations match the actual build.
