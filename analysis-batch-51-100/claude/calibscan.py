# Scan every stats reason for 「name（number）」 comparisons and check the number
# against the frozen calibration table (stats-reference.v1.json) for the same
# dimension. Batch-51-100 people are checked against their own draft stats.
import json,re,glob
ref=json.load(open('analysis-batch-51-100/stats-reference.v1.json'))['records']
D=['統率','武力','智謀','政治','魅力']; table={}
for r in ref: table.setdefault(r['name'],[]).append((r['type'],r['stats']))
for f in sorted(glob.glob('analysis-batch-51-100/drafts/*.combined.draft.md')):
  t=open(f,encoding='utf-8').read(); n=f.split('/')[-1][:2]
  st=json.loads(t.split('\n',1)[0])['stats']; name=re.search(r'STATS_REASONS_BEGIN \w+_(\S+?)_\d+',t).group(1)
  table.setdefault(name,[]).append(('batch',st))
for f in sorted(glob.glob('analysis-batch-51-100/drafts/*.combined.draft.md')):
  t=open(f,encoding='utf-8').read(); n=f.split('/')[-1][:2]
  sec=t.split('<!-- STATS_REASONS_BEGIN',1)[1].split('analysisStats -->')[0]
  for i,part in enumerate(re.split(r'\n### (?:統率|武力|智謀|政治|魅力)',sec)[1:]):
    for nm,num in re.findall(r'([一-鿿]{2,5}?)（(\d{1,3})）',part):
      cands=[(k,s) for key,v in table.items() if nm.endswith(key) for k,s in v]
      if not cands: print(n,D[i],nm,num,'NOT-IN-TABLE'); continue
      if not any(s[i]==int(num) for k,s in cands): print(n,D[i],nm,num,'MISMATCH',[(k,s[i]) for k,s in cands])
