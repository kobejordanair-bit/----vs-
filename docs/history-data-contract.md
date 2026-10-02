# 共用歷史資料格式 v1

更新日期：2026-10-02。機器合約：`schemas/history-package.schema.json`，結構版本仍為 1；楚漢資料包版本為 1.1.0，包含 301 條主張。資料供案卷館、時空探索、人物原典、自由調查、創作工坊共用；歷史資料包不包含技能加成、行動成本、人格真實性評分或架空結局。

## 1. 身份、事件與主張

資料包由 `persons / places / factions / events / claims / sources / relations / routes / economy / disputes` 組成。所有包內 ID 為 `命名空間:slug`，例如 `person:liu-bang`、`place:hongmen`、`event:hongmen-meeting`。不得以姓名或陣列位置作主鍵。

人物身份與原人物庫條目分開：劉邦和漢高祖可連到同一歷史人物，但兩個原條目 ID、分類、評級、五維與文章各自保留。`libraryRefs` 只保存手動核對的對應，不合併文章，也不代表當時職位。子嬰即使在原庫屬將領，事件角色仍按原文記為秦王。原庫沒有的歷史參與者標為 `context-only`，不冒充原962人物之一。

每個事件包含日期、地點、參與人物的當時角色與勢力。`contexts` 只表示本事件已查到的身份，不自動外推為整年或終身職位。

人物的 `life.birth / life.death` 各使用Time格式。未補查生卒年時保留unknown；最早／最後一條活動記述不能替代出生／死亡年份，也不能以缺少某年事件判定不在世。

`claims` 是可查證的最小主張，例如「原文記某人在某地投降」。各主張保存主體、關聯實體、日期、來源章節、短節錄、核對狀態及限制。人物、事件、關係、路線、供給條件以 `claimIds` 連接證據。

## 2. 日期

公元前年份使用 `{ "era": "BCE", "year": 206 }`，公元使用 `CE`；資料中沒有年0。程式可使用連續序數排序，但序數0不是公元0年。

`time` 必須保存：

| 欄位 | 意義 |
| --- | --- |
| `earliest / latest` | 年級別最早、最晚範圍；未知時兩者都為 null。 |
| `precision` | year、range、unknown。year 只代表範圍的年度粒度，不能衍生出某月某日。 |
| `original` | 原紀年、原月次或原文的相對時間。 |
| `normalization` | modern-year、regnal-year-band、not-normalized。 |
| `review` | source-checked、provisional、disputed。 |
| `note` | 換算依據、歲首問題、章節差異與尚待核對事項。 |

漢元年、二年等原紀年不是現代公曆年份；本包保守使用歲首可能跨年的年帶，不把十月、十二月直接轉成Gregorian月份。`orderAfter` 保存有依據的相對先後，不建立未證實的精確日期或因果。

未知與不確定區間必須參與查詢語義：年表顯示「可能涉及該年」，不能顯示為已確定發生在該年。沒有某人的活動記錄也不能判定他當時不存在。

## 3. 地理、勢力與關係

地點分為 region、city、site、pass、battle-area、river、route-area。site 用於會見地、倉等地點。古地名、別名、現代定位、定位精度分開記錄。缺乏核對座標時使用 null；示意圖排列不可當歷史座標或距離。

本包路線表示原文記載的移動／供給連接，不表示最短路、唯一通道或可任意逆向通行；未核距離為 null。

勢力是具體政治組織或聯合體，不等於朝代標籤。`leaderIds` 只限包內涵蓋的組織版本，不推論終身領導。楚王懷王組織與分封後西楚，韓王成的韓與劉邦的漢，使用不同ID。

關係分為事件內關係與有依據的時間區間。事件關係必須有 `eventId`；interval 關係不得借一條事件證據聲稱全期間有效。關係有方向，合作不等於永久盟友；比較文章提及某人不等於真實交往。控制地區的關係也不能外推為完整疆域。

