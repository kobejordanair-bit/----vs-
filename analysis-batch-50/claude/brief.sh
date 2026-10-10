#!/bin/sh
# Person-specific packet parts: role line, preserved deep analysis (verdict
# lines), source-package questions and chapter list. Full texts are queried
# directly from the archive instead of printed.
set -e
N=$1; D=analysis-batch-50
[ -f $D/tasks/$N.combined.json ] || node $D/combined-pilot.mjs compile $N >/dev/null
grep -m1 '角色本位' $D/prompts/$N.combined.prompt.md
echo "=== deep (head)"; head -c ${2:-2500} $D/existing/$N.deepAnalysis.md; echo; grep -A6 '建議定案' $D/existing/$N.deepAnalysis.md || true
echo "=== sources"; sed -n '/^## 本次請實際搜尋/,/^## A｜/p' $D/sources/$N.md; grep -E '^## [A-Z]｜|^- 來源網址|^### ' $D/sources/$N.md
