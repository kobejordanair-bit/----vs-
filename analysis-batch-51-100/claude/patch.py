# Usage: python3 -I patch.py NN < edits.json ; edits = [[anchor, text, "after"|"replace"], ...]
# Applies every edit whose anchor is found once; reports misses instead of aborting.
import json,sys
n=sys.argv[1]; p=f'analysis-batch-51-100/drafts/{n}.combined.draft.md'
t=open(p,encoding='utf-8').read()
for a,b,*m in json.load(sys.stdin):
  if a not in t: print('MISSING ANCHOR:',a[:40]); continue
  t=t.replace(a,(b if m and m[0]=='replace' else a+b),1)
open(p,'w',encoding='utf-8').write(t)
