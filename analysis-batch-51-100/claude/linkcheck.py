# Every @book:title archive link in drafts/NN.combined.draft.md must have at
# least one quote verified by quotes.py (claude/specs/NN.quotes.json), or
# finish.mjs will reject the link as an unreviewed source.
import json,re,sys
n=sys.argv[1]
t=open(f'analysis-batch-51-100/drafts/{n}.combined.draft.md',encoding='utf-8').read()
links={l.replace('_',' ') for l in re.findall(r'\(@[a-z]+:([^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)',t)}
q={x['title'] for x in json.load(open(f'analysis-batch-51-100/claude/specs/{n}.quotes.json',encoding='utf-8'))}
bad=sorted(links-q); print('unquoted links:',bad); sys.exit(1 if bad else 0)
