# Flag 「高於／低於 X（n）」 comparisons whose direction contradicts the person's own score.
import json,re,glob
D=['統率','武力','智謀','政治','魅力']
for f in sorted(glob.glob('analysis-batch-51-100/drafts/*.combined.draft.md')):
  t=open(f,encoding='utf-8').read(); n=f.split('/')[-1][:2]; st=json.loads(t.split('\n',1)[0])['stats']
  sec=t.split('<!-- STATS_REASONS_BEGIN',1)[1].split('analysisStats -->')[0]
  for i,part in enumerate(re.split(r'\n### (?:統率|武力|智謀|政治|魅力)',sec)[1:]):
    part=re.sub(r'\]\([^)]*\)',']',part)
    for m in re.finditer(r'(高於|低於)((?:(?!高於|低於)[^。；：])*)',part):
      seg=re.split(r'[，,](?=[^（]*?(?:高於|低於|與|接近))',m.group(2))[0]
      seg=re.split(r'高於|低於|——',seg)[0]
      for x in re.findall(r'（(\d{1,3})(?:[^）]*)）',seg):
        x=int(x); own=st[i]
        if ('高於' in m.group(1) and x>=own) or ('低於' in m.group(1) and x<=own): print(n,D[i],own,m.group(1),seg[:60])
