# 共用人物與史料背景 v1

模組：`backend/static/js/play-context.js`。瀏覽器全域 `DynastyPlayContext`，Node 使用 CommonJS。此模組只讀本機／網站資料，沒有模型、雲端存檔或人物修改副作用。

## 選擇格式

```js
const selection = {
  enabled: true, // 由呼叫端決定是否啟用；驗證器忽略此額外欄位
  setting: {
    kind: 'historical', // historical | counterfactual | free
    eventId: 'event:hongmen-meeting',
    time: null, // 可選創作時間；來源時間另存 sourceTime，不覆蓋
    placeIds: [], // 空陣列時採事件所列地點
    factionIds: [] // 空陣列時採事件角色涉及的勢力
  },
  recordIds: ['實際原人物庫 ID'],
  anchors: [
    {kind: 'analysis', recordId: '實際原人物庫 ID', field: 'deepAnalysis', start: 0, end: 30, quote: '必須與原文字元範圍完全一致', interpretation: '我對此人物在本局的解讀', principle: 'care'},
    {kind: 'claim', claimId: 'claim:具體主張 ID', interpretation: '此主張如何影響本局'}
  ],
  notes: '玩家創作筆記'
};
```

`recordIds` 必須在呼叫當下的實際人物陣列中存在。962 筆原人物和任意新增人物都能選用；不存在檔案館或楚漢包的 ID 不會被換成同名人物。原人物庫本身或選角出現重複 ID 時明確拒絕。`anchors` 的原分析字元座標使用 UTF-16，與 JavaScript `slice` 相同。文章更新後超出有效範圍的錨點顯示失效警告，不拼出替代引文。

新建分析錨點應保存 `quote` 原句；日後文章即使只修改等長文字，也會因引文不符而警告，不悄悄換成新句子。`principle` 可選 `care / order / bold / diplomacy / learning / none`，預設 `none`，是玩家指定的遊戲解讀原則，不是人物的已證實人格。

## 使用方式

```js
const repository = DynastyPlayContext.createRepository({
  fetchJSON: async (path, {signal}) => {
    const response = await fetch(path, {signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
});
const {manifest, package: historyPackage} = await repository.load({signal});
const resolved = await repository.resolve(selection, actualLegends, {
  modifications: appState.modifiedLegends,
  signal
});
const material = DynastyPlayContext.buildPromptContext(resolved, {maxChars: 12000});
```

- `load({signal, refresh})`：只讀小型網站 manifest 與楚漢包；回傳 `.package` 和 `.historyPackage` 相同內容的別名。
- `loadDossier(recordId,{signal})`：按精確 ID 逐筆讀人物檔案。自訂人物不存在時回傳 `null`，不按姓名猜測。版本、人物 ID 或 release 路徑不符時拒絕。
- `resolve(...)`：最多六個並行人物請求，只取得已選人物；來源主張直接來自楚漢包，不載全文書籍。選角與原分析先建立快照，再進行非同步讀取。新一輪 resolve 使舊結果回傳 `STALE_RESOLUTION`，呼叫端勿覆蓋最新畫面。
- `invalidate()`：清快取，使舊讀取回傳 `STALE_LOAD`。注入的 fetch 不理會 AbortSignal 時，取消仍會立即結束等待，舊結果不進快取。
- `resolveContext(selection, records, {modifications, manifest, historyPackage, dossiers})`：純函式，同步產生相同格式；未能連線時可保留原庫玩法並明示沒有來源資料。`dossiers` 支援 Map 或以精確 ID 為鍵的普通物件。
- `buildCharacterProfile(record,{modification,anchors,dossier,historyPackage,event})`：單人卡片；不更新人物資料。
- `validateSelection(selection,records)`：回傳 `{valid,errors,warnings}`，不拋出一般選角錯誤。

## 回傳與知識界線

`resolved` 包含 `setting / event / places / factions / profiles / claims / anchors / notes / warnings / provenance`。

