# 交付檔案：王侯將相第二批 50 人（51–100）

- 產生時間：2026-10-10 18:17 UTC（由 `claude/deliver.py` 實際執行檢查後自動產生，非手填）
- 分支：`claude/trusting-curie-1akj3f`，HEAD `8f5bbb42`；比較基準 `4f2ba130`
- 作者：Claude Code (Anthropic)；審稿 independent:false（自我查核）
- 整體檢查：**全部通過**
- 本次修訂回報：`analysis-batch-51-100/claude/REVISION_2026-10-11.md`

## 一、驗證結果（本次實跑輸出）

| 項目 | 結果 |
|---|---|
| 兩批測試 `node --test` | tests 68 / pass 68 / fail 0 |
| 50 份結果檔證據重建 | `{"ok":50,"bad":[]}` |
| verify-preparation | `{"passed":true,"people":50,"originalPromptBindings":100,"combinedPackets":50,"firstBatchOverlap":0,"referencePeople":116,"manifestSha256":"a3a02fac420f353cb79cbdae1605baca1278ce13ae876d17314cc755aa43ec2f","privateDataRead":false}` |
| 總帳（claude-ledger） | `{"prepared":50,"generated":50,"reviewed":50,"sourceQA":50,"assembled":50,"imported":0,"verified":0,"partialImported":0,"importedPeople":0,"importedFields":0,"remainingIncomplete":50}` |
| 首批／pilot／backend／manifest／原 PROMPT／existing 相對 18cc53eb 的差異 | 無 |

## 二、五維總表（標出相對基準的調分）

| 檔號 | 人物 | 類型 | 統率／武力／智謀／政治／魅力 | 相對 4f2ba130 調整 |
|---|---|---|---|---|
| 01 | 孫文 | emperor | [55, 25, 82, 80, 97] |  |
| 02 | 唐憲宗 | emperor | [85, 25, 84, 86, 70] |  |
| 03 | 明世宗 | emperor | [60, 15, 92, 82, 55] |  |
| 04 | 楚威王 | emperor | [80, 35, 80, 72, 68] | 統率 82→80 |
| 05 | 唐玄宗 | emperor | [78, 50, 84, 82, 86] |  |
| 06 | 蔣介石 | emperor | [80, 45, 78, 70, 82] |  |
| 07 | 宋真宗 | emperor | [65, 30, 76, 78, 72] |  |
| 08 | 洪憲帝 | emperor | [84, 40, 86, 72, 58] |  |
| 09 | 慈禧太后 | emperor | [58, 5, 86, 68, 62] |  |
| 10 | 梁武帝 | emperor | [78, 55, 84, 78, 74] |  |
| 11 | 漢元帝 | emperor | [48, 18, 66, 62, 74] |  |
| 12 | 唐穆宗 | emperor | [32, 28, 50, 38, 48] |  |
| 13 | 同治帝 | emperor | [35, 15, 48, 45, 52] |  |
| 14 | 宋高宗 | emperor | [52, 30, 80, 72, 52] |  |
| 15 | 道光帝 | emperor | [42, 45, 60, 62, 55] |  |
| 16 | 常遇春 | general | [95, 97, 86, 55, 88] |  |
| 17 | 李定國 | general | [95, 85, 88, 45, 90] |  |
| 18 | 呂蒙 | general | [93, 82, 95, 72, 88] |  |
| 19 | 楊素 | general | [97, 80, 95, 78, 70] |  |
| 20 | 王保保 | general | [92, 80, 85, 50, 85] |  |
| 21 | 薛岳 | general | [90, 60, 90, 58, 85] | 統率 92→90 |
| 22 | 裴行儉 | general | [95, 55, 96, 85, 90] |  |
| 23 | 狄青 | general | [90, 90, 86, 55, 88] |  |
| 24 | 虞允文 | general | [88, 40, 90, 86, 88] |  |
| 25 | 哲別 | general | [92, 88, 86, 45, 82] | 武力 92→88；魅力 84→82 |
| 26 | 桓溫 | general | [88, 75, 82, 86, 82] |  |
| 27 | 田單 | general | [88, 55, 97, 76, 90] |  |
| 28 | 孫傳庭 | general | [90, 68, 88, 58, 78] |  |
| 29 | 盧象昇 | general | [88, 90, 84, 52, 94] |  |
| 30 | 李如松 | general | [91, 88, 86, 42, 78] |  |
| 31 | 廉頗 | general | [92, 86, 82, 55, 84] |  |
| 32 | 蒙恬 | general | [88, 70, 76, 72, 80] |  |
| 33 | 李克用 | general | [90, 92, 72, 58, 85] |  |
| 34 | 封常清 | general | [84, 55, 85, 70, 72] |  |
| 35 | 劉錡 | general | [94, 82, 93, 50, 88] |  |
| 36 | 司馬光 | minister | [62, 15, 84, 70, 96] |  |
| 37 | 楊廷和 | minister | [86, 20, 88, 90, 82] |  |
| 38 | 陳群 | minister | [72, 20, 86, 92, 85] |  |
| 39 | 孫承宗 | minister | [92, 50, 90, 80, 88] |  |
| 40 | 海瑞 | minister | [55, 15, 64, 52, 92] |  |
| 41 | 曾國荃 | minister | [90, 62, 78, 80, 78] |  |
| 42 | 沈一貫 | minister | [62, 10, 82, 76, 48] |  |
| 43 | 李林甫 | minister | [80, 10, 93, 90, 52] | 魅力 35→52 |
| 44 | 和珅 | minister | [72, 30, 88, 90, 50] | 魅力 38→50 |
| 45 | 楊嗣昌 | minister | [70, 20, 84, 82, 42] |  |
| 46 | 李鵬 | minister | [72, 10, 70, 78, 40] | 魅力 30→40 |
| 47 | 孫科 | minister | [55, 10, 66, 74, 56] | 智謀 64→66；政治 70→74 |
| 48 | 嚴嵩 | minister | [62, 10, 84, 88, 50] | 魅力 32→50 |
| 49 | 溫體仁 | minister | [58, 10, 86, 84, 28] |  |
| 50 | 王衍 | minister | [40, 10, 70, 58, 85] |  |

