# Decomposition: from a scope file to a signed contract

This is the one process for turning a piece of scoped work into Proofline tasks. It is the same for every project. Builders write and decompose scope files. The contract owner (or whoever holds the owner key) folds and signs. Nobody edits `proofline.json` by hand.

```text
scope file ──decompose──▶ proposal JSON ──validate + coverage──▶ proposal PR (proofline.json untouched)
     ▲                                                                      │
     └──────────── amend the scope file, never the proposal ◀─── review ───┤
                                                                            ▼ owner's go
                       verify-sig ◀── contract sign ◀── contract merge (the fold), on a sign branch
```

## 1. Write a scope file

A scope file is JSON (the CLI has no runtime dependencies, so there is no YAML parser). It lives in the repository next to the contract it feeds, for example `docs/scopes/<name>.scope.json`, and it is the source of truth for those tasks: to change a task, change the scope file and decompose again.

```json
{
  "schema": "proofline-scope/1",
  "prefix": "EX",
  "pad": 2,
  "proposal": { "about": "What this batch of work is", "proposed_by": "OWNER" },
  "owner_rules": ["Each task closes only on the evidence its criteria name."],
  "defaults": { "phase": "implement", "owner": "OWNER", "scope": ["src/**", "test/**"] },
  "prepend": { "stop_rules": ["If a criterion cannot pass, STOP and report what blocks it."] },
  "append": { "requirements": ["REQ-QUALITY"], "criteria": ["scope", "pushed"] },
  "external": [],
  "tasks": [
    {
      "n": 1,
      "title": "Greeting function",
      "requirements": ["REQ-GREET"],
      "description": "greet(name) returns a greeting.",
      "acceptance": [
        { "statement": "The new test fails on the base and passes now",
          "verifier": { "type": "test_red_green", "test_file": "test/greet.test.mjs", "cmd": "node --test {test}" } },
        { "statement": "suite green", "cmd": "npm test", "timeout_s": 120 }
      ]
    },
    { "n": 2, "title": "Command-line entry point", "depends_on": [1], "acceptance": [ "..." ] }
  ]
}
```

A complete toy example is `fixtures/decompose/example-project.scope.json`, with its output in `fixtures/decompose/example-project.proposal.json`.

| Key | Meaning |
| --- | --- |
| `schema` | Always `proofline-scope/1`. |
| `prefix`, `pad` | A task with `n` gets the id `<prefix>-<n padded to pad digits>` (pad defaults to 2: `EX-01`). A task may give `id` instead; ids match `[A-Za-z][A-Za-z0-9-]*`. |
| `proposal` | Header fields copied into the proposal as they are (`about`, `proposed_by`, `target`, anything else). `schema`, `status`, `owner_rules` and `tasks` are written by decompose and may not be set here. |
| `owner_rules` | Rules `contract merge` adds to the contract when they are not already there. |
| `defaults` | `phase` (default `implement`), `owner`, `scope`, `stop_rules`, and `fields`: used when a task does not set them. |
| `prepend`, `append` | Lists put before or after every task's own `requirements`, `scope`, `criteria` (acceptance) and `stop_rules`. A task opts out with `"inherit": false`, or keeps only some with `"inherit": ["stop_rules"]`. |
| `external` | Ids of tasks that already exist elsewhere and may be named in `depends_on`. `--against <contract>` does the same from a file. |
| `tasks[]` | `id` or `n`, `title`, `phase`, `owner`, `depends_on` (ids, or numbers that take the prefix), `requirements`, `description` (a string, or a list of strings joined with a space), `scope` (a list of path patterns, or `{ "allow": [...] }` with any other keys kept), `acceptance`, `stop_rules`, `fields` (extra task keys kept as they are, such as an estimate), `inherit`. |

An acceptance item is one of:

- `"scope"` or `"pushed"`: the standard scope and pushed criteria, with the same statements `contract scaffold` uses.
- `{ "statement": "...", "cmd": "...", "expect_exit": 0, "timeout_s": 120 }`: a command criterion.
- `{ "statement": "...", "verifier": { "type": "...", ... } }`: any verifier Proofline knows (`command`, `test_red_green`, `test_exists`, `metric`, `grep`, `wiring`, `scope`, `docs`, `pushed`, `file_exists`).

Each criterion gets the id `<task>-AC01`, `<task>-AC02`, ... in order (prepended items first, appended items last), unless it gives its own `id`. `mandatory` defaults to true. Any other key on an item is kept. In every string, `{task}` becomes the task id, so a shared criterion in `append` can name the task it lands in. `{test}` and every other placeholder are left alone.

A task with no stop rules gets the default stop rules `contract scaffold` uses.

## 2. Decompose

```sh
proofline contract decompose docs/scopes/<name>.scope.json --out docs/proposals/<name>.json --against proofline.json
```

- The output is an unsigned proposal: `{ "schema": "proofline/1", "status": "proposed", <proposal header>, "owner_rules": [...], "tasks": [...] }`. Task keys come in a fixed order (`id`, `title`, `phase`, `owner`, `depends_on`, `requirements`, `description`, the extra fields, `scope`, `criteria`, `stop_rules`), with two-space indentation and a final newline. The same scope always gives the same bytes, however the scope file is formatted. The command prints the sha256 of those bytes and the task ids. Without `--out` it prints the proposal.
- It refuses, and writes nothing, when an id appears twice in the scope or already exists in an `--against` contract, a dependency is not in the scope, `--against` or `external`, the tasks form a cycle, or a task would fail `contract validate` (no scope criterion, no stop rules, a criterion path outside the task scope, an expanding `sh -c`). `--lint-warn` turns the `contract validate` findings into warnings, for a contract that already carries tasks of that shape; a structural error is still a refusal.
- It never writes `proofline.json`, any file named `proofline.json`, or a `.sig` file. Reading `--against` is read-only.
- `--check` compares the generated bytes with the `--out` file and exits 1 when they differ, without writing. CI uses it to prove every committed proposal is the output of its committed scope file.

