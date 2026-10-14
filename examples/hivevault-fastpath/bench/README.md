# hivevault bench kit
Copy this folder into the repo as bench/ (it's not committed; or add it to .gitignore).
Run from the repo root (Node 22):
  HV_REPO=$PWD BENCH_DIR=/tmp/hvbench node bench/e2e.mjs 4000 47710
  HV_REPO=$PWD BENCH_DIR=/tmp/hvbench node bench/e2e.mjs 10000 47711
Output: /tmp/hvbench/n<N>.json (loop, seal, p50/p95/max and saves/s at 1/8/32 writers, sync, cold start, RSS).
Per-stage trace of one PUT: node bench/hvtrace.mjs (see GROK-INSTRUCTIONS-fastpath.md).
Pass thresholds: seal 4k < 2 s; durable p50 < 20 ms; > 500 saves/s at 32 writers.
