# Stats-reason length as the reviewer counts it: link titles kept, URLs,
# markdown marks, headings, tags like [推斷] and whitespace excluded.
import json,re,glob,sys
D=['統率','武力','智謀','政治','魅力']; short=[]
for f in sorted(glob.glob('analysis-batch-51-100/drafts/*.combined.draft.md')):
  t=open(f,encoding='utf-8').read(); n=f.split('/')[-1][:2]
  sec=t.split('<!-- STATS_REASONS_BEGIN',1)[1].split('analysisStats -->')[0]
  for i,part in enumerate(re.split(r'\n### (?:統率|武力|智謀|政治|魅力)',sec)[1:]):
    body=part.split('\n',1)[1] if '\n' in part else ''
    body=re.sub(r'\]\([^)]*\)','',body); body=re.sub(r'\[(史載|推斷|詮釋)[^\]]*\]','',body)
    body=re.sub(r'[\s\*\#\[\]_>|-]','',body.split('<!--')[0])
    if len(body)<150: short.append((n,D[i],len(body)))
print(len(short),'short in',len({s[0] for s in short}),'people'); print(short)
