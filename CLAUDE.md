# Claude 網站工作權限（2026-10-13）

使用者已授權 Claude 修改王侯將相網站前端，並透過專用 GitHub 工作流程自行部署正式站。

## 網站頁面任務

- 從最新 main 開始，在環境指定的 `claude/*` 分支工作。
- 可發布：`backend/index.html`、`history-lab.html`、`source-archive.html`、`manifest.json`、`sw.js`，以及 `backend/static/css/`、`js/`、`art/` 的前端素材。實際格式由 `scripts/claude-frontend-release.mjs` 控管。
- 維持既有登入、備份、人物及 `appState.chatHistories` 格式；舊對話不可清空。請自行完成 UI 測試、桌機與手機預覽，再發布。
- 建立以 main 為目標的非草稿 PR，PR 只包含上述前端檔案，更新到最新 main，推送。
- 取得完整 head SHA，在該 PR 留言，**第一行**必須正好是 `/deploy-dynasty <40字元SHA>`；第一行之後的文字（例如工具自動附加的署名）會被忽略。留言必須由具儲存庫寫入權限的帳號送出。也可在 main 的 Actions「Claude frontend production release」輸入 PR 編號與 SHA 執行。
- 等待 Actions 成功，核對正式網址及發布回執；流程會在核對上線素材後合併 PR。失敗不要宣稱已完成；若上線後合併失敗，先比對正式版與 main 再處理。
- 正式網址：https://dynasty.piamamba.com/play

## 發布邊界

發布流程使用 main 上固定的建置器、套件鎖定、Worker 與 bindings；不執行 PR 提供的 Node 程式或建置工具。發布 Token 留在 GitHub 的專用環境，不提供給 Claude 工作區。

後端、資料包、人物文章、PROMPT、Cloudflare 設定、資料遷移、密鑰與發布流程不屬於這項前端授權。需要改動時另列交付項目。前端仍可呼叫既有 API，因此必須維持保存及刪除的使用者操作規則。

## 人物撰稿任務

封存的人物批次 handoff、manifest、作者政策與來源查證要求仍照原規則；本文件只新增網站前端任務授權，不改動批次發布政策。
