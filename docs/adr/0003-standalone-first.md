# ADR-0003: Standalone-first, HiveVault optional

- Status: Proposed
- Date: 2026-10-14

## Context

HiveVault can provide persistent project context, but coupling Proofline to it would limit adoption and blur the difference between remembered claims and current evidence.

## Decision

The MVP works locally without HiveVault. Any connector is optional and initially supplies clearly labelled historical context only.

## Consequences

- Standalone use remains possible.
- Cross-run knowledge can be added later without making the core dependent on it.
- Imported context must never satisfy current-run verification gates by itself.
