#!/bin/sh
# Remove one person's generated (not yet reviewed/committed-as-final) outputs
# after a failed finish run, keeping the draft. Never touches other people.
set -e
N=$1; cd "$(dirname "$0")/.."
[ -f results.$N-$N.v1.json ] && { echo "results exist; use rework.py"; exit 1; }
rm -f drafts/$N.combined.raw.md drafts/$N.combined.search-log.json drafts/$N.combined.capture.json drafts/$N.analysis* drafts/$N.soul* drafts/$N.stats.json drafts/$N.statsAnalysis.md reviews/$N.* claude/specs/$N.json
echo reset $N
