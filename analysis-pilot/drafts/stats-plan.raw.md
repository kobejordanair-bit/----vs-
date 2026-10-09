[C2C] STATE: PLAN TASK_ID: c2c_5d09 ITERATION: 0

## 審查結論

已確認連線工作區為 `app`，目前分支為 `codex/pilot-five-stats`。已讀取三份指定資料、兩份完整的五維生成提示詞，以及相關公開程式碼。

這次應作為既有分析試跑的補完階段，不應重新執行八篇文章生成，也不應重新匯入先前成果。

目前確認的關鍵事實：

- `stats-request.v1.json` 已指定北魏孝文帝、姚崇兩人，原始基線 revision 為 3。
- `stats-reference.v1.json` 收錄 64 筆既有有效五維資料，包含王翦。
- 原始五維順序固定為 統率、武力、智謀、政治、魅力，每項為 0–100 整數。
- `backend/index.html` 的 `forceRegenerateStats()` 目前會呼叫 `_loadReviewContent(id, true)`，導致賞析和數值一併重生。
- 網站目前沒有 `statsAnalysis` 的獨立保存及顯示路徑。
- `original-prompt-renderer.mjs` 綁定整份原始 `backend/index.html` 雜湊；直接修改 UI 會破壞現有提示詞重現檢查。
- 真實瀏覽器驗證紀錄仍為 1/9 頁，其餘項目沒有完成證據。

## 執行 PLAN

1\. 封存原始提示詞與五維參照，先修正可重現性

保留 `analysis-pilot/stats-request.v1.json`、`stats-reference.v1.json`、`original-prompts.v1.json` 以及兩份已生成的 `prompts/*.stats.prompt.md`，不可因後續 UI 修改而重新產生不同提示詞。

建議調整 `analysis-pilot/original-prompt-renderer.mjs` 和 `website-source-binding.json`：明確區分「生成時的原網站版本」與「修改後的現行 UI 版本」。將原始公開 HTML 封存為具 SHA-256 的唯讀歷史來源，或提供等效、可獨立驗證的不可變來源。

尤其要補上 `analysis.conditionalStatsAppend` 的原始字面模板查驗；目前載入器尚未將這段第五章模板納入來源一致性檢查。更新綁定時必須保留舊版來源 SHA、完整原模板文字及其雜湊，不得直接覆蓋原始 provenance。

`backend/index.html` 僅作必要局部修改，避免整份 CRLF/LF 轉換造成大規模無關 diff。擴充 `cloudflare/tests/analysis-pilot-helpers.test.mjs`，驗證新舊來源均可重現相同的原始五維 PROMPT，且任意改動模板文字都會失敗。

2\. 生成兩份五維與獨立理由，建立正式批次

接下來使用已封存的 `xiaowendi.stats.prompt.md`、`yaochong.stats.prompt.md`，由 ChatGPT web 實際搜尋公開原典與學術資料，再產生數值及理由。

每份輸出必須第一行是原格式 `{"stats":[...]}`，隨後僅有第五章五維分析及完成標記。不得重寫前四章，也不得把數值從人物評級直接推算出來。

建議新增 `analysis-pilot/assemble-stats-results.mjs`，建立兩筆正式批次，分別包含 `stats` 整數陣列及 `statsAnalysis` 理由文本。嚴格檢查五個理由標題的順序與陣列數值一致、原提示詞 SHA 正確、歷史來源與實際網搜 QA 完成，並確認輸出沒有其他欄位。

&#x20;  保存擷取紀錄、來源 URL、查證報告、原始及整理後文章 SHA。現有八篇文章雜湊作為不可變基線。

3\. 新增專用安全匯入器

建議建立 `cloudflare/scripts/analysis-pilot-stats-import.mjs`，沿用既有兩階段匯入器的安全設計，但將允許變更範圍嚴格縮小為：

| 人物    | 唯一可新增欄位                 |
| ----- | ----------------------- |
| 北魏孝文帝 | `stats`、`statsAnalysis` |
| 姚崇    | `stats`、`statsAnalysis` |

須先驗證兩個目標尚無五維、原有 `analysis`／`deepAnalysis`／`soulEssence` SHA 完全一致，並確認王翦既有 `stats` 不會被覆蓋。

