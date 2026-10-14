# CI workflow (to install)

`proofline.yml` is the GitHub Actions self-gate. It could not be pushed into `.github/workflows/` because the CLI token used to create this repo lacks the `workflow` scope. To enable it, either:

- `gh auth refresh -s workflow`, then `git mv ci/proofline.yml .github/workflows/proofline.yml && git commit -m "ci: enable proofline gate" && git push`, or
- add the file in the GitHub web UI at `.github/workflows/proofline.yml`.

It runs `node bin/proofline.mjs gate --ci` on every push to main, with `--base` set to the branch tip before the push (a fresh checkout has no pinned base), and uploads the evidence report.
