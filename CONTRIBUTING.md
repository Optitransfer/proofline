# Contributing

## Current phase

The repository is a planning baseline. Changes to scope, requirements, architecture, security, or acceptance criteria should be explicit and traceable.

## Change process

1. State the problem and the requirement(s) affected.
2. Record assumptions and exclusions.
3. Update the relevant specification and, if needed, an ADR.
4. Add or update conformance cases for behaviour changes.
5. Update the roadmap and changelog when status or commitments change.
6. Do not label a capability implemented until code and repeatable evidence exist.

## Design review checklist

- Does the change preserve the separation between agent claims and independent evidence?
- Can it be used without HiveVault?
- Does it distinguish pass, fail, skipped, not run, and inconclusive?
- Does it introduce unbounded retries, hidden side effects, or excessive interruption?
- Are permission boundaries and secret handling explicit?
- Can the outcome be reproduced from the report and captured revision?
