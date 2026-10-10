# Usage: python3 -I mkspec.py NN < partial.json
# Merges claude/specs/NN.quotes.json (archive quotes verified by quotes.py)
# into the partial spec (webSearches, extraSources, limits, checks) and
# writes claude/specs/NN.json (never overwrites).
import json,sys
n=sys.argv[1]; B='analysis-batch-51-100/claude/specs'
s=json.load(sys.stdin)
s={'webSearches':s['webSearches'],'archiveChecks':json.load(open(f'{B}/{n}.quotes.json',encoding='utf-8')),'pageReads':[],
   'extraSources':s.get('extraSources',{}),'limits':s['limits'],'checks':s['checks']}
open(f'{B}/{n}.json','x',encoding='utf-8').write(json.dumps(s,ensure_ascii=False,indent=1)+'\n'); print('spec',n,len(s['archiveChecks']))
