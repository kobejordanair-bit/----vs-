# 王侯將相第二批 50 人

從 GitHub main 最新版開始，所有工作集中於 analysis-batch-51-100。固定 manifest SHA256：a3a02fac420f353cb79cbdae1605baca1278ce13ae876d17314cc755aa43ec2f，正式資料基準 revision 52。50 人與首批無重複，保留既有深度評鑑，本批四欄皆空；完整名單見 PEOPLE.md。

## 任務

先讀 EDITORIAL_BRIEF.md，再按本批檔號 01–50 讀 prompts/NN.combined.prompt.md；一人一次共用搜尋與背景，完成賞析四章、第五章五維及七欄靈魂內核。既有 116 人五維已內嵌校準。每人實際網搜，查證原典、年代、同名與重要因果。sources/NN.* 是入口，不是替新文章蓋章的證據。

## 交付與驗證

開始先跑 `node analysis-batch-51-100/verify-preparation.mjs`。查核欄位詳見 `claude/SPEC_FORMAT.md`；本批新增 `web_page_read` 與保存閱讀文字的雜湊核對，讓確實開啟的官方／學術網頁與只看搜尋摘要有明確區別。

保留原始完整稿於 drafts/NN.combined.raw.md；真實搜尋、原典引句、來源 access 與自我查核放 claude/specs/NN.json，沿用首批 specs 的欄位格式，但不得複製舊人的查核結論。使用真實 session URL：

```sh
node analysis-batch-51-100/claude/finish.mjs NN https://claude.ai/code/session_實際識別碼
```

每人產生 results.NN-NN.v1.json、capture、review、search-log，重建 evidence 必須通過。先完整完成 01 孫文，自查文風、格式、引用與五維後繼續全部 50 人。不可用假搜尋或手填 passed 代替查證；審稿 independent:false。缺重要史料就補搜尋／確實可讀来源，不能用摘要冒充全文。

## 邊界

這是撰稿與證據交付，沒有正式寫入授權。禁止讀取 private、.env、OAuth、密鑰。不得改首批 analysis-batch-50、原 PROMPT、manifest、既有評級或深度評鑑。離線先 validateBatch50Evidence；正式乾跑、備份、CAS 與讀回由本機 Codex 接手。全套 repo 內已有完整原典庫；ZIP 不含整個原典庫，請在 repo 根目錄執行。

把結果推到新分支 claude/analysis-batch-51-100，回報 generated/reviewed/assembled 數、真實來源限制與需要抽查之處。
