# Length gate on a draft before expansion/split: analysis >= 2600, soul >= 1800,
# each stats reason >= 150 visible characters (links collapsed, no whitespace).
import re,sys
n=sys.argv[1]; t=open(f'analysis-batch-51-100/drafts/{n}.combined.draft.md',encoding='utf-8').read()
v=lambda x: len(re.sub(r'\s','',re.sub(r'\]\([^)]*\)',']',x)))
body=t.split('\n',1)[1]; a,rest=body.split('<!-- STATS_REASONS_BEGIN',1); r,s=rest.split('analysisStats -->',1)
rs=[v(x) for x in re.split(r'\n### (?:統率|武力|智謀|政治|魅力)',r)[1:]]
ok=v(a)>=2600 and v(s)>=1800 and min(rs)>=150
print(n,'analysis',v(a),'soul',v(s),'reasons',rs,'OK' if ok else 'SHORT'); sys.exit(0 if ok else 1)
