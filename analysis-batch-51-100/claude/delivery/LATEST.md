# 交付檔案：王侯將相第二批 50 人（51–100）

- 產生時間：2026-10-11 08:01 UTC（由 `claude/deliver.py` 實際執行檢查後自動產生，非手填）
- 分支：`claude/trusting-curie-1akj3f`，HEAD `0f6103e1`；比較基準 `0f6103e1`
- 作者：Claude Code (Anthropic)；審稿 independent:false（自我查核）
- 整體檢查：**全部通過**


## 一、驗證結果（本次實跑輸出）

| 項目 | 結果 |
|---|---|
| 兩批測試 `node --test` | tests 68 / pass 68 / fail 0 |
| 50 份結果檔證據重建 | `{"ok":50,"bad":[]}` |
| verify-preparation | `{"passed":true,"people":50,"originalPromptBindings":100,"combinedPackets":50,"firstBatchOverlap":0,"referencePeople":116,"manifestSha256":"a3a02fac420f353cb79cbdae1605baca1278ce13ae876d17314cc755aa43ec2f","privateDataRead":false}` |
| 總帳（claude-ledger） | `{"prepared":50,"generated":50,"reviewed":50,"sourceQA":50,"assembled":50,"imported":0,"verified":0,"partialImported":0,"importedPeople":0,"importedFields":0,"remainingIncomplete":50}` |
| 首批／pilot／backend／manifest／原 PROMPT／existing 相對 18cc53eb 的差異 | 無 |

## 二、五維總表（標出相對基準的調分）

| 檔號 | 人物 | 類型 | 統率／武力／智謀／政治／魅力 | 相對 0f6103e1 調整 |
|---|---|---|---|---|
| 01 | 孫文 | emperor | [55, 25, 82, 80, 97] |  |
| 02 | 唐憲宗 | emperor | [85, 25, 84, 86, 70] |  |
| 03 | 明世宗 | emperor | [60, 15, 92, 82, 55] |  |
| 04 | 楚威王 | emperor | [80, 35, 80, 72, 68] |  |
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
| 21 | 薛岳 | general | [90, 60, 90, 58, 85] |  |
| 22 | 裴行儉 | general | [95, 55, 96, 85, 90] |  |
| 23 | 狄青 | general | [90, 90, 86, 55, 88] |  |
| 24 | 虞允文 | general | [88, 40, 90, 86, 88] |  |
| 25 | 哲別 | general | [92, 88, 86, 45, 82] |  |
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
| 43 | 李林甫 | minister | [80, 10, 93, 90, 52] |  |
| 44 | 和珅 | minister | [72, 30, 88, 90, 50] |  |
| 45 | 楊嗣昌 | minister | [70, 20, 84, 82, 42] |  |
| 46 | 李鵬 | minister | [72, 10, 70, 78, 40] |  |
| 47 | 孫科 | minister | [55, 10, 66, 74, 56] |  |
| 48 | 嚴嵩 | minister | [62, 10, 84, 88, 50] |  |
| 49 | 溫體仁 | minister | [58, 10, 86, 84, 28] |  |
| 50 | 王衍 | minister | [40, 10, 70, 58, 85] |  |

調分人數：0（無）

## 三、本輪 commit

```
（無）
```

## 四、本輪新建撰稿嘗試（舊產出含雜湊封存）

（無）

## 五、檔案位置

- 文稿：`analysis-batch-51-100/drafts/NN.combined.draft.md`；分欄、capture：`analysis-batch-51-100/drafts/`
- 審稿：`analysis-batch-51-100/reviews/`；結果：`analysis-batch-51-100/results.NN-NN.v1.json`；總帳：`analysis-batch-51-100/claude-ledger.v1.json`
- 搜尋與查核證據：`analysis-batch-51-100/claude/specs/NN.json`、`NN.quotes.json`；舊版：`analysis-batch-51-100/attempts/`
- 修訂回報與提案：`analysis-batch-51-100/claude/REVISION_*.md`、`analysis-batch-51-100/claude/PAREN_URL_PROPOSAL.md`

## 六、固定限制

- 環境網路政策封鎖網頁讀取（WebFetch ENOTFOUND／代理 403），無 web_page_read；網路來源均為真實搜尋摘要，存取類型記於各 review 的 checkedSources。
- 未讀取密鑰／.env／OAuth／private；未寫入正式網站；正式匯入交由 Codex。
