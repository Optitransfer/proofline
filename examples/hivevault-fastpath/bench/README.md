# hivevault bench kit
Copy this folder into the repo as bench/ (it's not committed; or add it to .gitignore).
Run from the repo root (Node 22):
  HV_REPO=$PWD BENCH_DIR=/tmp/hvbench node bench/e2e.mjs 4000 47710
  HV_REPO=$PWD BENCH_DIR=/tmp/hvbench node bench/e2e.mjs 10000 47711
Output: /tmp/hvbench/n<N>.json (loop, seal, p50/p95/max and saves/s at 1/8/32 writers, sync, cold start, RSS).
Writers: each PUT carries `wait: $WAIT` when WAIT is set (the contract's commands set WAIT=durable, the wait the targets are for); the output records it as `wait`.
Flush: `flushMs` is the time from POST /v1/notes/batch {flush: true, wait: "sealed"} until the vault's git HEAD commit holds every note of the batch with the bytes on disk (seal and commit included); `flushAnswerMs` is the time to the HTTP answer; `flushCommit` is that commit. If no commit holds the batch within 10 minutes, the output has `flushCommitted: 0` and `flushErr`, and no `flushMs`.
Per-stage trace of one PUT: node bench/hvtrace.mjs (see GROK-INSTRUCTIONS-fastpath.md).
Pass thresholds: seal 4k < 2 s; durable p50 < 20 ms; > 500 saves/s at 32 writers.
