# 王侯將相 v16.0

人物、史料、原有 AI 功能與可重播世界的整合版本。

正式入口：[世界書桌](https://dynasty-ydov.onrender.com/play) · [人物館](https://dynasty-ydov.onrender.com/) · [來源檔案館](https://dynasty-ydov.onrender.com/source-archive) · [歷史實驗室](https://dynasty-ydov.onrender.com/history-lab)

## 從哪裡開始

1. 以原密碼登入，打開「世界書桌」。系統接回目前人物館資料，不建立另一套人物庫。
2. 到「人物與背景」選擇 2–12 位人物，也可載入楚漢歷史切片。
3. 閱讀原分析，反白選段並寫下自己的解讀。可標記民生、秩序、進取、協調或學習原則，也可只保留引用。
4. 建立爭霸或魂穿世界。每旬選主措施、配套、執行人物、地域、對象和風格，閱讀預覽後結算。
5. 在「存檔與編年」接續、匯出或匯入世界；「全功能備份」保存人物館及本機所有新玩法進度。

原版逐鹿、魂穿五種組合、長篇魂穿、辯論、人物評鑑、對話、人物對照、場景、統計、編修與編年仍可從總覽進入。原版資料格式及十個雲端欄位保持相容。

## 交付文件

- [完整功能、資料流與操作說明](docs/v16-delivery.md)
- [世界規則、玩法與重播契約](docs/world-rules.md)
- [原文與歷史背景整合契約](docs/play-context-contract.md)
- [全功能備份、雲端衝突與復原](docs/workspace-vault.md)

## 本機啟動

需要 Python 3.10+、MongoDB 連線及原有 Gemini API 金鑰。一般新世界回合不使用模型；AI 入口沿用現有 Gemini 後端。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
```

填妥 `backend/.env` 後，在 `backend` 目錄執行：

```powershell
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8876
```

打開 `http://127.0.0.1:8876/play`。本機網址需要這個服務持續執行；日常使用正式 Render 網址即可。

公開程式與原典整理包含在程式包。私人評鑑文章、自訂人物、雲端進度與金鑰不會提交公開 GitHub；請從登入後的「全功能備份」匯出自己的即時資料。

## 驗證

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest tests -q
node --test tests/*.test.cjs
```

UI 行為測試需要 jsdom。可在獨立 QA 目錄安裝，再把 `JSDOM_MODULE` 設為其 `node_modules/jsdom` 絕對路徑；沒有 jsdom 時相關測試會明示跳過。這些是 DOM 行為檢查，不等於瀏覽器視覺驗收。

`node scripts/verify-source-web-release.cjs <網址> <報告路徑>` 會唯讀比對發佈的 HTML、程式、API 版本、認證要求與史料索引，不登入或改動正式資料。
