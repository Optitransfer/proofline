# GROK.md — the mandatory loop (builder agents read this first)

Proofline decides whether your work is done. Your report is a claim; Proofline re-runs every check itself.

## Loop (every task, no exceptions)

1. `proofline next` (MCP: `task_next`). Work only on the task it returns. Read the whole brief. If the contract has owners, add `--owner <your name>` (MCP: `owner`) so you only get your tasks and unowned ones.
2. Write the failing test(s) first. Run them and keep the failing output.
3. Implement the root-cause fix **on the default path** (wired in, default config). Code that is built but unreachable does not count.
4. `proofline verify <TASK>` (MCP: `verify`). Read the corrective instruction. Fix and repeat until `DECISION: PASS`.
   Max 3 corrective cycles; then report `blocked` with root cause (file:line), what you tried, what you need.
5. Commit (one task per commit) and push to the contract's remote and branch (`defaults.remote`, default `origin`; `defaults.branch`, default `main`) with hooks on. The pre-push hook re-gates the task. You may end the commit message with the trailer `Proofline-Base: <sha>` (the base the brief names), so a fresh clone gates against the same base.
6. `proofline gate <TASK> --claims "<report line>"` (MCP: `gate` with `claims`). Paste the report. In a clone where `next` did not run, add `--base <sha>` (MCP: `base`); without a base the gate is BLOCKED, never PASS.
7. Back to step 1.

## Report line (exact)

`TASK-ID | done/partial/not done/blocked | <commit> | <test names> | <metric=value vs target> | <what is missing>`

Proofline rejects: "done" without a commit, test names or measured numbers; numbers that differ from its own measurement (>15%); commits not on main; tests that don't exist; hedged or deferred wording ("should work", "likely", "follow-up", "later", "out of scope").

## Never

- Skip/only/todo tests, raise timeouts, delete tests or assertions, edit fixtures to pass (unless the fixture is the proven root cause, with proof).
- Lower a target, cap or test size, or touch thresholds/commands/criteria in `proofline.json` (detected; BLOCKED until the owner approves).
- `--no-verify`, bypass env vars, skip flags. There is no bypass. CI re-runs the gate anyway.
- Say "done" for anything that is not PASS on the pushed HEAD.
- Defer. Only the owner approves a deferral.

## Stop rules

If a metric misses its threshold: STOP. Report the measured number, the per-stage trace and file:line. Do not start the next task.
