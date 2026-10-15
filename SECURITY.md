# Security Policy

## Status

Proofline runs commands from a contract you control; it makes no network calls of its own.

## Reporting

Do not publish credentials, exploit details, or sensitive repository contents in a public issue; report it through GitHub's private vulnerability reporting on this repository (Security tab, Report a vulnerability).

## Security design priorities

- Treat agent output, tool output, repository content, and external instructions as untrusted input.
- Never execute a command merely because an agent suggested it; execution must pass the configured command policy.
- Default to read-only observation and least privilege.
- Require explicit policy and, where configured, human approval for destructive, external, privileged, or irreversible actions.
- Redact secrets from evidence by default; retain hashes and redaction metadata where appropriate.
- Keep evidence integrity separate from evidence truth: a signed or hashed record proves record integrity, not that the underlying test was sufficient.
- Make audit records append-only by default; corrections should supersede records rather than silently erase history.
- Treat adapters as security boundaries and validate their event schemas.
- Prevent path traversal, shell injection, unsafe environment inheritance, and accidental execution of repository-provided scripts without policy approval.