事件context的 `participation` 區分 present、reported-action、mentioned、unknown。被張良建議爭取的人物不代表在下邑談話現場；同一事件有多人行動也不代表同處一室。人物編排檢查的是史料中的關聯強度，不替玩家宣告未記載者絕不可能在場。

## 4. 知識狀態與缺漏

- `source-report`：已核到史籍如此記載；不表示此史籍敘述已被獨立證明。
- `editorial-synthesis`：編輯整理、身份判別或章節綜合，須保存依據與理由。
- `modern-identification`：現代定位或研究結論，另附相應來源。
- 查證狀態與日期換算狀態分開。原文可已核對而現代日期仍 provisional。
- 來源衝突保存在 alternatives 與 disputes，不偷偷選一個版本當唯一答案。
- `[]` 表示本包尚未列入相關資料，不表示歷史上確定沒有。`null` 表示該欄未知或尚未定位。

## 5. 經濟與原人物分析

經濟先保存供給、行政、運輸、分配的機制。數量必須有單位、來源範圍，以及 source-reported 或 research-estimate 標記；本包沒有遊戲平衡數值。不得以不同時代的人口、貨幣或兵力未加說明地比較國力。

原人物庫的 `analysis / deepAnalysis / soulEssence / stats` 保留在原 App 及私人備份。本包只帶對應 ID。讀取器可按 ID 取得原內容，但不寫回、不上傳、不自動補缺數值。原庫作者／AI 解讀不提升為史實。人物原典可瀏覽目前載入的全部原庫記錄；私人完整快照的 962 筆可閱讀，不代表全部已完成歷史包身份與來源連接。楚漢包仍精確連接 19 位人物的 20 個原條目。

目前的原文材料引用保存 `recordId / recordName / recordType / field / paragraphIndex / fingerprint / articleFingerprint`，以及可為 null 的 `personId`。未連入歷史包的原庫人物可用 null 身份作原庫解讀材料；不因此增加虛構的史料身份。段落與全文內容指紋用於回讀時檢查是否改動，不提供作者身分或史實認證。

後續若新增衍生行為檔，應另存原文依據與改編規則版本。歷史資料版本、人物解讀版本與玩法規則版本分開，不能用新的史料或解讀無聲改寫既有紀錄。

## 6. 版本與驗證

`schemaVersion` 定義結構版本；`packageVersion` 定義資料修訂。已發行ID保持穩定，刪除／合併要有遷移紀錄。現有朝堂存檔與引擎保持其原scenario/version，不以新史料改寫舊回放。

驗證包括嚴格schema、全域ID唯一、引用存在與類型、日期先後、事件排序無環、角色與事件證據、證據來源、包的覆蓋範圍、來源節錄及原庫ID對應。結構驗證不能證明史實；史實查證另按查證規則審核。

事件角色至少有一條 `event-role` 主張（讀取器也接受同義的 `role-at-event`）同時連到本人、當前事件與所列非 null 勢力，不能只掛一般人物傳記。人物、地點、勢力、事件、經濟條目的證據必須連到該條目；關係與路線的證據須連到兩端。`cross-checked` 至少有兩處不同的來源 ID 與原文章節位置；重複同一位置不算第二處核對，同書不同章也不等於獨立見證。

## 7. 主張用語

首包使用以下 predicate。每個 predicate 僅描述主張類型，歷史有效性仍須讀 `statement / time / evidence / caveat`。來源報告不會因名稱而變成絕對事實。

| predicate | 表示什麼 |
| --- | --- |
| source-person-identity | 人物身份與名稱的原文依據。 |
| source-faction-identity | 特定組織版本、王號或制度變動的記述。 |
| source-place-name | 原文使用此古地名。 |
| source-chronology | 原紀年或相對先後的記述。 |
| source-variant | 多篇記述的差異，保留異說。 |
| event-action | 此事件中的一項具體行動記述。 |
| event-role | 本人、事件、當時角色及已列勢力的證據連接。 |
| event-location-mention | 此事件提及此地，不自動表示全部行動都發生在此。 |
| event-advises | 此事件中的建議關係。 |
| event-recommends | 此事件中的推薦關係。 |
| event-cooperates | 此事件中的協作關係。 |
| event-negotiates | 此事件中的交涉關係。 |
| reported-movement-direction | 原文記述從一地移向另一地。 |
| reported-supply-direction | 原文記述兩地間的供給方向。 |
| reported-economic-mechanism | 有出處的行政、供給或運輸機制。 |
| modern-location | 現代機構或作者的地望判定，不等於已確定座標。 |

