# 全功能存檔與共用世界儲存

## 資料分工

- 原主程式的 `DynastyBackup` 格式、十個持久欄位、人物全文、經典逐鹿與魂穿、雲端 revision 保護繼續使用。
- `DynastyWorkspaceVault` 匯出一個 `dynasty-workspace-vault` v1 JSON：完整主程式備份，加上朝堂三版、本機史論調查、共用世界與保留版本。
- 私人人物文章只進入使用者自行下載的備份，不加入公開程式庫或靜態網站。
- 共用世界使用獨立 Mongo collection 與 `/api/world-workspace`，不寫入或改造原 `userdata`。
- 本機玩法還原與主程式雲端還原分成兩個明確動作。它們沒有跨瀏覽器與 Mongo 的共同交易；畫面不能宣稱兩者同時原子還原。

## Vault API

瀏覽器全域 `DynastyWorkspaceVault`，CommonJS 可 `require`。

```js
DynastyWorldStorage.registerWithVault(DynastyWorkspaceVault);
DynastyWorldStorage.setSessionValidator(save => {
  DynastyWorld.importSession(save); // 完整重播與逐欄驗證
  return true;
});

const exported = DynastyWorkspaceVault.capture({
  storage: localStorage,
  mainBackup: backupObject() // 使用既有函式保留全文、runtime 與 cloudExtras
});

const preview = DynastyWorkspaceVault.importPreview(fileText, {
  backupApi: DynastyBackup,
  currentData: captureUserData()
});
if (!preview.ok) throw new Error(preview.errors.join('、'));
// 顯示 summary、warnings；請使用者選擇本機保留目前版本或接續匯入版本。
const plan = DynastyWorkspaceVault.planRestore(preview, {
  storage: localStorage,
  strategy: 'preserve' // 預設；replace 會先保留被替換的版本
});
const result = DynastyWorkspaceVault.restoreLocal(plan, { storage: localStorage });
if (!result.ok) {
  // 顯示 rollbackComplete；recovery 含 before/proposed 原始字串，可下載保留。
}
// 若世界 key 有變動，接回 UI，不直接覆寫雲端。
worldStore.reloadLocal();
// preview.mainBackup 另送既有主程式還原預覽，不直接呼叫 applyUserData。
```

`summary`：`localEntries`、`ready`、`retained`、`hasMainBackup`。
`plan.summary`：`writes`、`retained`、`changed`。
`listRecoveries({storage})` 列出保留版本；`recoveryPreview(id, options)` 走同一個驗證與還原程序。

### 保留与寫入規則

- 只讀明確允許的 court / history / world keys；不讀登入 token、API 金鑰或整個瀏覽器的任意值。
- 朝堂三版由原引擎 `validateState` 驗證完整決策重播。缺少驗證程式時只封存。
- 史論檔先檢查封套與基本案卷結構，開啟史論館後再由其資料包與案件引擎驗證。可提供 `validators[key]` 執行更嚴格的資料包核對。
- 共用世界由 `setSessionValidator` 接入完整引擎重播驗證。
- 無效內容、新版封套、新版主程式備份保留原始內容，不自動啟用。
- 相同 key 的不同版本，預設保留目前進度，匯入版存至復原區；選 `replace` 則先保留目前版本。
- 完成全部前置驗證後才寫入；寫入前再次比對原值。配額或寫入失敗會反向回復已改值。若第三方在此時改動 key，不覆蓋第三方值，而是回報未能完整回復並提供下載。
- localStorage 沒有跨分頁交易或比較交換操作。模組在每筆寫入前後檢查原值，並保留復原資料，但不能提供瀏覽器崩潰或其他分頁同時寫入時的資料庫交易保證。
- 完整檔 128 MiB、單一本機項目 16 MiB、最多 250 keys，復原區最多 200 份。不自動刪除舊復原版本；超限時請先下載保留。

## 共用世界 API

`DynastyWorldStorage.create({storage,readCloud,writeCloud,onStatus,debounceMs})`。

- `readCloud()` 回傳 Response 或 `{revision,workspace}`。
- `writeCloud({revision,workspace})` 回傳 Response 或 `{status:'ok',revision}`。
- `capture()` 回傳目前 workspace；`getState()` 包含 `workspace`、`cloudWorkspace`、`ready`、`blocked`、`dirty`、`running`、`revision`、`state`、`message`。
- `update(workspace,{autosave:true})` 同步驗證並先写本機，回傳 `{ok,...state}`。無法保存時不套用新內容。
- `load()` 先讀雲端，回傳 `{ok,...state}`。讀取成功之前不會 POST。
- `flush()`、`retry()`、`keepLocal()` 非同步回傳 boolean。重試先讀雲端，可辨別上次 POST 成功但回覆遺失的情況。
- `adoptCloud()` 同步接續已讀取的雲端版本，先保留目前本機版本。
- `reloadLocal()` / `refreshLocal()` 接回整合備份匯入的本機版本，暫停自動同步，等待 `keepLocal()` 或 `adoptCloud()`。
- `getRecoveries()` / `restoreRecovery(id)` 用來接回先前版本；`captureRecovery()` 可下載本機、雲端、記憶體與復原區的完整原件。
- `dispose()` 停止排程，已送出的請求不被誤稱取消。

本機 key 為 `dynasty-world-workspace.v1`，內容直接是 workspace 封套。世界復原區為 `dynasty-world-workspace.recovery.v1`，最多保留 24 個不同版本；容量不足時不擅自捨棄另一版本。

### 雲端路由

```python
from world_workspace import create_router
app.include_router(create_router(db['worldworkspaces'], verify_token))
```

- GET `/api/world-workspace` → `{revision,workspace:null|envelope}`。
- POST 同一路徑，body `{revision,workspace}`，需既有 `x-app-token`。
- revision 不符回 409；第一筆建立競態也回 409。
- 8 MiB 串流請求上限，12 個世界存檔，每局最多 500 條敘事。
- 未辨識的目前雲端資料照原樣 GET，拒絕被本版本 POST 蓋掉。
- 世界封套的 `selection` 必須有 enabled、recordIds、setting、anchors、notes；會驗證 ID 唯一、選段範圍、玩家原則與結構上限，保留其他合法 JSON 認知欄位。驗證不查詢目前人物庫，因此舊備份中的未知人物 ID 仍可保留，原文選段不會自動改名或重新配對。
- 伺服器驗證儲存封套與大小；完整遊戲重播由客戶端世界引擎負責。存檔內容是玩家的假設世界，不是史實背書。

## 驗證

`node --test tests/workspace-vault.test.cjs tests/world-storage.test.cjs`

`python -m pytest tests/test_world_workspace.py -q`

測試包含原始私有文章完整傳遞、三版朝堂、實際史論封套、新版保留、配額回復、原始十欄隔離、授權、雙分頁 revision 衝突、網路回覆遺失、匯入後暫停同步、雲端原件保留，以及未授權 storage key 不被讀取。
