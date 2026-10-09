# 王侯將相：Cloudflare 完整部署

保留 v16 網站全部入口與原 API。公開網站由 Workers Static Assets 提供；API 由 `runtime.mjs` 轉交 SQLite Durable Object `DynastyApi`，人物修改、分析、聊天與世界進度仍以 D1 為唯一目的儲存。Durable Object 不另存人物文件，避免一般免費 Worker 的 10ms CPU 額度限制大型 JSON 處理。

## 本機驗證

在本目錄使用 Node 24 或更新的支援版本：

```sh
npm ci
npm test
npm run build:assets
npm run check:deploy
```

Python 原站維護閘門與遷移工具：在 repo 根目錄執行：

```sh
python -m pytest -q tests/test_migration_gate.py tests/test_migration_tools.py tests/test_full_release.py
```

Python 依賴見 `../requirements-dev.txt`。本機合成測試不使用真實 Gemini、Mongo 或 Cloudflare 雲端資料。

## 設定與密鑰

- 正式設定：`wrangler.jsonc`。D1 的 `database_id` 必須使用帳號實際建立後回傳的 ID；不可填範例值。
- 加密 Secrets：`APP_SECRET` 與 `GOOGLE_API_KEY`。不以 `vars`、Git、URL query 或命令列值傳遞。
- D1 binding：`DYNASTY_DB`，建議資料庫名稱 `dynasty-data`。
- Durable Object binding：`DYNASTY_API`，以 `new_sqlite_classes` 遷移，支援免費 Workers。
- `DATA_READY=false` 時阻止雲端文件讀寫，避免空資料被當作正式存檔。
- `ALLOWED_ORIGINS` 保留正式網址；相同 origin 的 workers.dev 預覽可正常測試。
- 保留原有 Gemini Pro／Flash 模型與登入密碼。新 token 為 HMAC 簽章，舊 token 仍檢查七天時效及不可為未來時間。

## 正式搬家次序

1. 確認官方 Wrangler 部署授權及現有密鑰搬移授權。不得購買未核准的付費方案。
2. 先建立新空 D1，將實際 ID 加入設定，套用 `migrations/0001_storage.sql`。
3. 保持 `DATA_READY=false`，先部署到 workers.dev；這時正式網址仍使用原站。
4. 舊站部署本 repo 的維護閘門程式；先設定 `MIGRATION_READ_ONLY=true`，保持 `MIGRATION_TARGET_ORIGIN` 空白。**在正式 hostname 還指向 Render 時，不能先啟用同 hostname 轉址。**
5. 將現有 Mongo 連線設於本機程序環境，匯出新的私人目錄；不要在 terminal 輸出連線字串。

   ```sh
   python scripts/export-mongo.py --confirm-source-read-only --output private/final-source
   python scripts/migration-to-sql.py --snapshot private/final-source/snapshot.json --output private/final-source/import.sql
   npx wrangler d1 execute dynasty-data --remote --file private/final-source/import.sql --yes
   node scripts/verify-d1.mjs --database dynasty-data --source private/final-source/snapshot.json --output private/d1-import-verified.json
   ```

6. 比對完整文件、revision、hash、人物/分析/存檔數。無法辨識的 BSON、未知版本及不一致資料必須保留原件並停止切換，不能刪減後宣稱成功。
7. 在獨立預覽上驗證登入、原十欄及世界存檔讀寫、衝突保護、AI 一般/JSON/串流、三個超限史料 JSON 與 PWA。正式資料寫入測試前先保存匯入原件，使用相同內容的小 patch 並記錄 revision 變化。
8. 完成驗證才將 `dynasty.piamamba.com` 切到 Worker custom domain。原 hostname 不變，本機 localStorage 保留。
9. 新站確認後，舊 Render 設 `MIGRATION_TARGET_ORIGIN=https://dynasty.piamamba.com`，維持唯讀，舊入口導往新站。
10. 保存目的庫完整快照、無密鑰的設定與驗證報告。Mongo 原件及 Render 保留供回復，不要立即刪除。

## API 契約

`/api/auth`、`/api/userdata`、`/api/world-workspace`、`/api/gemini`、`/api/gemini/stream` 與 `/api/health`。
受保護 API 仍使用 `x-app-token`。資料更新仍採 revision CAS；只修改明確提供的欄位，未知欄位及省略欄位保留。
世界資料維持原 8MiB 上限；userdata 分塊總額上限 32MiB。所有 D1 row 小於 2MB，不能把大型文件放單列。
SSE 維持 model/text/[DONE] 格式；錯誤或不完整回覆保留已顯示文字，禁止宣稱完成。

## 回復

切換前可取消搬家、解除原站唯讀，目的庫保留作查核。**切換後不可直接把 DNS 指回原 Mongo，否則會遺失新站存檔。**先暫停新寫入、匯出 D1 原件及新進度，核對雙邊差異，再還原到原站或修復 Cloudflare。舊 token 不含 HMAC 支援的原 Python 端不接受新登入 token，回復需重新登入。

## 靜態內容與方案額度

細節见 `ASSETS.md`；build 報告預設按免費的 20,000 檔、單檔 25MiB 門檻檢查。目前 19,733 個資產、4,254 篇文件、9,823 組既有 gzip 全內容驗證。公開人物來源 metadata 與私人分析／存檔分別由原公開目錄與受保護資料 API 提供。

免費資源仍有每日请求、資料庫和 Durable Object 的額度，超額會拒絕操作。購買網域不等於無限主機額度。正式部署實測與帳號方案才決定是否適用，不自動升級方案。

官方依據（2026-10-09 查閱）：

- [Workers 靜態資產](https://developers.cloudflare.com/workers/static-assets/)
- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Objects 限制](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [D1 限制](https://developers.cloudflare.com/d1/platform/limits/)
