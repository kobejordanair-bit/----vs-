#!/bin/sh
# Revision of an already assembled person (after editing drafts/NN.combined.draft.md):
# archive old outputs as attempt K, re-verify quotes against the same archive
# documents, rebuild the spec from the old one plus $S/NN.delta.json
# (new webSearches appended, extraSources merged, limits/checks replaced),
# then run the normal finish pipeline. Usage: revise.sh NN K "reason"
set -e
N=$1; K=$2; R=$3; cd "$(dirname "$0")/../.."; B=analysis-batch-51-100
S=/tmp/claude-0/-home-user/19f09199-a4a3-5668-9a0e-17b33a1530b1/scratchpad
python3 -I $B/claude/precheck.py $N
[ -d $B/attempts/$N.combined.$K ] || python3 -I $B/claude/rework.py $N $K "$R"
DOCS=$(python3 -I -c "import json,sys;print(' '.join(sorted({d['book']+':'+d['title'] for d in json.load(open('$B/claude/specs/$N.quotes.json'))})))")
EXTRA=$(cat $S/$N.docs 2>/dev/null || true)
[ -z "$DOCS$EXTRA" ] || python3 -I $B/claude/quotes.py $N $DOCS $EXTRA
python3 -I - $N $S/$N.delta.json <<'PY'
import json,sys
n,d=sys.argv[1:]; B='analysis-batch-51-100/claude/specs'
old=json.load(open(f'{B}/{n}.json',encoding='utf-8')); delta=json.load(open(d,encoding='utf-8'))
old['webSearches']+=delta.get('webSearches',[]); old['extraSources'].update(delta.get('extraSources',{}))
for u in delta.get('dropSources',[]): old['extraSources'].pop(u,None)
for k in ('limits','checks'):
  if k in delta: old[k]=delta[k]
old['limits']+=delta.get('appendLimits',[])
for task,m in delta.get('appendChecks',{}).items():
  for cid,txt in m.items():
    row=next((r for r in old['checks'][task] if r[0]==cid),None)
    if row: row[1]+=txt
    else: old['checks'][task].append([cid,txt])
old['archiveChecks']=json.load(open(f'{B}/{n}.quotes.json',encoding='utf-8'))
open(f'{B}/{n}.json','w',encoding='utf-8').write(json.dumps(old,ensure_ascii=False,indent=1)+'\n'); print('respec',n,len(old['archiveChecks']))
PY
sh $B/claude/run.sh $N
