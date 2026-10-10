# 每人的查核規格

建立 `claude/specs/NN.json`。下列只是欄位示意，所有搜尋、網址、引句與查核說明都必須換成這個人實際完成的內容。不要把範例當作已完成的查核。

```json
{
  "webSearches": [{"query":"真實查詢", "returnedUrls":["https://實際結果"]}],
  "archiveChecks": [{"book":"shiji", "title":"實際原典篇名", "quote":"實際引句"}],
  "pageReads": [{"url":"https://實際已開啟來源", "tool":"WebFetch", "scope":"excerpt", "readAt":"ISO 日期時間", "textFile":"analysis-batch-51-100/sources/readings/01.official.txt", "textSha256":"保存文字的 SHA256"}],
  "extraSources": {
    "https://實際已開啟來源": {"title":"標題", "locator":"實際讀取段落及可支持的具體命題", "type":"official_institution", "access":"web_page_read"}
  },
  "limits": ["實際的工具／來源限制，沒有則空陣列"],
  "checks": {
    "analysisStats": [["identity-date", "具體核對內容"], ["five-dimensions", "五項事件、同類參照與短板的核對"], ["causality", "重要因果與反例的核對"]],
    "soulEssence": [["distinctive-person", "人物專屬場景及其史料依據"], ["interpretation", "哪些判讀屬推論，及其支撐事件"], ["seven-fields", "七欄各自的事件與內容核對"]]
  }
}
```

`archiveChecks` 會重新驗證 repo 原典全文與實際引句，不能把其他書的引句塞進來。原典網址由工具填入。

`web_page_read` 必須保存真正讀到的工具回傳文字；`pageReads` 在每次重建時核對檔案與雜湊。`scope:excerpt` 表示節錄，不能標成完整全文。可保存已讀文章全文時才標 `full_document`。此證據保留閱讀文字，不代表工具能獨立證明網路請求真實發生，作者仍須如實記錄。

只看搜尋摘要用 `web_search_result_summary`，而且 URL 必須在真實搜尋結果中。沿用既有來源包的狹義核讀用 `source_package_prior_review`，不能擴張其 supportedFact。三種來源類型是 `primary_text`、`official_institution`、`scholarly_primary`。

網路被擋時先換可讀的官方／學術來源或使用確實適用的固定原典全文；現代人物的重要爭議不可只用一則摘要定案。查證限制存於 limits 與 review；實質影響人物結論的限制仍須在正文具體說明。
