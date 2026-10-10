# 王侯將相：50 人歷史分析補完交接

## 1. 任務與範圍
接手現有網站 https://dynasty.piamamba.com/play 的人物分析補完工作。人物庫目前 962 人，本次只處理固定清單中的 50 人（15 帝王、20 將領、15 名臣）。不是重寫網站、遊戲或校準評級，也不是補完全部 962 人。
原始 repo：https://github.com/kobejordanair-bit/----vs-.git 。本地分支 codex/analysis-batch-50；大量本次檔案尚未提交，不能只 clone 遠端就假設已有全部任務材料。

## 2. 目前確實完成的內容
以交接包 analysis-batch-50/progress.v1.json 及實際 apply 回執為準。
- 完整匯入：01 漢光武帝、02 宋太祖、03 康熙帝、04 明成祖、07 乾隆帝，共 5 人。
- 部分匯入：06 秦昭襄王，已有賞析、五維及五維理由；缺靈魂內核。
- 05 唐高宗：稿件曾生成但史實查核不合格，未匯入。統率理由把李勣任命寫在 668 年；應區分 666 年任命遼東道行軍大總管與 668 年攻克平壤。失敗稿及雜湊保存在 attempts/05.analysisStats.1/。尚未修正、尚無靈魂稿。
- 08–50 共 43 人尚未生成。
- 已發布 23 欄位、影響 6 人；最新已驗證資料 revision 7。仍有 45 人未全套完成。
- import.01-01.dry-run.json 未 apply；不能把它算成另一筆發布。
- 原 pause-audit 為較早 19 欄位紀錄。最新狀態請看 progress、07 報告及 3 筆實際發布回執，勿混用日期。

## 3. 每人必須交付的四個欄位
1. analysis：完整賞析，保留原四章結構與原 PROMPT。
2. stats：統率、武力、智謀、政治、魅力，固定順序，五個 0–100 整數。
3. statsAnalysis：上述五項各有具體理由、事件與對照；不能只有分數。
4. soulEssence：說話邏輯、壓力反應、核心驅動、慣性盲點、情感結構、參照系、內在裂縫，七欄完整，使用原要求的 [史載]、[推斷]、[詮釋] 標示。
保留原 deepAnalysis（校準評級）、rank、人物 ID、原文、遊戲進度及其他所有已有欄位。不得以通用套話替換人物差異。

## 4. 作者與執行環境：先確認，不能偽造
既有流程要求實際 ChatGPT 網頁產稿及實際網頁搜尋，Claude/Codex負責執行、整理、查核與匯入。現有 manifest/policy、capture 與來源紀錄依此設計。
使用者現在希望交由 Claude 執行，尚未明確選擇是否同時改由 Claude 撰寫。接手時一次確認：仍由 ChatGPT 產稿，或改由 Claude 產稿。
若改為 Claude：先另建可稽核的 provider/provenance 版本與驗證適配，保留原始 manifest、PROMPT 和既有回執，增加遷移紀錄及測試，再處理新稿。不要把 Claude 文字標成 ChatGPT、捏造瀏覽器回應或搜尋證據，也不要為通過測試移除作者驗證。
原 Windows 本機 C2C 連接、已登入瀏覽器、Wrangler OAuth、私有快照都不在包內；雲端不會因拿到 ZIP 就自動取得這些能力。不能存取 ChatGPT 時明確說明，不能冒充已執行。

## 5. 文風與搜尋查證
逐人讀 tasks、原 prompts、existing/deepAnalysis、sources、同類 style-samples 與全局五維評分參考。原 PROMPT 是最終章節與格式規格；不可自行縮短成摘要。
沿用已完成文章的生動、深入、敢下判斷的風格，避免反覆「不能據此」等模板式防禦文字。主觀評價可以鮮明，史實、推斷、詮釋要區分。
每人實際上網查證。優先正史/原始史料、博物館/官方學術機構、學術研究；其他來源可作線索，但評分與重要史實須追到可靠出處。查核年代、官職、人名、因果、戰爭/政策歸屬及相互矛盾的說法。
不能把來源包等同於已搜尋；不能把 HTTP 200 等同於支持論點；不能聲稱讀過付費全文而實際只看摘要。每個正式引用須保存 URL、名稱、定位與支持的論點。保留原始稿、來源與修正版本，不能悄悄修改作者的分數或文字。

## 6. 已驗證的效率流程
07 乾隆帝已成功使用一人一次完整請求，同次搜尋共用於賞析與靈魂；一次回應拆成兩項原任務，0 次修正，23 個網站搜尋活動可見，來源查核通過，4 欄位已發布及畫面驗證。
合併輸入 39,618 字元，舊兩提示詞加一次評分參考至少 55,065 字元，減少 28.1% 字元；未量測 Token、美元或 Claude 額度，不能把它宣稱為等比例帳單節省。
讀一次共用資料，同一人內共享搜尋；每人完成即保存。原風格範本與任務章節保留，不以壓短文章省成本。查核只聚焦具體史實與格式；只重做錯誤欄位。避免頻繁輪詢、反覆登入、重建健康連接、重讀全部大檔或每人重新設計工具。
可以每 5 人整理一次包與進度，但完成數只計真正查核通過且發布驗證的內容；不要為湊 5 人等待或重做已發布者。

