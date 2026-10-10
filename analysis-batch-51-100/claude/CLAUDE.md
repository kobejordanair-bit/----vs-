# Claude 作業規則（analysis-batch-51-100/claude）

- 每完成一輪工作（撰稿、修訂、審查回覆），一律自動產生交付檔案，不必等使用者要求：
  1. 在 repo 根目錄執行 `python3 -I analysis-batch-51-100/claude/deliver.py <本輪起點 commit> [本輪回報檔]`；
  2. 產出 `claude/delivery/DELIVERY-<HEAD>.md` 與 `LATEST.md`，連同回報一起 commit、push；
  3. 用 SendUserFile 把 LATEST.md 送給使用者，並在回覆中附上交接摘要。
- 交付檔案中的數字只能來自 deliver.py 實跑的檢查；檢查未通過時照實交付，不得手改。
- `commit.sh`／`commitrev.sh` 只負責單人 commit；整輪結束時才跑 deliver.py。
