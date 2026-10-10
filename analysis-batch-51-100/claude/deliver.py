# Build the delivery file for the current state of the batch:
#   analysis-batch-51-100/claude/delivery/DELIVERY-<HEAD7>.md  and  LATEST.md
# Every figure in it is produced by running the real checks here (tests,
# evidence rebuild, preparation verification, ledger), never typed by hand.
# Usage (repo root): python3 -I analysis-batch-51-100/claude/deliver.py [BASE_COMMIT] [REPORT.md]
import json, os, re, subprocess, sys, datetime
B = 'analysis-batch-51-100'
base = sys.argv[1] if len(sys.argv) > 1 else '4f2ba130'
report = sys.argv[2] if len(sys.argv) > 2 else ''
def sh(cmd, check=False):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if check and r.returncode: sys.exit(f'{cmd}\n{r.stdout}{r.stderr}')
    return r.returncode, (r.stdout + r.stderr).strip()
head = sh('git rev-parse --short HEAD', True)[1]; branch = sh('git rev-parse --abbrev-ref HEAD', True)[1]
names = {}
for line in open(f'{B}/PEOPLE.md', encoding='utf-8'):
    m = re.match(r'\|\d+\|(\d\d)\|([^|]+)\|(\w+)\|', line)
    if m: names[m.group(1)] = (m.group(2), m.group(3))
D = ['統率', '武力', '智謀', '政治', '魅力']
def stats_at(rev, n):
    rc, out = sh(f'git show {rev}:{B}/drafts/{n}.combined.draft.md')
    return json.loads(out.split('\n', 1)[0])['stats'] if rc == 0 else None
# verification, run for real
rc_t, t = sh(f'node --test {B}/*.test.mjs analysis-batch-50/*.test.mjs')
tests = ' / '.join(re.findall(r'^# (tests \d+|pass \d+|fail \d+)', t, re.M))
rc_e, ev = sh("node -e \"import('./%s/import.mjs').then(async m=>{const fs=require('fs');let ok=0,bad=[];for(let i=1;i<=50;i++){const n=String(i).padStart(2,'0');try{const b=JSON.parse(fs.readFileSync('%s/results.'+n+'-'+n+'.v1.json','utf8'));(await m.validateBatch50Evidence({batch:b}))===true?ok++:bad.push(n)}catch(e){bad.push(n+':'+e.message)}}console.log(JSON.stringify({ok,bad}))})\"" % (B, B))
rc_p, prep = sh(f'node {B}/verify-preparation.mjs')
rc_l, ledger = sh(f'node {B}/claude/finish.mjs ledger')
_, untouched = sh(f'git diff --stat 18cc53eb -- analysis-batch-50 analysis-pilot backend {B}/manifest.v1.json {B}/prompts {B}/existing')
_, commits = sh(f'git log --oneline {base}..HEAD')
ok_all = rc_t == 0 and rc_e == 0 and '"bad":[]' in ev and '"passed":true' in prep and not untouched
rows, changed = [], []
for n in sorted(names):
    now, old = stats_at('HEAD', n), stats_at(base, n)
    diff = [f'{D[i]} {old[i]}→{now[i]}' for i in range(5) if old and old[i] != now[i]]
    if diff: changed.append(n)
    rows.append(f'| {n} | {names[n][0]} | {names[n][1]} | {now} | {"；".join(diff) or ""} |')
_, attempts = sh(f'git diff --name-only --diff-filter=A {base}..HEAD -- {B}/attempts | grep archive-manifest.json')
att = []
for p in attempts.split('\n'):
    if p and os.path.exists(p):
        a = json.load(open(p, encoding='utf-8')); att.append(f'- `{os.path.dirname(p)[len(B)+1:]}`：{a["reason"]}')
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
md = f'''# 交付檔案：王侯將相第二批 50 人（51–100）

- 產生時間：{now}（由 `claude/deliver.py` 實際執行檢查後自動產生，非手填）
- 分支：`{branch}`，HEAD `{head}`；比較基準 `{base}`
- 作者：Claude Code (Anthropic)；審稿 independent:false（自我查核）
- 整體檢查：{"**全部通過**" if ok_all else "**有未通過項目，見下**"}
{f"- 本次修訂回報：`{report}`" if report else ""}

## 一、驗證結果（本次實跑輸出）

| 項目 | 結果 |
|---|---|
| 兩批測試 `node --test` | {tests or t[-300:]} |
| 50 份結果檔證據重建 | `{ev}` |
| verify-preparation | `{prep}` |
| 總帳（claude-ledger） | `{ledger}` |
| 首批／pilot／backend／manifest／原 PROMPT／existing 相對 18cc53eb 的差異 | {"無" if not untouched else "**有差異：** " + untouched} |

## 二、五維總表（標出相對基準的調分）

| 檔號 | 人物 | 類型 | 統率／武力／智謀／政治／魅力 | 相對 {base} 調整 |
|---|---|---|---|---|
''' + '\n'.join(rows) + f'''

調分人數：{len(changed)}（{"、".join(changed) or "無"}）

## 三、本輪 commit

```
{commits or "（無）"}
```

## 四、本輪新建撰稿嘗試（舊產出含雜湊封存）

{chr(10).join(att) or "（無）"}

## 五、檔案位置

- 文稿：`{B}/drafts/NN.combined.draft.md`；分欄、capture：`{B}/drafts/`
- 審稿：`{B}/reviews/`；結果：`{B}/results.NN-NN.v1.json`；總帳：`{B}/claude-ledger.v1.json`
- 搜尋與查核證據：`{B}/claude/specs/NN.json`、`NN.quotes.json`；舊版：`{B}/attempts/`
- 修訂回報與提案：`{B}/claude/REVISION_*.md`、`{B}/claude/PAREN_URL_PROPOSAL.md`

## 六、固定限制

- 環境網路政策封鎖網頁讀取（WebFetch ENOTFOUND／代理 403），無 web_page_read；網路來源均為真實搜尋摘要，存取類型記於各 review 的 checkedSources。
- 未讀取密鑰／.env／OAuth／private；未寫入正式網站；正式匯入交由 Codex。
'''
os.makedirs(f'{B}/claude/delivery', exist_ok=True)
for f in (f'{B}/claude/delivery/DELIVERY-{head}.md', f'{B}/claude/delivery/LATEST.md'):
    open(f, 'w', encoding='utf-8').write(md)
print(f'{B}/claude/delivery/DELIVERY-{head}.md', 'OK' if ok_all else 'CHECKS-FAILED')
sys.exit(0 if ok_all else 1)
