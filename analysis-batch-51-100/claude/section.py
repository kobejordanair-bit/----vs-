# Print only the part of a draft that is needed, instead of reading the whole file.
# Usage (repo root): python3 -I analysis-batch-51-100/claude/section.py NN WHAT [WHAT ...]
#   WHAT = stats | open | 1..5 (analysis sections) | 統率..魅力 | 說話邏輯..內在裂縫 | /關鍵字 (matching lines)
#   add --short to cut every printed line to 160 characters
import re, sys
n, *what = sys.argv[1:]; short = '--short' in what; what = [w for w in what if w != '--short']
t = open(f'analysis-batch-51-100/drafts/{n}.combined.draft.md', encoding='utf-8').read()
lines = t.split('\n')
SOUL = ['說話邏輯', '壓力反應', '核心驅動', '慣性盲點', '情感結構', '參照系', '內在裂縫']
def block(start, stop):
    i = next((k for k, l in enumerate(lines) if start(l)), None)
    if i is None: return []
    j = next((k for k in range(i + 1, len(lines)) if stop(lines[k])), len(lines))
    return [f'{k+1}: {lines[k]}' for k in range(i, j) if lines[k].strip()]
out = []
for w in what:
    if w == 'stats': out += [lines[0]]
    elif w == 'open': out += block(lambda l: l.strip() and not l.startswith('{'), lambda l: l.startswith('---'))
    elif w.isdigit(): out += block(lambda l, w=w: l.startswith(f'### **{w}.'), lambda l: l.startswith('### **') or l.startswith('<!--'))
    elif w in ('統率', '武力', '智謀', '政治', '魅力'):
        out += block(lambda l, w=w: l.startswith(f'### {w}：'), lambda l: l.startswith('### ') or l.startswith('<!--'))
    elif w in SOUL: out += block(lambda l, w=w: l.startswith(f'【{w}】'), lambda l: l.startswith('【') or l.startswith('<!--'))
    elif w.startswith('/'): out += [f'{k+1}: {l}' for k, l in enumerate(lines) if w[1:] in l]
    else: sys.exit(f'unknown section {w}')
for l in out: print(l[:160] if short else l)