調分人數：8（04、21、25、43、44、46、47、48）

## 三、本輪 commit

```
8f5bbb42 Batch 51-100: revision report for Codex review 2026-10-11
5c6b6a64 Batch 51-100: revise 43 李林甫, 44 和珅, 48 嚴嵩, 49 溫體仁 charisma scale per Codex review 2026-10-11
cb77536d Batch 51-100: revise 46 李鵬 source stance, procedure facts, charisma scale per Codex review 2026-10-11
50357c9f Batch 51-100: revise 41 曾國荃 plunder responsibility and official figures per Codex review 2026-10-11
4084f839 Batch 51-100: revise 25 哲別 shooting tradition, 武力/魅力 basis per Codex review 2026-10-11
57918c5c Batch 51-100: revise 27 田單 戰國策 citation per Codex review 2026-10-11
d5e595fd Batch 51-100: revise 04 楚威王 dating dispute for 越 and 莊蹻 per Codex review 2026-10-11
9b691d31 Batch 51-100: revise 47 孫科 tenure dates, Guangzhou terms, Soviet diplomacy per Codex review 2026-10-11
80200485 Batch 51-100: revise 21 薛岳 death place, source unit, 1947/1950 campaigns per Codex review 2026-10-11
27c42402 Batch 51-100: revise 08 洪憲帝 abdication bridge and absolute claim per Codex review 2026-10-11
14724960 Batch 51-100: revise 01 孫文, 06 蔣介石 calibration comparisons per Codex review 2026-10-11
```

## 四、本輪新建撰稿嘗試（舊產出含雜湊封存）

