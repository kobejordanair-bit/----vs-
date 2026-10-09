# Cloudflare 公開靜態資產

`scripts/build-assets.mjs` 只讀取原網站的 5 個入口檔和 `backend/static/`。它不複製 Python 後端、`.env`、資料庫匯出、962 人私有備份或工作區備份。現有公開人物基本資料、史料索引與公開史籍保持公開。

在 `app/` 執行：

```sh
node cloudflare/scripts/build-assets.mjs
node --test cloudflare/scripts/build-assets.test.mjs
```

生成目錄為 `cloudflare/build/assets/`；逐檔 SHA-256 與大小報告為 `cloudflare/build/assets-report.json`。這些是可重建的大型產物，必須忽略 Git。構建會校驗所有既有 gzip 副本解壓後等於原檔、HTML 所引用資產存在、檔案館 manifest 指向的公開資產存在，以及最新檔案館的篇章數符合 manifest。任一步驟失敗都不替換原先成功構建的目錄。

## 限制與大檔

依 [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)（2026-10-09 查閱），免費方案每版最多 20,000 個靜態資產，每檔最多 25 MiB；付費方案為 100,000 個，每檔仍為 25 MiB。構建預設以免費門檻校驗，超限直接失敗。`_headers` 和 `_redirects` 為構建規則，不計入上傳資產數。

現有公開目錄約 19,725 個檔案，包含原本所有 4,254 篇古籍檔、gzip 副本、962 筆人物來源詳情與搜尋分片。新增公開資料時應先看報告；超過 20,000 檔時需合併分片、移至 R2 或升級 Workers 方案。

以下 3 個原始 JSON 超過 25 MiB。構建保留其 URL 與全部内容，將 canonical `.json` 輸出為 deterministic gzip，並產生 `.json.gz` 下載副本；報告記錄原始內容雜湊。

```text
/static/data/history/archive-books/qingshigao.json
/static/data/history/archive-books/songshi.json
/static/data/history/source-archive.v1.json
```

這 3 個 canonical URL 必須透過 `run_worker_first` 進入 Worker，並一律從 `env.ASSETS.fetch(canonical + '.gz')` 讀取沒有 `Content-Encoding` 的原始 gzip 下載檔。接受 gzip 時，Worker 明確回傳 JSON MIME、`Content-Encoding: gzip`，並設定 `new Response(..., { encodeBody: 'manual' })`。瀏覽器只解壓一次，所以 `fetch(...).json()` 得到正確原始 JSON。構建共享 `src/static-assets.mjs` 的 `LARGE_JSON_PATHS`；若未來新增超限 JSON，必須先登記 Worker 與 Wrangler routing，否則構建拒絕，避免產生無法解碼的網頁資料。

依 [Cloudflare Response 文件](https://developers.cloudflare.com/workers/runtime-apis/response/)，預壓縮位元組若搭配預設 `encodeBody: automatic`，Runtime 會依 `Content-Encoding` 再壓縮一次。`_headers` 的編碼標頭只能提供 metadata，不能替代 Worker 的 manual response；不得移除上述路徑的 Worker routing。

若使用者明確要求 `Accept-Encoding: identity` 或 `gzip;q=0`，Runtime 把處理轉交同一個 API Durable Object，從 raw `.gz` 後以 `DecompressionStream('gzip')` 串流回傳原始 JSON，避免在一般免費 Worker 執行大型解壓。回傳需移除 `Content-Encoding`、壓縮檔 `Content-Length` 與 representation-specific ETag，設定 JSON MIME、`Vary: Accept-Encoding` 及 `Cache-Control: no-cache`。這個少數大檔的相容性處理不影響開場 HTML 的直接載入。

## 路由與快取

Wrangler 建議設定：

```json
{
  "assets": {
    "directory": "./build/assets",
    "binding": "ASSETS",
    "html_handling": "none",
    "not_found_handling": "none",
    "run_worker_first": [
      "/api/*",
      "/private-library.json",
      "/static/data/history/archive-books/qingshigao.json",
      "/static/data/history/archive-books/songshi.json",
      "/static/data/history/source-archive.v1.json"
    ]
  }
}
```

`_redirects` 使用相對 URL 的 200 rewrite 保留 `/`、`/play`、`/history-lab`、`/source-archive`，原有 `.html` URL 也保留。`html_handling: none` 不會自動把根路徑導向 index，所以 `/ /index.html 200` 必須明確存在。未知路徑回 404，避免失敗的 API 或資料請求收到 HTML。

入口、PWA manifest 和 service worker 禁止儲存舊版；manifest 的 icon URL 保留原後端 `?v=APP_VERSION` 行為。帶 16 位小寫 release hash 的公開史料不可變，一年快取。一般公開 JS/CSS/JSON 使用 Cloudflare 預設 ETag revalidation。所有靜態回應加 `nosniff`，歷史調查與檔案館入口保留原有 CSP。

Cloudflare 的 [_headers 規則](https://developers.cloudflare.com/workers/static-assets/headers/) 不會自動套用到 Worker 產生的回應；API、認證錯誤與串流需由 Worker 設定自身回應標頭。[_redirects 規則](https://developers.cloudflare.com/workers/static-assets/redirects/) 也只適用於資產回應。

## 實際交付檢查

完成構建後，本機及部署預覽至少檢查：`/play`、`/history-lab`、`/source-archive`、manifest 與 2 個 PWA icon、1 個人物詳情、1 個史籍全文與搜尋分片、3 個超限 JSON 的 gzip 和 identity 協商，以及不存在的 `/private-library.json` 沒有公開內容。私有人物資料需沿用受保護 API 從新資料庫讀取。