## 7. 建議執行順序
A. 先清點此包與本地 repo 差異，確認執行環境、作者選擇及搜尋能力。閱讀 progress、07 合併試跑報告、manifest、原 PROMPT 與風格範本。
B. 以 08 漢宣帝做新環境首例，沿用合併流程，生成、保存、查核、組裝為可匯入檔。完成首例即檢視流程；不必一次耗盡全部額度。
C. 修正 05 唐高宗，保留失敗稿紀錄，再生成缺少的靈魂。
D. 為 06 秦昭襄王完成靈魂，並先實作綁定既有發布回執的「部分完成後續補欄」匯入路徑。現有 importer 要求原四欄均缺失，不支援直接 soul-only 續補；不得放寬為任意覆蓋。
E. 接續 09–50，逐人產稿與查核，使用真實回執動態維護進度。
F. 最終 50/50 完整、962 總數與所有非目標資料保留檢查，交付最終清單、文章、来源、結果包、回執與網站顯示證據。

## 8. 既有工具與依賴
本包保留 analysis-batch-50 原相對路徑；其中含 prompts、tasks、sources、existing、drafts、reviews、attempts、fields/產物（以實際檔案為準）、結果及回執。
combined-pilot.mjs compile NN：建立合併上下文；split NN CHAT_URL：機械拆開同次原始回應；capture.mjs：解析與格式/雜湊/原PROMPT驗證；assemble.mjs：檢查來源審閱並組裝；import.mjs：規劃、CAS 寫入及保留檢查。
現有 ChatGPT 作者模式的 repo 根目錄命令：
    node analysis-batch-50/combined-pilot.mjs compile 08
    # 保存原始回應與真實搜尋證據到 08.combined.raw.md / .search-evidence.txt
    node analysis-batch-50/combined-pilot.mjs split 08 實際ChatGPT對話網址
    node analysis-batch-50/capture.mjs 08 analysisStats 實際ChatGPT對話網址
    node analysis-batch-50/capture.mjs 08 soulEssence 實際ChatGPT對話網址
    # 完成 reviews/08.*.json 的實際來源查核
    node analysis-batch-50/assemble.mjs 08 --output analysis-batch-50/results.08-08.v1.json
Claude 作者模式需先明確適配以上流程，不能直接套用假 ChatGPT URL。
本包是任務材料與流程交接包，不是獨立可部署網站。執行 mjs 還依賴完整 repo 的 cloudflare/src、cloudflare/scripts、backend/index.html、原網站模板存檔等。不要移除來源雜湊檢查以掩飾檔案缺失。
生產 OAuth/D1 adapter 與 baseline 快照在本機 ignored cloudflare/private，不隨包交付。雲端先交可查核的結果檔；回到具有合法權限的本地環境進行 dry-run/apply，是最容易開始的方式。
舊 audit-progress.mjs / final-audit-proof.mjs 假設十個連續五人全套批次，現在已有 01–04、06 部分、07 全套不同回執；不能盲跑覆寫進度。先按真實發布鏈適配。

## 9. 發布條件與驗收
發布前取得最新資料，按穩定 ID 對應，驗證來源與稿件 SHA，產生具體 dry-run、私有備份、CAS 比對 revision，遇到衝突重新讀取與規劃。写入结果不明时停止核对，不自动重试覆盖或回滚整库。
每次發布後讀回：四欄內容符合審閱稿，總人數仍 962，所有非目標欄位與 raw extras、原文章/評級/進度保持一致。06 只允許缺失的靈魂變動。
網站檢查賞析、五維及五維理由、靈魂七欄皆可閱讀；登入重整保留。前端登入格式修正已部署，不要順便重做整站。
交付需區分 generated / reviewed / assembled / imported / verified；未生成、失敗、部分完成、已發布不能混算。剩餘人物完整清單在 handoff-ledger.json。

## 10. 交接包邊界
包內是已整理的歷史任務資料、程式、來源審閱、公開結果/回執及風格範本。沒有 .env、密碼、API key、OAuth、cookies、C2C設定或私有使用者/遊戲快照。禁止要求把整個 private 資料夾、瀏覽器登入或密鑰傳到雲端。
使用者已有的免費額度由其帳戶確認；先記錄真實用量再估剩餘，不承諾固定美元能完成固定人數。首次使用先確認附件可存取，沒有上網能力就不要假装已查证。
