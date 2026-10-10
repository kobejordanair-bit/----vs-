# Expand @book:title link shorthands in drafts/NN.combined.draft.md into the
# archive's exact Wikisource URLs, writing drafts/NN.combined.raw.md (never
# overwrites). Purely mechanical; prose is untouched.
import json,re,sys,os
n=sys.argv[1]; src=f'analysis-batch-50/drafts/{n}.combined.draft.md'; dst=f'analysis-batch-50/drafts/{n}.combined.raw.md'
if os.path.exists(dst): sys.exit('raw exists')
t=open(src,encoding='utf-8').read(); cache={}
def url(m):
  book,title=m.group(1),m.group(2)
  d=cache.setdefault(book,json.load(open(f'backend/static/data/history/archive-books/{book}.json')))
  return '('+[x for x in d['documents'] if x['title']==title][0]['sourceUrl']+')'
out=re.sub(r'\(@([a-z]+):([^)\s]+)\)',url,t)
open(dst,'x',encoding='utf-8').write(out); print('expanded',len(re.findall(r'\(@',t)),'links')
