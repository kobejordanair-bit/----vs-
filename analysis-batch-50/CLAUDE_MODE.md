# Claude 作者模式（author-policy.v2.json）

2026-10-10 起，未發布人物改由 Claude 直接撰稿。`manifest.v1.json`、原 PROMPT、01–07 的 ChatGPT capture 與發布回執一律不動；新規則寫在 `author-policy.v2.json`，importer 以其 SHA-256 綁定。

## 每人流程（雲端，不需任何密鑰）

```sh
node analysis-batch-50/combined-pilot.mjs compile NN            # 原 PROMPT、文風範例、評分參考組成合併包（不改原文）
# Claude 依合併包撰寫 drafts/NN.combined.raw.md
# Claude 寫 drafts/NN.combined.search-log.json：實際 WebSearch 查詢與回傳網址、所有原典引句
node analysis-batch-50/claude-author.mjs split NN https://claude.ai/code/session_...
# Claude 完成 reviews/NN.analysisStats.json、reviews/NN.soulEssence.json（自我查核，須聲明 independent:false）
node analysis-batch-50/claude-author.mjs assemble NN --output analysis-batch-50/results.NN-NN.v1.json
node --test analysis-batch-50/*.test.mjs
```

- `split` / `assemble` 每次都會用 `claude/archive-quote.mjs` 把搜尋紀錄裡的原典引句，拿 `backend/static/data/history/archive-books/*.json`（維基文庫固定修訂、逐篇 textSha256）重新比對；有一句找不到就失敗。
- 稿件裡每個連結都要出現在 review 的 `checkedSources`，且要標 `access`：`fixed_revision_archive_fulltext`（全文比對過）或 `web_search_result_summary`（只看過搜尋摘要，正文只能引用摘要能支撐的內容）。
- 錯稿不覆寫：整組移到 `attempts/NN.combined.K/`，附上 `archive-manifest.json` 寫明原因與雜湊，再重新 split。
- Claude 稿的 provenance 是 `provider: "Claude Code (Anthropic)"` 加 `sessionUrl`，不能帶 `conversationUrl`；改標成 ChatGPT 或塞 chatgpt.com 網址都會被 importer 擋下（見 `claude-author.test.mjs`）。

## 本機發布（只在有合法權限的本機執行）

基準快照與憑證只放在本機被 ignore 的 `cloudflare/private/`，不要上傳到雲端或 repo。

```sh
# 1. 乾跑：讀最新資料、對穩定 ID、驗證稿件與來源雜湊，只產生計畫
node analysis-batch-50/import.mjs --origin https://dynasty.piamamba.com \
  --source cloudflare/private/<baseline-source>.json \
  --results analysis-batch-50/results.08-08.v1.json \
  --output analysis-batch-50/import.08-08.dry-run.json \
  --token-file cloudflare/private/<token>.json
# 2. 人工檢查 dry-run 報告（changedFields=4、targetCount=1、revision 對得上）
# 3. 正式寫入：先備份，再用 CAS revision 寫入、讀回驗證
node analysis-batch-50/import.mjs --origin https://dynasty.piamamba.com \
  --source cloudflare/private/<baseline-source>.json \
  --results analysis-batch-50/results.08-08.v1.json \
  --output analysis-batch-50/import.08-08.apply.json \
  --token-file cloudflare/private/<token>.json \
  --approved-report analysis-batch-50/import.08-08.dry-run.json \
  --backup-dir cloudflare/private/backups/08-<日期>
```

寫入結果不明（`write_outcome_unknown`）時就停下來人工核對，不要自動重試，也不要整庫回滾。發布後到網站確認賞析、五維、五維理由、靈魂七欄都看得到，並把結果記進 `claude-ledger.v1.json`。

## 尚未處理的限制

- 05 唐高宗：ChatGPT 稿史實錯誤（666 任命／668 克平壤），未匯入，等待修正稿。
- 06 秦昭襄王：只缺靈魂內核。現有 importer 要求四欄全缺，需先另寫一條綁定 `import.06-06.apply.json` 的補欄路徑，只允許寫 `soulEssence`；不得放寬成任意覆蓋。
- `audit-progress.mjs` / `final-audit-proof.mjs` 假設連續十批、每批五人全套，在改寫成依實際發布鏈計算之前不要執行，以免覆寫 `progress.v1.json`。