擴充 predicate 時同步更新這張表、產生器與消費端的解釋。schema 接受 ASCII slug 以便擴充；不應以新增一個名稱繞過查證規則。人物分類、能力值與人格解讀使用原庫及衍生層，不能混入這些史料主張。

## 8. 案件集與玩家存檔

案件集另附嚴格機器合約 `schemas/history-casebook.schema.json`，由 `scripts/build-history-case-schema.cjs` 產生。案件集 `chuhan-cases.v1.json` 的 format 為 `dynasty-history-casebook`、schemaVersion 為 1、version 為 1.0.0，聲明所用 packageId 與 packageVersion。六案包含十八章、三十個任務，各有穩定 case／chapter／task ID。它保存情境、問題、選項與回饋、人物閱讀角度及開放結案；所有證據以 claim ID 指向共用包，不另複製一套史實。完整內容規則見 [案卷編寫規則](history-case-authoring.md)。

單選與多選使用 expectedChoiceIds；排序使用 acceptableOrders。每個選項與回饋須指向已有主張。這些標準只檢查來源的讀法與事件範圍，不評人物心理真偽。結案包含解釋、反證或替代解釋、未解問題；最低文字長度與材料數只能檢查空白或缺項，不能代表解釋品質。

玩家存檔使用 `format: dynasty-history-investigation`、schemaVersion 1，保存 packageId／packageVersion、casebookId／casebookVersion、案件進度、工作區、評議封存與復原草稿。工作區涵蓋五模式選擇、時空篩選、創作工坊人物及筆記、自由調查。它不保存整份原人物陣列或原分析全文；自行輸入筆記的文字則會保存與匯出。

localStorage 的命名空間以存檔結構版本和資料包 ID 區隔，作用範圍是同一網址來源與同一瀏覽器。匯出 JSON 可跨瀏覽器或連接埠搬移。重新讀入原人物 JSON 後，以 ID、姓名、分類、段落與內容指紋恢復原文引用；缺檔、缺欄、段落變動及全文其他部分變動各自標示。

匯入先嚴格驗證欄位、引用、答案、版本及大小，再產生預覽；使用者選擇合併或接續匯入版本後才套用。同案不同工作保留在草稿復原區，自由調查同題差異保留副本。還原封存評議前保留目前草稿。已知的 `dynasty-history-comparison` v1 可以遷移；其中沒有指紋的原文引用需重新選段核對。

若結構與引用仍相容而資料包或案件集版本已改，保留筆記及選項、將任務提交及結案狀態退回待核，舊評議仍保留原版本。未知結構版本、錯誤引用或損壞資料拒絕自動載入。已有存檔讀不懂，或另一分頁改動了同一存檔時，停止自動覆寫並保留原資料，供使用者匯出及處理；保存受阻則保留當前頁面工作並提示下載。

## 9. 補充研究的可重建性

資料包 1.1.0 在原研究輸入外增加 `data/history-research/investigation-supplement.json`，內含 20 條 canonical Claim、附著實體及實際核讀記錄。產生器依 sourceId 與正規化段落定位逐項比對核讀記錄，並檢查 ID 衝突與附著關係，再整合回 301 條主張；案件集只能引用整合後的共用主張。

本包繼續明示 `curated-slice`。新增案件不會自動補成完整年表、地理模型、人物生卒或 962 筆史料化傳記；每次擴充仍須聲明所補範圍與未完成事項。
