# Usage: python3 -I quotes.py NN BOOK:TITLE [BOOK:TITLE...]
# Lists every 「」 quote (>=5 chars, split on ……) in the draft and which
# archive document contains it verbatim; prints JSON archiveChecks to stdout
# file analysis-batch-51-100/claude/specs/NN.quotes.json for spec assembly.
import json,re,sys
n,*docs=sys.argv[1:]
s=open(f'analysis-batch-51-100/drafts/{n}.combined.draft.md',encoding='utf-8').read()
texts=[]
for d in docs:
  book,title=d.split(':',1)
  j=json.load(open(f'backend/static/data/history/archive-books/{book}.json'))
  t=[x for x in j['documents'] if x['title']==title][0]['text']
  texts.append((book,title,re.sub(r'〔[^〕]*〕','',t)))
  texts.append((book,title,re.sub(r'[〔〕]','',t)))  # commentary fallback
out=[];miss=[]
for q in re.findall(r'「([^」]{5,})」',s):
  for p in q.split('……'):
    p=p.strip('。，、；：！？ ')
    if len(p)<5: continue
    hit=next(((b,t) for b,t,x in texts if p in x),None)
    if hit:
      if not any(o['quote']==p for o in out): out.append({'book':hit[0],'title':hit[1],'quote':p})
    elif p not in miss: miss.append(p)
json.dump(out,open(f'analysis-batch-51-100/claude/specs/{n}.quotes.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
print(len(out),'verified'); [print('MISS',m) for m in miss]
