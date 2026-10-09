# 五維補評擷取與組裝契約

僅補孝文帝與姚崇的 `stats`、`statsAnalysis`。組裝器不產生分數、不重寫理由、不連線，也不讀私人狀態。王翦及所有既有文章保持原件。

## ChatGPT 回覆

第一行為標準 JSON，唯一鍵 `stats`，值是按統率、武力、智謀、政治、魅力排列的五個 0–100 整數。第一行不加程式碼區塊或前言。

以下是純格式示意，數字不是人物評分：

```text
{"stats":[10,20,30,40,50]}

### 1. 統率：10
原稿的理由、事件與限制。

### 2. 武力：20
原稿的理由、事件與限制。

### 3. 智謀：30
原稿的理由、事件與限制。

### 4. 政治：40
原稿的理由、事件與限制。

### 5. 魅力：50
原稿的理由、事件與限制。

[來源](https://example.org/public-history)

<!-- STATS_COMPLETE 人物ID -->
```

標題可不編號、可帶 Markdown 粗體；五維順序、每段分數與 JSON 必须相符。重複、缺段、錯序、值不符皆拒絕。結尾標記須使用請求中本人物的精確 ID，只能出現一次。每段必須有實際理由，全文附可點來源。

## 根代理擷取檔案

對每位 `{slug}`（`xiaowendi`、`yaochong`），保留實際 ChatGPT 複製的完整原始稿，以及同次搜尋完成 UI 的文字：

- `drafts/{slug}.stats.raw.md`
- `drafts/{slug}.stats.search-evidence.txt`，包含實際 UI「已搜尋 N 個網站」，N 至少 1。

兩份稿皆沿用 `stats-request.v1.json` 的原提示詞及完整三層文章。根代理另提供公開 `stats-input-bindings.v1.json`：`format: dynasty-stats-input-bindings`、`schemaVersion: 1`、相同 `baselineRevision`、恰好兩筆 `{id, slug, inputSha256, sourcePackageSha256}`，以及頂層 `referencePath: analysis-pilot/stats-reference.v1.json`、該公開參照庫原文的 `referenceSha256`。這記錄提供的參照版本，不宣稱可證明 ChatGPT 已逐字讀取。

從 `app` 目錄執行：

```powershell
node analysis-pilot/capture-stats-export.mjs xiaowendi 'https://chatgpt.com/c/實際對話ID'
node analysis-pilot/capture-stats-export.mjs yaochong 'https://chatgpt.com/c/實際對話ID'
```

擷取器僅移除已知來源卡 UI、解除粗體跳脫、解除結尾標記的單行反引號、整理外圍空白。它驗證提示詞、來源包、公開參照庫與三層文章內容雜湊，建立 `.stats.md` 与 `.stats.capture.json`。輸出已存在時不覆寫。

## 來源 QA

查核完成後保存 `source-review.{slug}.stats.json`，至少包含：

- `passed: true`、精確 `recordId`、`field: stats`
- `manuscriptSha256`：最終 `.stats.md` 的 UTF-8 SHA256
- `sourcePackageSha256`：來源包 UTF-8 SHA256
- `materialIssues: []`
- `checkedExternalSources: [{title, url, locator}]`：正文所有來源連結均需在固定來源包或此查核名單，URL 為 HTTPS；只記實際讀到的範圍。
- 建議保存 `stats`，核對五段與 JSON。判斷分數屬遊戲詮釋；查核必須確認所舉史事、能力歸屬、年代及尺度依據，不能自行換分。

正文如需實質修正，請回 ChatGPT 重新產出完整符合契約的稿，保留新原始回覆及網搜證據。只改雜湊不能令改寫正文通過；組裝器會比較最終稿與原始擷取的格式正規化結果。

## 離線組裝

```powershell
node --test analysis-pilot/assemble-stats-results.test.mjs
node analysis-pilot/assemble-stats-results.mjs
```

預設輸出 `stats-results.v1.json`，若存在會停止。可用 `--request`、`--bindings`、`--output` 指定公開請求／公開綁定／輸出路徑。輸出通過既有 stats importer 契約；每人只有 `stats` 与 `statsAnalysis`，其中 JSON 與結尾標記不進入理由欄位。所有擷取、上下文、網搜及來源 QA 收據只保留在交付檔 provenance。

正式匯入由根代理另行執行 importer 的 dry-run、核驗與 apply；此工具沒有正式寫入功能。
