# Usage: python3 -I fixvariants.py NN BOOK:TITLE [...]
# For each 「quote」 in the draft that is not found verbatim in the given
# archive documents, retry allowing common variant characters (為/爲 etc.).
# If exactly the archive's own wording is found, rewrite the quote in the
# draft to the archive's characters so it can be verified. Prose is untouched.
import json,re,sys
n,*docs=sys.argv[1:]
p=f'analysis-batch-51-100/drafts/{n}.combined.draft.md'
s=open(p,encoding='utf-8').read()
V=['為爲','歲歳','衛衞','說説','戶戸','溫温','群羣','嘆歎','麼麽','裡裏','着著','雞鷄','於于','並竝','峰峯','眾衆','強彊','跡迹','污汙','即卽','既旣','鉤鈎','鑒鑑','冊册','兗兖','冢塚','畫畵','啟啓','麵麪','奸姦','游遊','嘗甞','痴癡','蹟跡','煙烟','館舘','教敎','吳呉','黃黄','錄録','虛虚','殺殺','真眞','鬥鬬','祿禄','異异','綠緑']
alt={}
for v in V:
  for c in v: alt[c]=v
texts=[]
for d in docs:
  book,title=d.split(':',1)
  j=json.load(open(f'backend/static/data/history/archive-books/{book}.json'))
  t=[x for x in j['documents'] if x['title']==title][0]['text']
  texts.append(re.sub(r'〔[^〕]*〕','',t))
fixed=0
for q in set(re.findall(r'「([^」]{5,})」',s)):
  parts=[x.strip('。，、；：！？ ') for x in q.split('……')]
  if all(any(x in t for t in texts) for x in parts if len(x)>=5): continue
  pat=''.join('['+alt[c]+']' if c in alt else re.escape(c) for c in q)
  for t in texts:
    m=re.search(pat,t)
    if m and m.group(0)!=q:
      s=s.replace('「'+q+'」','「'+m.group(0)+'」'); fixed+=1; print('fixed',q,'->',m.group(0)); break
open(p,'w',encoding='utf-8').write(s); print('fixed',fixed)
