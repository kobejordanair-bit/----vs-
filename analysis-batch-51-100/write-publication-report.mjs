// Generates a delivery summary from validated receipts and the final production proof.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReceiptLedger} from './receipt-ledger.mjs';
import {contentHash} from '../cloudflare/scripts/analysis-pilot-import.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const audit=JSON.parse(await readFile(resolve(root,'final-audit.publication.v2.json'),'utf8'));
const ledger=await buildReceiptLedger();
if(!ledger.complete||ledger.counts.verified!==50||ledger.counts.importedFields!==200)throw Error('verified_publication_required');
await writeFile(resolve(root,'claude-ledger.v1.json'),JSON.stringify(ledger,null,2)+'\n');
const report=`# 第二批 50 人：修訂審查與正式匯入交付

Claude 修訂來源：claude/trusting-curie-1akj3f，固定 commit 0f6103e1。
產生時間：${new Date().toISOString()}。

## 審查結論

已詳讀修訂回報並核對重點人物的實際正文、五維與靈魂內核。主要年代、地點、評分比較與來源立場問題已修正，局部補正後可發布。

校準表確有帝王／將領兩筆毛澤東。本機前次把單一同名條目當成唯一基準，這一點須更正；新版並列兩筆是正確處理。蔣介石與宋孝宗的比較方向已修正。

Codex 另外做兩人的局部編輯，詳見 editorial-revision.20261011.json，未改 Claude 原始 capture、未調整其最新五維分數：
- 楚威王：政治理由與已補的年代異說一致，不把滇池疆域當作其在位期間確證功績。
- 孫科：核讀 FRUS 電報，把 last June 的年份改為1939；電報實際提到孫科使團，修正「未直接記其角色」。信貸金額保留為當時電報所報消息，不當已核帳目。另以約一個月描述首次組閣，並依行政院資料修正返臺年份為1964。

來源：[FRUS 電報全文](https://history.state.gov/historicaldocuments/frus1939v03/d238)、[行政院孫科介紹](https://history.ey.gov.tw/Items/%E5%AD%AB%E7%A7%91/)、[行政院履歷](https://www.ey.gov.tw/Page/4ED2F231892187F9/73e92b3d-a0ef-4061-a6cf-17e42ff54601)。

## 正式結果（由證據重算）

| 項目 | 結果 |
|---|---:|
| 完整匯入人物 | ${ledger.counts.imported} |
| 讀回驗證人物 | ${ledger.counts.verified} |
| 新增欄位 | ${ledger.counts.importedFields} |
| 剩餘未完成 | ${ledger.counts.remainingIncomplete} |
| 正式資料 revision | ${audit.revision} |
| 保留人物总數 | ${audit.library.afterTotal} |

每人四欄：賞析 analysis、五維 stats、五維理由 statsAnalysis、靈魂內核 soulEssence。

50 次實際乾跑及正式寫入皆有公開回執，CAS 寫入前保存完整私有快照，每次讀回驗證。最後再次讀取正式 D1 資料，核對全部200欄雜湊、完整人物ID、原有內容、深度評鑑及 raw extras。非進度資料保留：${audit.preservation.nonProgressBaselinePreserved}；原始额外欄位保留：${audit.rawExtrasPreserved}。

網站：[王侯將相](https://dynasty.piamamba.com/play)。本次為正式資料匯入，不需要另部署網站程式。已開啟的頁面重新載入後取得新資料。

## 可重驗證的證據

- claude-ledger.v1.json：依實際回執及最終證據重算，complete=${ledger.complete}。
- claude-receipts.v1.json：50 次發布登記。
- import.NN-NN.dry-run.json／import.NN-NN.apply.json：逐人乾跑與讀回。
- final-audit.publication.v2.json：正式資料最終讀取與保留證明。
- 最終證據 SHA256：${contentHash(audit)}。
- 原典與作者稿證據仍可由 validateBatch50Evidence 重建；04、47 的發布副本另外重建明確編輯補丁。

## 閱讀品質與查證範圍

新版有具體論點與人物場景；魅力理由已區分政治吸引力與道德評價，現代人物的生涯與責任分析比前版完整。這是可發布版本，不等於50人全部史實均經獨立全文驗證。Claude 的網路來源多為搜尋摘要；原典引句已比對固定全文，版本異說與二手轉引仍有標註。括號網址與來源類型分類是後續引用工具改善項目，不影響本次實際內容、作者來源與發布證明。
`;
await writeFile(resolve(root,'PUBLICATION_2026-10-11.md'),report);
console.log(JSON.stringify({passed:true,people:ledger.counts.verified,fields:ledger.counts.importedFields,revision:audit.revision,complete:ledger.complete}));
