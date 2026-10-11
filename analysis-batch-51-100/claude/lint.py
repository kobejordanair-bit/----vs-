# Mechanical checks the Codex review caught after the fact, run at drafting time.
# Usage (repo root): python3 -I analysis-batch-51-100/claude/lint.py [NN ...]   (default: all 50)
# ERROR (exit 1): calibration number not in the frozen table for that dimension;
#   「高於／低於 X（n）」 contradicting the person's own score; a dated life/office
#   fact (death, birth, taking office) tagged [推斷].
# WARN: more than 3 「此據搜尋摘要」 process hints; reason shorter than 150 by the
#   reviewer's count (link titles kept; URLs, marks, tags, whitespace excluded).
import json, re, glob, sys
B = 'analysis-batch-51-100'; D = ['統率', '武力', '智謀', '政治', '魅力']
TYPE_HINT = {'帝王條目': 'emperor', '將領條目': 'general', '名臣條目': 'minister'}
table = {}
for r in json.load(open(f'{B}/stats-reference.v1.json', encoding='utf-8'))['records']:
    table.setdefault(re.sub(r'\(.*\)', '', r['name']), []).append((r['type'], r['stats']))
drafts = {f.split('/')[-1][:2]: open(f, encoding='utf-8').read() for f in sorted(glob.glob(f'{B}/drafts/*.combined.draft.md'))}
for n, t in drafts.items():
    m = re.search(r'STATS_REASONS_BEGIN \w+_(\S+?)_\d+', t)
    if m: table.setdefault(m.group(1), []).append(('batch', json.loads(t.split('\n', 1)[0])['stats']))
table.setdefault('蔣中正', table.get('蔣介石', []))
def reasons(t):
    sec = t.split('<!-- STATS_REASONS_BEGIN', 1)[1].split('analysisStats -->')[0]
    return re.split(r'\n### (?:統率|武力|智謀|政治|魅力)', sec)[1:]
def lint(n, t):
    err, warn = [], []
    own = json.loads(t.split('\n', 1)[0])['stats']
    for i, part in enumerate(reasons(t)):
        plain = re.sub(r'\]\([^)]*\)', ']', part)
        for nm, num in re.findall(r'([一-鿿]{2,9}?)（(\d{1,3})）', plain):
            hint = next((v for k, v in TYPE_HINT.items() if nm.endswith(k)), None)
            base = re.sub('|'.join(TYPE_HINT), '', nm)
            cands = [(k, s) for key, v in table.items() if base.endswith(key) for k, s in v if not hint or k == hint]
            if not cands: warn.append(f'{D[i]} {nm}（{num}）不在校準表'); continue
            if not any(s[i] == int(num) for k, s in cands):
                err.append(f'{D[i]} {nm}（{num}）與校準表不符：{[(k, s[i]) for k, s in cands]}')
            elif len({s[i] for k, s in cands}) > 1 and not hint:
                warn.append(f'{D[i]} {nm} 在校準表有多筆不同分數，須標明條目：{[(k, s[i]) for k, s in cands]}')
        for m in re.finditer(r'(高於|低於)((?:(?!高於|低於)[^。；：])*)', plain):
            seg = re.split(r'——|[，,]', m.group(2))[0]
            for x in re.findall(r'（(\d{1,3})）', seg):
                x = int(x)
                if (m.group(1) == '高於' and x >= own[i]) or (m.group(1) == '低於' and x <= own[i]):
                    err.append(f'{D[i]} 自評{own[i]}卻寫「{m.group(1)}{seg[:30]}」')
        body = re.sub(r'\[(史載|推斷|詮釋)[^\]]*\]', '', re.sub(r'\]\([^)]*\)', '', part.split('\n', 1)[-1]))
        body = re.sub(r'[\s\*\#\[\]_>|-]', '', body.split('<!--')[0])
        if len(body) < 150: warn.append(f'{D[i]} 理由 {len(body)} 字（審查口徑）')
    for sent in re.split(r'(?<=[。；])', t):
        if '[推斷]' in sent and re.search(r'(一[九八]|[12]\d{3}|[元二三四五六七八九十]+年)', sent) \
                and re.search(r'(卒於|去世|逝世|病逝|就任|即位|出生|生於|失守|失陷|陷落)', sent.split('[推斷]')[0].split(']')[-1][-60:]):
            err.append(f'日期事實標[推斷]：{sent.strip()[:50]}')
    k = t.count('此據搜尋摘要')
    if k > 3: warn.append(f'「此據搜尋摘要」{k} 處，應移入來源註記')
    return err, warn
if __name__ == '__main__':
    targets = sys.argv[1:] or list(drafts)
    bad = 0
    for n in targets:
        e, w = lint(n, drafts[n])
        for x in e: print(n, 'ERROR', x)
        for x in w: print(n, 'WARN ', x)
        bad += len(e)
    print('lint', len(targets), 'drafts,', bad, 'errors'); sys.exit(1 if bad else 0)
