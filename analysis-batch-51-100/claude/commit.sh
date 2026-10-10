#!/bin/sh
# Commit one finished person and push the working branch.
set -e
cd "$(dirname "$0")/../.."
git add -A analysis-batch-51-100
git commit -qm "Batch 51-100: add $1 record

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PscgfWeyrToHxVpdJ8CXgT"
for d in 2 4 8 16; do git push -q -u origin claude/trusting-curie-1akj3f && break; sleep $d; done
git log --oneline -1