每張 profile 有 `recordId / name / type / rank / title / dynasty / tag / description / stats / statsAxes / analysisSections / anchors / historyPersonId / eventContext / evidenceStatus / evidenceLabel / archive / links`。

- `analysisSections[].text` 保存完整字串或結構化物件中的原內容；分析物件依原順序保留欄位名稱與段落。`modifiedLegends` 明確覆寫原欄位，空字串也有效。ID 永不被 modification 改寫。
- 原分析、靈魂內核及人物介紹標為「原人物庫解讀／不等於史實證據」。角色意圖與偏好由玩家的可編輯解讀提供，不把文章自动升格為史實。
- `stats` 是原庫的 0–100 五維遊戲評分，順序固定為 **統率、武力、智謀、政治、魅力**。帝王、將領、名臣均與既有雷達圖順序一致；缺漏或無效評分為 `null`，不自創分數。
- `eventContext` 原樣保留參與狀態，`mentioned` 不變成親自在場，事件角色不外推至終身。
- `claims` 保留 `epistemic / review / time / caveat / alternatives` 與來源連結。來源未讀或資料未列入時不製造信心水準。
- 原庫引文標識為 `A:<encoded-record-id>:<field>`，史料主張為 `H:<encoded-claim-id>`；引文範圍另外帶 `start-end`。同名條目仍有不同標識與連結。
- 檔案館字面命中只提供閱讀入口；不把命中次數轉成史實、能力或人物關係。

## 注入既有功能

主網站低階 `_callGeminiStream` 和 `_callGeminiNative` 是所有既有 AI 流程的共同入口。呼叫端可在這兩處各自先複製 contents，再加一則 user role 材料訊息；只處理當次請求，不把材料寫入對話歷史，不重複在 `callGemini` 層再注入。保留 `contentsOverride`、role 順序、串流 callbacks、JSON flag 及 retry 行為。

共用設定未啟用時，既有流程原樣運作。材料本身不命令模型改變 JSON 格式或扮演新角色。人物對談、深度魂穿、自由魂穿、爭霸、朝堂、比較、辯論、評鑑都可使用同一段受限材料；選定角色應在 UI 明示，避免把別局人物默默加入。

主頁 v16 在頁尾配置 `DynastyWorldUI.configure({getRecords,getModifications,getMainBackup,getCurrentData,getToken,isReady,canBackup,launchLegacy,restoreMain,narrate})`。`launchLegacy` 支援 browse、analysis、chat、compare、hegemony、soul、soul-deep、debate、court、scenes、snapshot、chronicle、stats、add、edit、restore、backup、source、history、saves。比對與自由魂穿採所選 ID；逐鹿、辯論只填空位，不覆蓋現有角色。深度魂穿保留目前章節，開啟其既有設定流程。

`restoreMain` 只開啟既有讀檔預覽，回傳 `{pending,confirmation}`；主資料仍須按既有「備份現況並還原」才能上傳。`isReady` 用來管制互動與寫入，`canBackup` 額外允许在主資料出現雲端版本衝突時下載已載入的本機完整備份；生成或還原中仍暫停備份。

## 長度與效能

`buildPromptContext` 回傳字串，`maxChars` 範圍 512–200000，預設 12000。上限涵蓋說明文字和整份 JSON，按 UTF-16 code units 計數，**不是供應商 token 計費數字**。相同輸入產生相同材料。

先保留選角卡片和玩家明選錨點，再保留一部分來源主張，之後輪流納入各人分析節錄。原文章不在此處改寫，畫面仍可閱讀全文。材料記錄未納入的人物、文章、錨點與主張數量；預算極低時傳送完整可解析的缺省說明。所有長內容都作資料而非指令包裝，來源 URL 僅允許 http/https。

驗證：`node --test tests/play-context.test.cjs`。測試包含全部公開 ID 加自訂角色、同名不合併、完整物件文章、統一五維、引文失效、來源不確定性、硬性字元上限、取消與版本／路徑錯配。
