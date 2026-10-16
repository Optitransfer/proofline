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
