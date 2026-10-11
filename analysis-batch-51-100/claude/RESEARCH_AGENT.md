# 查證子代理派工範本

主 session 用 Agent 工具派出，`model: "sonnet"`；只需列書目或確認單一日期時用 `"haiku"`。可以一次並行派多人。

子代理只負責查證，不改 repo、不 commit、不寫稿。它回報的是證據；寫稿和評分判斷都留在主 session。

## 派工 prompt（把 {} 換成實際內容）

```
你是查證助手，只做搜尋與核讀，不寫評論、不改任何檔案。
人物：{NN 姓名}（{類型}）
要核實的命題（逐條回答）：
{1. ……
 2. ……}
規則：
- WebSearch 預設 mode "standard"；結果互相矛盾或太薄時，才對該條改用 "extended"。
- 可以用 WebFetch 讀網頁的話，優先讀官方或學術頁，並保存讀到的原文段落。
- 不得臆測網頁標題；標題只能取自搜尋結果或實際讀到的頁面。
- 只收 https 網址。
- 立場要分類：官方定性／當事人自述／批評者／學術研究／百科／新聞。
最後只輸出一個 JSON，格式如下，不要其他文字：
{
 "webSearches": [{"query": "實際查詢字串", "returnedUrls": ["https://..."]}],
 "pageReads": [{"url": "https://...", "excerpt": "實際讀到的原文段落，200–800字"}],
 "findings": [{"claim": "命題", "verdict": "supported|contradicted|disputed|not_found",
               "evidence": "一句話", "urls": ["https://..."], "stance": "official|self|critic|scholarly|encyclopedia|news",
               "conflicts": "異說（沒有就留空）"}],
 "extraSources": {"https://...": {"title": "取自結果的標題", "locator": "支持的具體命題", "type": "primary_text|official_institution|scholarly_primary",
                  "access": "web_search_result_summary|web_page_read"}}
}
```

## 主 session 收到結果後

1. `webSearches`、`extraSources` 直接寫進 `$S/NN.delta.json`。
2. 有 `pageReads` 時，把 excerpt 存成 `sources/readings/NN.<slug>.txt`，算出 SHA256，填入 spec 的 `pageReads`；格式見 SPEC_FORMAT.md。
3. 依 `findings` 改稿：verdict 是 `disputed` 就異說並陳；`not_found` 不寫入正文。
4. 走 `revise.sh`（修訂）或 `run.sh`（新稿）。precheck 內含 lint，沒過就不會動檔。
