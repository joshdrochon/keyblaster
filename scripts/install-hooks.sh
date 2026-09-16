#!/bin/sh
# Git hooks are not versioned, so this installs them from scripts/.
# Run once per clone:  sh scripts/install-hooks.sh
set -e
root="$(git rev-parse --show-toplevel)"
ln -sf ../../scripts/precommit.sh "$root/.git/hooks/pre-commit"
echo "installed: .git/hooks/pre-commit -> scripts/precommit.sh"
