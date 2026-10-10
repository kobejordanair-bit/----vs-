#!/bin/sh
# After drafts/NN.combined.draft.md and claude/specs/NN.json exist: expand
# links, split/review/assemble via finish.mjs, rebuild evidence from files.
set -e
N=$1; cd "$(dirname "$0")/../.."
python3 -I analysis-batch-51-100/claude/precheck.py $N
python3 -I analysis-batch-51-100/claude/expand.py $N
node analysis-batch-51-100/claude/finish.mjs $N https://claude.ai/code/session_01PscgfWeyrToHxVpdJ8CXgT
node -e "import('./analysis-batch-51-100/import.mjs').then(async m=>{const b=JSON.parse(require('fs').readFileSync('analysis-batch-51-100/results.$N-$N.v1.json','utf8'));console.log('evidence',await m.validateBatch50Evidence({batch:b}))})"
