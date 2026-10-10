# Visible-character counts (links collapsed, whitespace removed) per field.
import re,sys
def n(x): return len(re.sub(r'\s','',re.sub(r'\]\([^)]*\)',']',x)))
for s in sys.argv[1:]:
  a=open(f'drafts/{s}.analysis.md',encoding='utf-8').read(); r=open(f'drafts/{s}.statsAnalysis.md',encoding='utf-8').read(); so=open(f'drafts/{s}.soulEssence.md',encoding='utf-8').read()
  parts=[n(p) for p in re.split(r'\n### (?:統率|武力|智謀|政治|魅力)',r)[1:]]
  print(s,'analysis',n(a),'soul',n(so),'reasons',parts)
