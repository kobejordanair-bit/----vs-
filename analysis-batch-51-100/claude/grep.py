# Usage: python3 -I grep.py BOOK TITLE PATTERN [PATTERN...]  -> short contexts
import json,re,sys
book,title,*pats=sys.argv[1:]
d=json.load(open(f'backend/static/data/history/archive-books/{book}.json'))
docs=[x for x in d['documents'] if x['title']==title or (title.endswith('*') and x['title'].startswith(title[:-1]))]
for doc in docs:
  t=re.sub(r'〔[^〕]*〕','',doc['text'])
  for p in pats:
    for m in list(re.finditer(p,t))[:3]:
      print(f"{doc['title']}|{p}|",t[max(0,m.start()-40):m.end()+40].replace('\n',' '))
