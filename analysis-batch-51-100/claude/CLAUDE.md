# Claude 作業規則（analysis-batch-51-100/claude）

## 交付

每完成一輪工作（撰稿、修訂、審查回覆），都自動產生交付檔案，不必等使用者要求：

1. 在 repo 根目錄執行 `python3 -I analysis-batch-51-100/claude/deliver.py <本輪起點 commit> [本輪回報檔]`；
2. 產出 `claude/delivery/DELIVERY-<HEAD>.md` 與 `LATEST.md`，連同回報一起 commit、push；
3. 用 SendUserFile 把 LATEST.md 送給使用者，回覆中附交接摘要。

交付檔案中的數字只能來自 deliver.py 實跑的檢查；檢查未通過時照實交付，不得手改。

## 省 token 的固定做法

- **先擋錯再交出**：`precheck.py` 已內含 `lint.py`，會擋下校準數字錯、比較方向反、日期事實標[推斷]，並對摘要提示過多、理由過短發出警告。lint 有 ERROR 就不交出。
- **不整份讀稿**：用 `section.py NN 統率 /關鍵字 --short` 只讀需要的區塊；改稿用短錨點（`patch.py`），不要貼整段舊文。
- **修訂一律走 `revise.sh NN K "原因"`**：它會先驗 delta JSON、先 dry-run 引句比對（`quotes.py --dry`），通過才封存舊產出；非 https 網址自動濾除。
- **查證交給子代理**：依 `RESEARCH_AGENT.md` 派 Sonnet／Haiku，可並行；主 session 只看回傳的 JSON，不看搜尋全文。
- **搜尋**：預設 `standard`，結果矛盾或太薄才升級 `extended`。
- **批次與 commit**：一個 session 處理約 10 人，換 session 時靠本檔與交付檔接續；整輪只 commit／push 一次（`commitrev.sh` 可一次涵蓋多人）。
