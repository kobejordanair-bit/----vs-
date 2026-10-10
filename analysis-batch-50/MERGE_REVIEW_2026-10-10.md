# Claude 50 人成果：合併審閱

審閱基準：Claude 分支 commit 0b596aaa0f6c8cf1d7847711faa077fae432b650，2026-10-10。
結論：通過下列核對，補強程式與來源綁定後，可合併程式與待發布稿件。此合併不代表 45 人已匯入網站。

## 實際檢查
- 原分支在保持 Git 原始位元組後，60/60 測試通過。Windows core.autocrlf 初次轉換造成失敗，並非原稿內容變更。
- 45 個 Claude 結果檔全部重新經過 validateBatch50Evidence，含 06 soul-only。
- 原 manifest、progress、100 個原提示詞、50 個原任務、已完成稿件與回執，所選 225 個原始檔逐位元組比對無變動。
- 所有新完整賞析至少 3033 字元、靈魂至少 2237 字元；五維和理由均有資料。長度與格式不等於史實正確性。
- 實讀抽查 05 唐高宗、06 秦昭襄王、36 周恩來、43 朱鎔基、49 陳雲的賞析/五維理由/靈魂（06 只看新靈魂），另查張良的新增來源缺口。抽查未發現阻止合併的重大史實錯誤；不是全 45 人逐句獨立史實審稿。
- 五維分数保留 Claude 的判斷，不由 Codex 改寫。

## a：SOUL_FORMAT
單欄白名單、原回執雜湊、已發布三欄雜湊、原輸入雜湊、空靈魂檢查、CAS 寫入與讀回保留檢查，足以阻止通常的覆寫路徑。
另外補上 priorReceipt 的 schemaVersion、writeAttempted、targetsMatch、contentPreserved、revisionMatches、before/after revision、after 文件 SHA、unaffected SHA 等相互一致檢查。偽造總 passed 不能遮蔽失敗的讀回或保留證據。
測試加入更新回執 SHA 後仍拒絕錯誤驗證旗標、完整格式不得偷帶 priorReceipt、發布鏈重疊/同 revision 文件差異。

## b：來源與文章抽查
唐高宗的任命年 666、攻克平壤 668 已改正；《舊唐書》十月與《通鑑》十二月兩筆原文並列有依據。
- https://zh.wikisource.org/wiki/舊唐書/卷5
- https://zh.wikisource.org/wiki/資治通鑑/卷201
秦昭襄王的動員、拒絕出征、賜死白起與范雎進言等引句可以對應兩篇原典。
- https://zh.wikisource.org/wiki/史記/卷073
- https://zh.wikisource.org/wiki/史記/卷079
周恩來的履歷與保護幹部文電對應現存來源；政治心理判斷仍是詮釋，不能等同第一手內心證據。
- https://www.fmprc.gov.cn/web/ziliao_674904/wjrw_674925/2166_674931/200805/t20080509_9880973.shtml
- https://www.marxists.org/chinese/zhouenlai/151.htm
朱鎔基 2026-08-12 逝世已由正式機構刊載的訃告核實，1999 年中美聲明的談判項目也可核對。
- https://www.mod.gov.cn/gfbw/qwfb/16479036.html
- https://clintonwhitehouse6.archives.gov/1999/04/1999-04-08-joint-us-china-statement.html
陳雲跨區物資調度、財政金融協調的論述與黨史研究文章相符；心理/改革代價評價屬文章作者的歸納。
- https://www.dswxyjy.org.cn/n1/2020/0424/c423731-31686912.html

來源閘門現在會確認：全文來源存在於已比對的 archiveChecks；摘要來源存在於搜尋回傳網址；先前核讀來源存在於該人來源包；review 的 searchLogSha256 與 capture 一致。
新增閘門找到 38 張良的《通鑑》卷12來源未列入 archiveChecks。已實際比對固定版本的「太子將兵，有功則位不益，無功則從此受禍矣」並加入標明 Codex 獨立補查的來源紀錄。舊 metadata 保存於 attempts/38.source-evidence.1/。重新組裝 38 的 provenance，原始文章與五維沒有修改，也沒有冒稱此補查是 Claude 的搜尋。

## c：進度與發布鏈
新增 receipt-ledger.mjs，audit-progress CLI 與 Claude finish ledger 都改用它。
按實際 apply + dry-run 回執、結果內容雜湊與檔案重建核對，支援完整/分析三欄/靈魂單欄混合鏈；不信任 claude-receipts.v1.json 的 verified 宣告，不再要求十個固定五人批次。保留每欄原作者。
目前確實發布的鏈：01–04 rev4→5、06分析 rev5→6、07完整 rev6→7；23 欄、5 人完整、1 人部分。稿件組裝50，但網站仍待45人補完。
不以回執帳本宣稱最新線上962身份或整庫保存已完成最終核驗。整體 complete 仍 false，最終50人發布後需要新讀回及 mixed-chain 私有快照/身份/raw-extra審計；舊 final-audit-proof 固定十批的最終 runner 仍不能直接使用。

## 發布操作修正
06 舊 import.06-06.apply.json 必須保留。續補結果使用 results.06-06.soul.v1.json，新回執請用 import.06-06.soul.dry-run.json / import.06-06.soul.apply.json，避免與原三欄回執撞名或覆蓋。
後續 05、08–50 的順序可照原交付文件，逐筆先 dry-run。不要盲跑仍只支援原 fullmissing 的舊本機私有 SDK runner，須先適配新 evidence gate 與 SOUL_FORMAT。

## 其他合併修正與驗收
保留此前已部署的前端 signed/legacy 登入解析修正，避免合併後重整登出回歸。
.gitattributes 保留既有規則，增加 /analysis-batch-50/** -text，維持原稿/提示詞/雜湊精確位元組。
修正後測試：67/67，包括新發布鏈、防偽保留旗標、來源綁定與前端登入案例。45 份結果重建通過，進度 CLI 重算為50組裝/5完整匯入/1部分/23欄；complete=false。