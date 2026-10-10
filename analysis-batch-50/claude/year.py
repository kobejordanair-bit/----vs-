# Usage: python3 -I year.py BOOK TITLE PHRASE...  -> nearest preceding year line
import json,re,sys
b,t,*ps=sys.argv[1:]
x=[y for y in json.load(open(f'backend/static/data/history/archive-books/{b}.json'))['documents'] if y['title']==t][0]['text']
for p in ps:
  i=x.find(p)
  if i<0: print(p,'NOT FOUND'); continue
  hs=re.findall(r'(?:^|\n)\s*([^\n]{0,8}?[元一二三四五六七八九十]+年)',x[:i]); print(p,'->',hs[-1].strip() if hs else None)
