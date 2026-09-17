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

echo "pre-commit: no-user-quotes"
node scripts/no-user-quotes.mjs >/dev/null

echo "pre-commit: trace-check"
node scripts/trace-check.mjs >/dev/null

# Regenerate the ticket board so docs/tickets.md can never be older than the
# commit it describes. Deliberately NOT --check: a FALSE-PASS ticket records a
# defect we already know about and have not fixed yet, and blocking every commit
# on that would just get the hook bypassed. The board being CURRENT is the gate;
# `npm run tickets:check` is the one that fails on unfinished work.
echo "pre-commit: tickets"
node scripts/tickets.mjs >/dev/null
# The board is generated and NO LONGER TRACKED - it is internal process record
# and the repo ships to the judges. Regenerating it still matters (a stale board
# is a lying board), but it is not staged, and `git add` on an ignored path
# fails the hook. See .gitignore.

echo "pre-commit: green"
