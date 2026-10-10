# Usage: python3 -I urls.py book:title ...  -> markdown-ready source URLs
import json,sys
cache={}
for arg in sys.argv[1:]:
  book,title=arg.split(':',1)
  d=cache.setdefault(book,json.load(open(f'backend/static/data/history/archive-books/{book}.json')))
  doc=[x for x in d['documents'] if x['title']==title][0]
  print(title, doc['sourceUrl'])
