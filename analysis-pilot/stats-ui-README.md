# 獨立五維功能

本次修改新增獨立五維流程；本機程式與測試已完成。此文件與測試紀錄不代表正式網站已部署或通過瀏覽器驗證。

## 使用方式

在人物「賞析」分頁閱讀既有文章時，網站會顯示已保存的五維數字、雷達圖，以及另存的評分理由。缺少數值時，可按「生成五維（AI）」；已有數值時，可按「重算五維」。按鈕只更新五維數值與五項理由，保留賞析、校準評級與靈魂內核。

閱讀快取不會自動呼叫 AI 或儲存資料。主動按五維按鈕仍使用網站既有的 `callGeminiStream` / `/api/gemini/stream` 路徑；另由 ChatGPT 外掛產生並匯入的試跑結果，走獨立的匯入流程。

## 資料格式與驗證

- `modifiedLegends[id].stats`：五個 0–100 整數，依序為統率、武力、智謀、政治、魅力。
- `modifiedLegends[id].statsAnalysis`：独立 Markdown 評分理由；不加入赏析正文或討論的「評鑑原文」。
- 即時生成只接受一個完整 JSON 物件：`stats` 為上述陣列；`reasons` 為五個依序的 `{ dimension, reason }` 物件。
- 每項理由至少 30 個非空白字元；五項合計至少 150 個。拒絕缺項、錯序、錯值、未完成理由、多餘欄位、重複 JSON 鍵及以 Unicode escape 隱藏的重複鍵。
- 通過驗證後，數值與理由一起更新。串流或驗證失敗保持既有資料；切換人物、切換分頁、離開後返回同一分頁，或關閉視窗，會使尚未完成的五維回覆作廢。
- 比較功能只補缺少數值的人物，保留另一人的既有數值與理由。其他既有生成流程若寫入新的五維數值，會清除舊的獨立理由，避免兩者不一致。
- `statsAnalysis` 不會單獨使人物出現「修」徽章；其他角色修改仍照常辨識。

## DOM 與程式位置

數值與理由使用 `#statsDetailsContainer`、`#statsValues`、`#statsAnalysisContent`、`#statsGenerationStatus`，位於 `#modalContent` 之外。原賞析與討論維持原容器。

主要入口為 `backend/index.html` 的 `forceRegenerateStats` → `_generateStatsOnly`；嚴格解析使用 `_parseStatsOnlyResponse` 與 `_parseStatsJson`。`_loadReviewContent(id, true)` 仍供既有賞析錯誤重試流程使用，五維按鈕不會呼叫它。

## 驗證紀錄

[完整測試紀錄](stats-ui-integrated-verification.log) 與 [安全摘要](stats-ui-integrated-verification.json) 記錄實際命令、前端 hash、執行時間與分組結果：

| 分組 | 通過 |
| --- | ---: |
| 原整合測試的非 helper 部分 | 56 |
| 公開 PROMPT helpers | 13 |
| 五維 UI、audit、原模板綁定、五維 importer | 36 |
| 合計 | 105 |

原來的 66 項整合測試包含 56 項非 helper 與當時的 10 項 helper；目前 helper 已增至 13 項。本次分組執行避免重複測試，全部通過且沒有略過項目。前端四個 inline script 亦通過語法解析。所有測試使用公開程式與合成 fixture，未讀取私人快照、未操作瀏覽器、未寫入正式資料。
