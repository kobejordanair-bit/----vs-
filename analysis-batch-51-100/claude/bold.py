# Usage: python3 -I bold.py NN "phrase" ["phrase"...]
# Turns the author's own 「phrase」 (not archive quotations) into **phrase**.
import sys
n,*ps=sys.argv[1:]; p=f'analysis-batch-51-100/drafts/{n}.combined.draft.md'
t=open(p,encoding='utf-8').read()
for s in ps:
  assert '「'+s+'」' in t, s; t=t.replace('「'+s+'」','**'+s+'**')
open(p,'w',encoding='utf-8').write(t)