## 3. Validate and check coverage

```sh
proofline contract decompose docs/scopes/<name>.scope.json --out docs/proposals/<name>.json --against proofline.json --check
proofline contract coverage REQUIREMENTS.md --contracts proofline.json,docs/proposals/<name>.json
```

Coverage reads requirement ids from lines of the form `- ID: text` and prints, per id, the tasks that name it or `MISSING`. Fix gaps in the scope file and decompose again.

## 4. Open the proposal PR

Commit the scope file and the proposal in one PR titled `Propose <ids> (unsigned)`. The PR adds or changes only the scope file and `docs/proposals/<name>.json`. It never touches `proofline.json` or `proofline.json.sig`; a proposal folded into an unsigned contract leaves main unsigned, and the gate refuses every task until the owner signs again.

Review comments are answered by editing the scope file and decomposing again, never by editing the proposal JSON.

## 5. Owner's go, then fold

After the owner approves the proposal, the fold happens on a separate branch, in one place, with one tool:

```sh
git switch -c sign/<name>
proofline contract merge docs/proposals/<name>.json --owners OWNER=<owner name>
proofline contract validate
```

`merge` appends the tasks and any new owner rules, keeps every existing byte of `proofline.json`, refuses a duplicate id and leaves the file untouched when it does, and prints the sha256 of the result. `--owners` maps the placeholder owner in the scope to a real name. Fold several proposals by running `merge` once per proposal, in the order they were approved. Do not fold with a script, an editor or a re-serialiser: every other way of folding produces different bytes for the same tasks, and the review diff stops being readable.

## 6. Sign and verify

```sh
proofline contract sign
proofline contract verify-sig
```

Commit `proofline.json` and `proofline.json.sig` together, with the sha256 `merge` printed in the commit message, and open the sign PR. Where Proofline's git hooks are installed, that commit also needs the owner's approval marker for the new `proofline.json` bytes (README, Git hooks). Only the owner key signs. Once `guard/owner.pub` is pinned, `next`, `verify`, `gate` and the hooks refuse a contract whose signature is missing or does not match.

## Amending a task that is already in the contract

`decompose` and `merge` only add tasks. A proposal header may describe changes to existing tasks (any extra header key is carried as it is), but `merge` does not apply them, and a fold that runs `merge` alone leaves them out. A change to an existing task is a contract change:

1. On the sign branch, after the merges, edit the named fields of `proofline.json` exactly as the proposal states them, and nothing else.
2. `proofline contract propose` writes the diff against HEAD to `.proofline/proposals/<sha256>.diff` and prints the hash. Put that diff in the sign PR, so the owner reviews exactly those bytes.
3. `validate`, `sign` and `verify-sig` as above. The sign PR description lists every change it applied, so a reviewer can tick each one off against the proposal.

## Roles

| Who | Does | Never |
| --- | --- | --- |
| Builder (any agent or person) | writes or amends a scope file, runs `decompose`, `--check`, `coverage`, opens the proposal PR | edits `proofline.json` or a `.sig`, folds, signs |
| Reviewer | reviews the scope file and the proposal diff, asks for changes in the scope file | approves its own proposal |
| Owner | gives the go on a proposal | |
| Signer (holds the owner key) | runs `merge` on a sign branch, then `validate`, `sign`, `verify-sig`, and opens the sign PR | folds any other way, changes task content while folding |

## CI

This job checks, on every PR, that each committed proposal is the current output of its scope file and that each contract validates and carries a valid owner signature. Adjust the paths to the repository layout; the example keeps scope files in `docs/scopes/` and proposals in `docs/proposals/`.

```yaml
name: contracts
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --global @optitransfer/proofline
      - name: Every proposal is the output of its scope file
        run: |
          set -e
          for s in docs/scopes/*.scope.json; do
            [ -e "$s" ] || continue
            n=$(basename "$s" .scope.json)
            proofline contract decompose "$s" --out "docs/proposals/$n.json" --check
          done
      - name: The contract validates
        run: proofline contract validate
      - name: The contract carries the owner signature
        run: proofline contract verify-sig
      - name: Requirements are covered
        if: hashFiles('REQUIREMENTS.md') != ''
        run: proofline contract coverage REQUIREMENTS.md
```

A proposal that depends on tasks already in the contract needs `--against proofline.json` in the check step, or the ids in the scope's `external` list. For a repository with several contracts in subdirectories, run validate and verify-sig once per contract. Both read `proofline.json` (and verify-sig also `proofline.json.sig` and `guard/owner.pub`) under `--root <dir>`. When the contracts share one pinned key at the repository root, give each check a directory that holds those three files:

```sh
set -e
for c in docs/contracts/*/proofline.json; do
  d=$(dirname "$c"); t=$(mktemp -d)
  mkdir -p "$t/guard"
  cp "$c" "$c.sig" "$t/" && cp guard/owner.pub "$t/guard/"
  echo "== $d"
  proofline contract validate --root "$t"
  proofline contract verify-sig --root "$t"
done
```
