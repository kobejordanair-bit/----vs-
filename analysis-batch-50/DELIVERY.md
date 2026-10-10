# 王侯將相 50 人補完：交付狀態（2026-10-10）

真實狀態以 `claude-ledger.v1.json` 為準（由 `node analysis-batch-50/claude/finish.mjs ledger` 依結果檔與回執重算）。**只有「已匯入且讀回驗證」才算完成**，而匯入只能在有合法權限的本機執行；雲端這邊沒有、也不應取得任何憑證或私有快照。

## 數字

| 階段 | 人數 | 說明 |
|---|---|---|
| generated（已撰稿） | 50 | 01–04、06（分析段）、07 為 ChatGPT 稿；05、08–50 與 06 的靈魂內核為 Claude 撰稿 |
| reviewed（已查核） | 50 | Claude 稿皆為**自我查核**（`independent:false`），原典引句由 `archive-quote.mjs` 機械重驗 |
| assembled（已組成可匯入結果檔） | 50 | 44 個 `results.NN-NN.v1.json`（05、08–50）＋ `results.06-06.soul.v1.json` |
| imported / verified（已發布並讀回驗證） | 5 | 01–04、07 四欄全發布；06 只發布 analysis／stats／statsAnalysis 三欄（缺 soulEssence）；合計已發布 23 個欄位 |
| 尚未完成 | 45 | 全部都在等本機乾跑 → 人工檢查 → 寫入 → 讀回 |

雲端驗證：`node --test analysis-batch-50/*.test.mjs` 60/60 通過；45 個 Claude 結果檔全部通過 `validateBatch50Evidence` 的檔案重建閘門（擷取、查核、搜尋紀錄、原典引句、作者政策雜湊都重新比對）。

## 本機發布順序（建議）

指令格式見 `CLAUDE_MODE.md`。每個結果檔都要先乾跑、看過報告再寫入；每次寫入都會先備份、CAS revision、讀回驗證。

1. `results.06-06.soul.v1.json`：只補 06 的 soulEssence。乾跑應顯示 `changedFields=1` 與 `priorReceipts` 指向 `import.06-06.apply.json`。
2. `results.05-05.v1.json`：05 唐高宗的 Claude 重寫稿（四欄）。
3. `results.08-08.v1.json` … `results.50-50.v1.json`：每檔一人、四欄，乾跑應為 `changedFields=4`。

每次成功寫入後，把回執（`import.NN-NN.apply.json`）加進 `claude-receipts.v1.json` 的 `imports`（`ids`、`verified: true`、revision），再跑 `finish.mjs ledger` 重算總帳。

## 已知限制與待辦

- **自我查核**：Claude 稿的作者與查核者是同一 session，發布前建議人工抽查（尤其是 `access: web_search_result_summary` 的來源，只看過搜尋摘要）。
- **頁面抓取被網路政策擋下**：原典引句全部對 repo 內固定修訂的維基文庫全文比對；現代人物（周恩來、朱鎔基、陳雲、白崇禧）以來源包先前核讀與搜尋摘要為據，正文已避免超出來源可支撐的主張，並在各 `claude/specs/NN.json` 的 `limits` 寫明。
- **朱鎔基**：依官方訃告摘要，已於 2026-08-12 逝世，稿件已反映。
- **05**：原 ChatGPT 失敗稿保留於 `attempts/05.analysisStats.1/` 未改動。
- **audit-progress / final-audit-proof**：仍假設「十批、每批五人全套」，在改寫成依實際發布鏈計算前不要執行，以免覆寫 `progress.v1.json`。
- 本 repo 沒有、也不需要 `.env`、OAuth、cookie 或 `cloudflare/private/` 內容。
