# 朝堂危局：缺糧朝會

這是一段三回合、零 AI 請求的跨時代架空遊戲。韓信、蕭何與魏徵的主張、台詞、信任與教訓都是**遊戲改編**，不代表史實，不替代人物館的原始簡介、已儲存深度分析或評級。遊戲規則不讀寫人物資料；人物分析面板只讀取人物館已有文章，不改動人物資料。

## 一局的結構

1. 缺糧朝會：修復糧道、徵集民糧、開倉賑濟。
2. 邊報入殿：增援要道、爭取停戰、採買商糧。
3. 最後一道詔令：整軍反制、稽核追糧、定額賑糧與協作。

糧儲、國庫、民心、邊防以及三位人物的信任均為 0–100。選擇顯示成本、即時效果與已知的延後後果。成本不足的命令無法執行。一次選擇只推進一個回合，結束後不能繼續下令。

第一回合的延後後果在第二回合**結束**結算；第二回合的延後後果在第三回合**結束**結算。最後一回合結束會結清所有待辦，不留下尚未支付的尾款。

## 信任、記憶與條件

人物會在回應中記起此前採納的命令。第三回合的合作加成會在選擇前明示：

- 韓信信任至少 65：整軍多得 4 邊防。
- 蕭何信任至少 65：稽核另追回 8 糧與 6 國庫；仍須先有 8 國庫支付稽核成本。
- 魏徵信任至少 65，且決策當下民心至少 50：民間協作多得 4 邊防。

停戰以**第二回合出使當下**民心至少 60 判定支持；成功在第三回合結算 10 邊防，失敗損失 8 邊防。後來提高民心不會追溯改變已發布的盟約。選擇卡會提前告知這個分支，沒有隱藏的隨機判定。

## 結局與取捨

共有五種可實際到達的結局，採依序判斷：

| 結局 | 最終條件 | 可重現路徑 |
| --- | --- | --- |
| 民心有糧，朝局再起 | 糧≥35、民心≥65、邊防≥40、國庫≥10 | 賑濟 → 停戰 → 稽核 |
| 邊關穩住，內政待補 | 邊防≥75、糧≥22、民心≥35 | 糧道 → 增援 → 整軍 |
| 糧道重開，國用可續 | 糧≥65、國庫≥18、邊防≥40、民心≥40 | 徵糧 → 商糧 → 稽核 |
| 一道裂縫，危局未解 | 糧＜20，或民心＜35，或邊防＜38 | 徵糧 → 增援 → 整軍 |
| 暫度難關，餘力有限 | 其餘情況 | 糧道 → 商糧 → 整軍 |

三回合原有 27 組組合，其中「賑濟 → 增援 → 整軍」因糧儲不足無法下令，其餘 **26 條路徑可完成**。任一未結束的合法存檔都至少有一個可負擔的選擇。結局不做單一分數排名；軍事、民心、庫存與國庫各自留下不同餘力。

## 前端模組合約

`court-engine.js` 提供 UMD 全域 `DynastyCourt` 及 CommonJS export：

- `ADVISORS`：不可修改的三位人物簡介，含 `id,name,role,stance,lesson,portrait`。
- `createGame()`：新局，`version:1`、`scenario:'court-grain-v1'`、`turn:0`，含 `resources,trust,log,pending`。
- `getScene(state)`：`id,title,eyebrow,description,news:string[]`。
- `getChoices(state)`：每項含 `id,title,description,advisor,cost,effects,trustEffects,delayedHint,disabledReason`。`cost` 是所需最低資源；`effects` **已包含成本的資源淨變化**，UI 不可再扣一次。效果可能受 0–100 邊界限制。
- `choose(state,choiceId)`：不修改輸入，回傳新 state。即時變化後結算到期事件，追加 `log`：`turn,choiceId,title,advisor,changes,reactions,consequences`。`changes` 是包含延後結算與上限修正的**實際**四資源差值。`reactions` 是 `{id,text}[]`，`consequences` 是文字陣列。`turn` 為完成的回合數 1–3。
- `pending`：`{id,sourceChoice,due,title,effects,trustEffects,news}[]`，`due` 為哪個回合結束結算。
- `getEnding(state)`：尚未結束回傳 `null`，結束後回傳 `id,title,summary,lessons:string[]`。
- `validateState(state)`：回傳 boolean。合法性不是只看範圍，而是從起始局依決策紀錄回放，逐欄比較資源、信任、待辦、回應與變化。拒絕竄改、不認得的欄位及不合法的序列。
- `exportReplay(state)`：`{format:'dynasty-court-replay',version:1,scenario,choices,ending,state}`，未結局 `ending:null`，已結局為結局 ID。
- `importReplay(objectOrJson)`：驗證完整包裝與 state 後回傳新 state，字串上限 40,000 字元。

錯誤以 `Error.code` 表示：`INVALID_STATE`、`INVALID_CHOICE`、`INSUFFICIENT_RESOURCES`、`GAME_COMPLETE`、`INVALID_REPLAY`。除 `validateState` 外，狀態讀取與寫入 API 都會拒絕無效 state。

存檔保護可發現不一致或手動修改的衍生欄位，**不是防作弊簽章**：使用者仍可自行重播一條合法路徑。遊戲無競賽或付費獎勵，因此不需要伺服器持有權威狀態。未來更改規則、台詞或數值必須新增 scenario/version 與轉移策略，不能悄悄變更既有存檔的確定性結果。

## 驗證

`node --test tests/court-engine.test.cjs`

測試包含 UMD 載入、輸入不變性、即時及延後後果、成本不足、回合防重、人物記憶與加成、停戰條件時點、五種結局、全 26 條合法路徑、實際數值上限、完整存檔與回放的竄改拒絕，以及中途恢復後的一致結果。
