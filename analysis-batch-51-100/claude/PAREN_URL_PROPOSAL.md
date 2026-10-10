# 括號 URL 無法成為可點引用：原因與修正提案（交 Codex 決定）

## 現象

《戰國策》在 archive 中的 `sourceUrl` 含字面括號，例如：

```
https://zh.wikisource.org/wiki/%E6%88%B0%E5%9C%8B%E7%AD%96_(%E5%A3%AB%E7%A6%AE%E5%B1%85%E5%8F%A2%E6%9B%B8%E6%9C%AC)%2F...
```

英文維基如 `Battle_of_Changsha_(1944)` 也有同樣問題。

## 原因（四處，皆為 Codex 所有或首批共用的程式）

1. 連結解析用 `[^\s)]+`，遇到第一個 `)` 就截斷：
   - `analysis-batch-51-100/assemble.mjs:35`
   - `analysis-batch-51-100/capture.mjs:85`
   - `analysis-batch-51-100/claude/finish.mjs:60,97`
   - 首批同名檔案也一樣，本次未動。
2. 若改把括號編碼成 `%28/%29`，連結本身可以解析，卻會在兩處驗證失敗：
   - `claude-author.mjs:52` 要求 `result.sourceUrl === check.sourceUrl`，也就是 archive 的字面網址；
   - `claude-author.mjs:237` 以字面網址的 `href` 比對 `checkedSources`，`new URL()` 不會把 `%28` 正規化成 `(`。

結果就是固定修訂原典即使逐字比對過，也只能寫書名、不能加連結。本次 04、27 都是這種情況。

## 建議修正（未套用；動到驗證器，須由 Codex 審核）

採「連結一律用 `%28/%29`，驗證時兩種寫法視為同一網址」：

```js
// 共用小工具
const parenEncode = url => url.replace(/\(/g, '%28').replace(/\)/g, '%29');

// claude-author.mjs:237
const archiveUrls = new Set(inputs.searchLog.archiveChecks
  .flatMap(check => [new URL(check.sourceUrl).href, new URL(parenEncode(check.sourceUrl)).href]));

// claude/finish.mjs archiveSources(): 同時以兩種寫法登記
byUrl.set(doc.sourceUrl, entry); byUrl.set(parenEncode(doc.sourceUrl), entry);

// claude/expand.py url(): 輸出編碼後的網址
return '(' + src.replace('(', '%28').replace(')', '%29') + ')'
```

`assemble.mjs`、`capture.mjs` 的 regex 不必改，因為編碼後網址內已沒有字面括號。

套用前還要確認一件事：網站前端渲染 Markdown 連結時，`%28` 網址能否正常點開。Wikisource 可以接受 `%28/%29`。

套用後，04 的《戰國策·楚策一》與 27 的《戰國策·齊策六》都可以補上可點連結，屆時須以新 attempt 重建。
