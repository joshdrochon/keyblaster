#!/bin/sh
# Pre-commit gate. Installed to .git/hooks/pre-commit by scripts/install-hooks.sh.
#
# WHY THIS EXISTS. Every lane brief asked agents to run the suite before
# reporting, and asking is not enforcing: a change that silently broke an
# existing test could still reach a commit, and the whole point of 1900 unit
# tests is that they are a gate, not a report.
#
# Fast on purpose - typecheck plus the unit suite, no coverage, no e2e. If this
# takes more than ~30s it will get bypassed, and a bypassed gate is no gate.
set -e

echo "pre-commit: typecheck"
npx tsc --noEmit

echo "pre-commit: unit suite"
npx vitest run tests/unit --coverage.enabled=false --reporter=dot

echo "pre-commit: trace-check"
node scripts/trace-check.mjs >/dev/null

echo "pre-commit: green"