- `attempts/01.combined.2`：Codex 審查 2026-10-11：魅力對照之毛澤東校準條目未標明（表中帝王100／將領99兩筆），改為並列並補組織化差別；分數不調
- `attempts/04.combined.1`：Codex 審查 2026-10-11：莊蹻入滇與楚滅越系年有爭議，開場與統率理由卻當作確證功績；補後漢書卷86、資治通鑑卷002 異說，統率 82→80
- `attempts/06.combined.1`：Codex 審查 2026-10-11：毛澤東校準雙條目未標明、魅力對宋孝宗方向錯誤、武力未區分個人戰鬥；改寫四項比較並補杭州敢死隊紀錄；分數不調
- `attempts/08.combined.1`：Codex 審查 2026-10-11：開場由漢陽直接接到遜位詔，補 1912-02-12 時間橋接；刪「唯一一位試圖在民國重建帝制的人」（1917 張勳復辟可反駁）；分數不調
- `attempts/21.combined.1`：Codex 審查 2026-10-11：逝世地點誤作嘉義並錯標[推斷]、資料單位誤標國家教育研究院、生涯缺萊蕪與海南；補三戰例並重核統率（92→90）與靈魂內核
- `attempts/25.combined.1`：Codex 審查 2026-10-11：射馬改名與武力92、魅力84依據偏薄；補 Iranica／秘史來源並區分傳說與正史戰績，武力 92→88、魅力 84→82
- `attempts/27.combined.1`：Codex 審查 2026-10-11：魅力理由轉述《戰國策·齊策六》貂勃事未逐字比對、無引用入口；補比對並將通鑑有收錄的部分連到卷四；分數不調
- `attempts/41.combined.1`：Codex 審查 2026-10-11：入城劫掠僅一句二手摘要、與救荒篇幅及責任判斷不對稱，官書數字未標記稱；補轉引來源並獨立成過失，分數不調
- `attempts/43.combined.1`：Codex 審查 2026-10-11：魅力尺度與凍結校準（商鞅25、秦檜60、魏忠賢80、汪精衛95）不一致，逐人改量信任／追隨／聯盟／跨群體感召；李林甫魅力 35→52
- `attempts/44.combined.1`：Codex 審查 2026-10-11：魅力尺度與凍結校準（商鞅25、秦檜60、魏忠賢80、汪精衛95）不一致，逐人改量信任／追隨／聯盟／跨群體感召；和珅魅力 38→50
- `attempts/46.combined.1`：Codex 審查 2026-10-11：來源立場與事實未分、摘要延伸為心理結論、魅力重複扣分；補官方訃告與戒嚴令程序事實，魅力 30→40
- `attempts/47.combined.1`：Codex 審查 2026-10-11：立法院長任期誤換算為1931–1948、漏早期廣州市長三任與1932首次行政院長、1948日期未區分提名與視事；補對蘇外交後重寫功過，智謀64→66、政治70→74
- `attempts/48.combined.1`：Codex 審查 2026-10-11：魅力尺度與凍結校準（商鞅25、秦檜60、魏忠賢80、汪精衛95）不一致，逐人改量信任／追隨／聯盟／跨群體感召；嚴嵩魅力 32→50
- `attempts/49.combined.1`：Codex 審查 2026-10-11：魅力尺度與凍結校準（商鞅25、秦檜60、魏忠賢80、汪精衛95）不一致，逐人改量信任／追隨／聯盟／跨群體感召；溫體仁魅力維持28、補商鞅對照

## 五、檔案位置

- 文稿：`analysis-batch-51-100/drafts/NN.combined.draft.md`；分欄、capture：`analysis-batch-51-100/drafts/`
- 審稿：`analysis-batch-51-100/reviews/`；結果：`analysis-batch-51-100/results.NN-NN.v1.json`；總帳：`analysis-batch-51-100/claude-ledger.v1.json`
- 搜尋與查核證據：`analysis-batch-51-100/claude/specs/NN.json`、`NN.quotes.json`；舊版：`analysis-batch-51-100/attempts/`
- 修訂回報與提案：`analysis-batch-51-100/claude/REVISION_*.md`、`analysis-batch-51-100/claude/PAREN_URL_PROPOSAL.md`

## 六、固定限制

- 環境網路政策封鎖網頁讀取（WebFetch ENOTFOUND／代理 403），無 web_page_read；網路來源均為真實搜尋摘要，存取類型記於各 review 的 checkedSources。
- 未讀取密鑰／.env／OAuth／private；未寫入正式網站；正式匯入交由 Codex。
