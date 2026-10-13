# 時空私訊：LINE 操作＋歷史美術

日期：2026-10-13。使用者選擇 LINE 式聊天＋王侯將相歷史美術。程式與本機預覽已完成，2026-10-13 已發布至正式網站。發布證據與資料保留核對見 docs/releases/chat-messenger.20261013.json。

## 使用體驗

- 桌面：左側往來人物與最新訊息摘要，右側人物私訊；姓名、稱號、朝代皆可搜尋。
- 手機：人物列表與對話單頁切換；固定標題及輸入列、訊息區獨立捲動。
- 宣紙色底、墨綠與青玉訊息泡泡、姓名印章頭像，保留歷史角色語氣。
- 新對話提供開場問題；多行輸入，Enter 傳送、Shift+Enter 換行，中文輸入法不誤送。
- 人物小傳、舊對話保留、每位人物的輸入草稿、回信狀態及失敗重試。

## 功能相容與修正

仍使用 appState.chatHistories、syncToCloud 與 callGeminiNative；AI 呼叫和人物靈魂內核沿用網站原有設定。本次沒有更換模型或修改原 PROMPT／人物分析資料。

新增訊息的 createdAt 是實際訊息時間；沒有時間的舊訊息顯示「既有對話」，不虛構舊時間。保留 user/model 的歷史紀錄格式。介面不顯示虛構的上線／已讀狀態。

已修正：等待時切換／關閉視窗，回信仍保存到原人物，不串到新視窗；同人物防重複傳送；清除記憶使舊請求失效，確認回呼固定原人物 ID。使用者文字及人物名稱以 textContent 顯示，人物 Markdown 仍走現有 DOMPurify。

## 實際驗證

- 8 項聊天 DOM 行為測試通過，沒有跳過項目。
- 連同既有資料備份、持久化、登入保留，共 47 項相關測試全部通過。
- 4 個 HTML 內嵌 script 通過 JavaScript 編譯檢查。
- Cloudflare assets 建置完成；index.html、新 CSS、新 JS 與來源檔逐位元一致。
- 瀏覽器檢查：桌面預覽、等待時切換人物、回信歸屬、手機返回列表及人物搜尋。
- 手機 390×844：文件寬度390、標題按鈕無橫向溢出、輸入列在可視範圍內。檢查後已恢复預設視窗尺寸。

本機预覽只用公開內建人物與明確標示的示例訊息，沒有讀取正式人物／對話快照、沒有呼叫真實 AI、沒有正式寫入。

## 檔案與重開預覽

- backend/index.html：聊天 UI 與原網站的整合。
- backend/static/css/chat-messenger.css：桌面／手機樣式。
- backend/static/js/chat-messenger.js：對話互動及請求歸屬。
- tests/chat-messenger.test.cjs：DOM 行為測試。
- scripts/chat-messenger-preview.mjs：獨立本機示例，不需要登入或密鑰。

從 repo 根目錄執行 `node scripts/chat-messenger-preview.mjs`，開啟 http://127.0.0.1:8890/chat-preview。若已有預覽服務運行，直接開啟網址即可。

部署正式站時，從本分支建置 assets 並使用既有 Cloudflare 發布流程；只更新前端，保留現行正式資料與密鑰。
