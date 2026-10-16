# Receipt

Without a contract, `receipt` infers the suite from the manifest at the base revision. A change to that command is reported and is not what runs.

| Manifest | Command |
| --- | --- |
| package.json `scripts.test` | that script, else `vitest run` or `jest` when that dev dependency is present |
| Cargo.toml | `cargo test` |
| pyproject.toml `[tool.pytest]` or pytest.ini | `pytest` |
| go.mod | `go test ./...` |
| build.gradle, `*.sln` | no default command, status blocked |

Changed tests are paths under `test/` or `tests/`, or names matching `*_test.*`, `*.test.*`, `*.spec.*` or `test_*.py`. Nothing inferable yields an L0 receipt and exit 2. A missing toolchain is blocked, not a pass.

`verify-receipt` checks the DSSE envelope offline against PEM files in `--keys` (or `$AGENTKEY_HOME/keys`), named `<keyid>.pem`. Exit 0 is verified, 1 is a bad signature, a schema problem or a `--recompute` difference, 2 is an unknown key, and 3 is usage. `--sigstore` is the only path that loads that verifier.

The MCP tools `receipt` and `verify_receipt` return that same JSON. `tools/list` shows nine tools.

`proofline hook stop` reads a Claude Code Stop payload and writes one receipt for the commits that session made. A second run on the same range writes none. `proofline connect claude-code` adds that hook after any Stop hook already in `~/.claude/settings.json`.

When `GET /v1/state/digest` answers within 2 seconds, an L1 receipt gains `memory.vault_digest` and `memory.frontier`. An L2 receipt in ci mode gains only `memory_commitment`, the sha256 of the vault id, the digest and the frontier JSON, so a replica id is not in the receipt. No answer leaves the receipt unchanged. `--vault` writes `work/receipts/<date>-<role>-<sha7>.md` with origin `proofline`.

The weakening check is a warning beside the owner signature. It names a loosened threshold, a removed criterion, or a changed command.