匯入過程採 dry-run → 明確批准 → 最新資料讀取 → 完整備份 → revision CAS → 寫後讀回驗證。遇到 409 可在檢查目標不變後有限重試；503、網路中斷或結果不明時，停止自動重試，避免重複寫入。

新增 `analysis-pilot/stats-completion-audit.json`，獨立記錄本輪兩人四欄的新增結果。不要改寫先前 `complete-delivery-audit.json`，也不要把 provenance 寫入網站 userdata。

4\. 拆開五維生成與賞析重生

修改 `backend/index.html`：

- `forceRegenerateStats()` 改呼叫獨立的五維生成程序，不再呼叫 `_loadReviewContent(id, true)`。
- 五維生成僅更新 `stats` 與 `statsAnalysis`；不論成功、失敗或回傳格式錯誤，都不得修改原有三篇文章欄位。
- 對 AI 回傳進行嚴格格式驗證，五個數值與理由全部合格後才一次寫入；不允許只保存部分數值。
- 評鑑頁新增獨立的五維理由顯示區，使用現有安全 Markdown 渲染。雷達圖由已保存 `stats` 直接繪製，理由由 `statsAnalysis` 直接讀取。
- 開啟已保存的賞析、切換分頁及閱讀五維，不得自動呼叫 AI，也不得觸發 `syncToCloud()`。
- 王翦維持現有雷達圖；若沒有獨立理由文本，不得虛構補寫。

另外，`refreshData()` 和 `cloudflare/scripts/audit-counts.mjs` 的 `isModified` 判斷目前只排除 `stats`、`analysis`，建議一併排除 `statsAnalysis`，避免僅新增評分理由便被誤認為人物基本資料遭修改。

&#x20;  既有的「重新生成賞析」若需要保留，必須作為另一個明確的操作，與「重算五維」完全分離。

5\. 建立防覆寫及完整保全測試

擴充 `cloudflare/tests/analysis-review-cache.test.mjs`，另建專用五維匯入及 UI 測試。

&#x20;  必須涵蓋：五維輸出格式錯誤、缺項、非整數、超界、重複數值區塊、理由與數值不符、已有 stats 拒絕覆寫、舊文章 SHA 變更、CAS 衝突、備份失敗、寫後不一致，以及 AI 回應後使用者已切換人物或分頁的競態情況。

以真實保存內容建立變更前後比對，驗收以下不變條件：962 人物 ID 不變、原八篇文章及王翦賞析逐字不變、王翦五維不變、評級與稱號不變、其餘 userdata 欄位不變。新增的五維理由必須能由網站重新載入，而不只是留在記憶體。

&#x20;  回歸執行既有 66 項整合測試、13 項輔助測試及本輪新增測試。

6\. 部署後完成真正的瀏覽器驗證

使用 `analysis-pilot/browser-verification-expected.json` 作為既有九個功能頁的驗證基準；新增兩筆五維驗證項目，檢查孝文帝與姚崇的雷達圖、五項數值、理由內容、按鈕狀態及重新整理後仍能讀取快取。

&#x20;  驗證時需觀察實際網站 DOM、瀏覽器網路請求及畫面，確認純閱讀沒有 AI 呼叫或 userdata POST。五維按鈕的實際生成流程應在隔離測試資料或模擬 API 中操作，不可為了測試而覆寫生產環境剛匯入的兩份評分。

`browser-verification-observed.json` 必須從目前 `partial_browser_control_unavailable` 更新為有實際觀測證據的狀態，保留版本號、九個原閱讀分頁及兩個五維區塊的查核結果。若登入或瀏覽器控制仍受阻，明列未完成項目，不得宣稱瀏覽器驗證通過。

## 驗收門檻

本輪成功的定義是：新增恰好兩份五維及兩份理由；原有八篇稿件、王翦資料及其他使用者資料零非授權變更；五維按鈕不再重寫賞析；原網站 PROMPT 可由固定版本重現；完整測試與真實瀏覽器查核均有證據。

`NEXT_EXPECTED_STEP:` Codex 先落實提示詞封存驗證、stats-only UI 與安全匯入器的程式及測試；隨後再使用兩份已封存 PROMPT 進行 ChatGPT web 生成與史料 QA，最後進行經批准的正式匯入、部署及瀏覽器驗證。

本輪僅規劃，未生成五維、未執行匯入、未修改網站資料。