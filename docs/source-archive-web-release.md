# 來源檔案館：網站整合版 v15.14

## 使用入口

- 網站首頁：`https://dynasty-ydov.onrender.com/`。主選單進入「來源檔案館」與「史論館」。
- 人物詳情：「查看史料」使用原人物 ID 開啟對應來源檔案。
- 來源檔案：「閱讀人物原文」接回史論館同一 ID。未載入完整文章時，展開人物檔讀取區；匯入後自動開啟。不同 ID 的同名人物不替代。
- 檔案館網址：`/source-archive`；案卷與原文閱讀：`/history-lab`。

完整私人人物快照與403筆長篇分析沒有隨本次公開資料散布。原 app 的登入、雲端人物資料與完整備份功能繼續使用既有流程；新史論館可在本頁讀取本機人物 JSON，不上傳。調查筆記保存於目前網站的瀏覽器儲存空間，可匯出書桌備份。更换裝置或網址前應先匯出。

## 本次實作

| 操作 | 網站實際讀取 |
|---|---|
| 進入檔案館 | 輕量 manifest、962筆人物摘要與來源目錄 |
| 開啟人物 | 該人的完整公開來源檔案 |
| 選一本史籍 | 該書篇章目錄 |
| 閱讀篇章 | 單篇整理文字，切換後才讀原始維基文字 |
| 全文搜尋 | 搜尋目錄、查詢所需的字／雙字位置索引分片 |
| 查看搜尋結果 | 每頁24筆，只為目前頁面讀取上下文 |
| 下載完整公開索引 | 明確選擇後才讀取原本的大型索引 |

搜尋在同源 Web Worker 執行，支援全館或單書、進度、取消、已完成部分結果與失敗重試。不呼叫模型 API。結果仍使用原始 UTF-16 字串的非重疊 `String.indexOf` 次數及第一個位置；沒有把簡繁、異體字或同名人物自動合併。單人核讀、候選來源、字串命中、異版補件、跨頁轉引與缺文標記都保留。

## 實際資料與載入量

本版保存962筆人物檔案、29部史籍、4,254篇版本快照，整理文字42,600,292個 UTF-16 單位。445篇保留缺文、表格、圖像或字形待核標記，不能解讀為全部史料已完成校勘。

- 首屏 manifest：760,104 bytes；gzip後101,864 bytes。原本公開索引31,701,580 bytes僅供明確匯出。
- 全部搜尋索引：215,406,779 bytes JSON／138,602,876 bytes gzip，依查詢分片下載；不在進館時下載整套。
- 最大搜尋分片：1,442,827 bytes JSON；全部產物最大單檔7,064,160 bytes。
- Web 資料目錄包含逐篇閱讀、原始維基文字、索引與各自gzip檔，約880MB。這是部署／離線交付的總量，不是每次瀏覽的流量。
- 搜尋與資料頁面不用模型 token。既有 app 的 AI 生成功能維持原設定。

精確版本、輸入書籍雜湊、建置時間、記憶體及檔案統計見 `data/source-archive/web-build-report.json`。本機 Node 搜尋測量不可當作手機網路速度承諾。

## 部署與快取

本次沿用既有 Render FastAPI 部署，不需新增帳號、資料庫或環境變數。`backend/main.py` 使用 `SourceArchiveStaticFiles` 提供 gzip、ETag 與快取。頁面允許同源 Worker。

- `/static/data/history/web/manifest.json`：`no-cache`，重訪先核對 ETag。
- `/static/data/history/web/releases/<hash16>/...`：一年 immutable，版本由公開索引、全部29本來源bytes、builder與engine共同決定。
- JSON gzip旁檔：依 `Accept-Encoding` 協商，保留原 Content-Type 與 `Vary: Accept-Encoding`。
- 主 app 其他 static 行為維持原規則；不存在的檔案不使用 immutable 快取。

重建會產生新版本目錄，再切換 manifest。不要手改已發布的版本目錄。部署時提交相符的 manifest、gzip與完整版本目錄；舊版讀者仍可能使用先前 manifest，後續版本應暫時保留先前目錄。需要回退時，用 GitHub／Render 的既有回退流程回到上一個完整提交，不只回退單一 manifest。

## 維護與驗證

本版合併前驗證：271項Node測試通過（含18項檔案館／深連結DOM測試，沒有跳過）、74項Python測試通過；另15項既有史論館操作與存檔回歸檢查通過。全庫38個查詢逐篇對照原始文字的結果一致，包含單字、長句、罕見字、換行、缺文與单書範圍。前端Worker互動使用協定fixture；實際索引另由全庫比對驗證。

先按 `source-archive-release.md` 更新來源與公開索引，再執行：

```powershell
node scripts/build-source-web.cjs
$tests = Get-ChildItem tests -Filter '*.test.cjs' | ForEach-Object FullName
node --test @tests
python -m pytest tests -q
```

DOM互動檢查需要 jsdom，可在開發環境安裝，或設定 `JSDOM_MODULE` 為既有 jsdom 模組的絕對路徑：

```powershell
node --test tests/history-deep-link.dom.cjs
node --test tests/source-web-dom.test.cjs
```

部署後只讀驗證公開頁面、版本、實際內容雜湊、gzip／ETag、人物與篇章、線上索引搜尋及私人資料存取隔離：

```powershell
node scripts/verify-source-web-release.cjs https://dynasty-ydov.onrender.com release-verification.json
```

獨立離線交付包沿用 `scripts/export-source-archive.py --output <目錄>`；明確列入原始來源與當前 web 版本，排除私人人物檔、金鑰與暫存擷取檔。每個 ZIP 成員會核對 CRC 與 SHA-256，附 `FILES.sha256`。解壓縮後執行啟動程式即可使用，不需模型金鑰。

測試涵蓋資料約束、原文雜湊、索引與逐篇掃描比對、讀取失敗、取消搜尋、深連結、私人檔案與既有存檔流程。DOM和HTTP檢查沒有取代真實瀏覽器的視覺、手機版和下載檔案落地驗收；本次未取得後者的驗收結果。

來源的授權、署名及查證範圍沿用 `source-archive-attribution.md`、`source-archive-research.md`、`history-verification.md`。
