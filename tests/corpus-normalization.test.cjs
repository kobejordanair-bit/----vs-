'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { digest } = require('../scripts/harvest-historical-corpus.cjs');
const { references, expandDetailed, dependencyMap, metadata, normalizeDocument, corpusFile, transcludedContent } = require('../scripts/normalize-historical-corpus.cjs');
const doc = (title, raw, extra = {}) => ({ id: 'document:' + title, requestedTitle: title, title,
  revisionId: 123, sourceUrl: 'https://zh.wikisource.org/wiki/' + encodeURIComponent(title),
  sha256: digest(raw), wikitext: raw, ...extra });

test('references normalize spaces and ignore literal examples and comments', () => {
  assert.deepEqual(references('{{:甲_乙}}{{: 甲 乙 }}<!--{{:不抓}}--><nowiki>{{:不抓}}</nowiki>{{/子頁}}', '書/卷一'), ['甲 乙', '書/卷一/子頁']);
});

test('transclusion respects include controls without interpreting literal examples', () => {
  assert.equal(transcludedContent('前<onlyinclude>正文</onlyinclude>後<onlyinclude>乙</onlyinclude>'), '正文\n乙');
  assert.equal(transcludedContent('甲<noinclude>編者{{:旁頁}}</noinclude><includeonly>乙</includeonly>'), '甲乙');
  assert.equal(transcludedContent('甲<nowiki><onlyinclude>例子</onlyinclude></nowiki>乙'), '甲<nowiki><onlyinclude>例子</onlyinclude></nowiki>乙');
});

test('resolved transclusions preserve original hash and compute separate derived hashes', async () => {
  const source = doc('漢書/卷096下', '詔曰{{:輪臺詔}}由是不復出軍。', {
    transclusions: [doc('輪臺詔', '<noinclude>不應嵌入</noinclude><onlyinclude>{{專|桑弘羊}}奏。</onlyinclude>')]
  });
  const before = JSON.stringify(source), result = await normalizeDocument(source, { now: 'fixed' });
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.wikitext, source.wikitext);
  assert.equal(result.sha256, digest(source.wikitext));
  assert.equal(result.textSha256, digest(result.text));
  assert.equal(result.expandedWikitextSha256, digest(expandDetailed(source.wikitext, dependencyMap(source.transclusions), { baseTitle: source.title }).wikitext));
  assert.ok(result.text.includes('桑弘羊奏。'));
  assert.ok(!result.text.includes('不應嵌入'));
  assert.equal(result.status, 'downloaded');
  assert.equal(result.textCompleteness, 'not-independently-collated');
});

test('missing and circular dependencies cannot be reported as fully extracted', async () => {
  const missing = await normalizeDocument(doc('甲', '{{:乙}}'));
  assert.equal(missing.status, 'incomplete');
  assert.deepEqual(missing.transclusionIssues, [{ kind: 'missing', title: '乙' }]);
  const source = doc('甲', '{{:乙}}', { transclusions: [doc('乙', '{{:丙}}'), doc('丙', '{{:乙}}')] });
  const cyclic = await normalizeDocument(source);
  assert.equal(cyclic.status, 'incomplete');
  assert.ok(cyclic.transclusionIssues.some(issue => issue.kind === 'cycle'));
  assert.ok(cyclic.text.includes('未展開轉引'));
});

test('redirect aliases also participate in cycle detection', async () => {
  const result = await normalizeDocument(doc('甲', '{{:別名}}', {
    transclusions: [doc('正名', '{{:別名}}', { requestedTitle: '別名' })]
  }));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.transclusionIssues[0].kind, 'cycle');
});

test('depth and repeated-expansion budgets preserve unresolved source markers', () => {
  const deps = dependencyMap([doc('甲', '{{:乙}}'), doc('乙', '正文')]);
  const depth = expandDetailed('{{:甲}}', deps, { maxDepth: 1 });
  assert.equal(depth.issues[0].kind, 'depth-limit');
  assert.ok(depth.wikitext.includes('{{:乙}}'));
  const budget = expandDetailed('{{:乙}}{{:乙}}{{:乙}}', deps, { maxExpansions: 1 });
  assert.equal(budget.issues[0].kind, 'expansion-limit');
  assert.ok(budget.wikitext.includes('{{:乙}}'));
  const chars = expandDetailed('{{:乙}}', deps, { maxExpandedCharacters: 1 });
  assert.equal(chars.issues[0].kind, 'expansion-limit');
});

test('original and cached dependency hash mismatches fail closed', async () => {
  await assert.rejects(normalizeDocument(doc('甲', '原文', { sha256: 'bad' })), /Original snapshot hash mismatch/);
  await assert.rejects(normalizeDocument(doc('甲', '{{:乙}}', {
    transclusions: [doc('乙', '正文', { sha256: 'bad' })]
  })), /Dependency snapshot hash mismatch/);
  assert.throws(() => dependencyMap([doc('乙', '版本一'), doc('乙', '版本二')]), /Conflicting/);
});

test('offline normalization never fetches and online fetch validates dependencies', async () => {
  let calls = 0;
  const fetcher = async title => { calls++; return doc(title, '正文'); };
  const offline = await normalizeDocument(doc('甲', '{{:乙}}'), { fetcher });
  assert.equal(calls, 0); assert.equal(offline.status, 'incomplete');
  const online = await normalizeDocument(doc('甲', '{{:乙}}'), { online: true, fetcher });
  assert.equal(calls, 1); assert.equal(online.status, 'downloaded');
  const corrupt = await normalizeDocument(doc('甲', '{{:乙}}'), { online: true, fetcher: async title => doc(title, '正文', { sha256: 'bad' }) });
  assert.equal(corrupt.status, 'incomplete'); assert.equal(corrupt.transclusions.length, 0);
});

test('dependency retrieval has a hard per-document request bound', async () => {
  let calls = 0;
  const raw = Array.from({ length: 45 }, (_, index) => '{{:第' + index + '頁}}').join('');
  const result = await normalizeDocument(doc('主頁', raw), {
    online: true, fetcher: async title => { calls++; return doc(title, '正文'); }
  });
  assert.equal(calls, 40); assert.equal(result.status, 'incomplete');
  assert.equal(result.transclusionIssues.filter(issue => issue.kind === 'missing').length, 5);
});

test('Textquality is preserved as platform metadata, never used as transcription percentage', async () => {
  const result = await normalizeDocument(doc('甲', '{{Textquality|25%}}正文。'));
  assert.equal(result.upstreamTextQuality, 25);
  assert.equal(result.status, 'downloaded');
  assert.ok(result.extractionNotes.some(note => note.includes('不代表正文已轉錄比例')));
  assert.ok(!result.extractionNotes.some(note => note.includes('轉錄僅')));
});

test('explicit quality reviews require matching title and revision', async () => {
  const source = doc('宋史/卷084', '{{Textquality|25%}}短正文');
  const entry = { requestedTitle: source.requestedTitle, revisionId: 123, status: 'incomplete', reason: '核讀確認缺段', supplementTitle: '宋史 (四庫全書本)/卷084' };
  const incomplete = await normalizeDocument(source, { overrides: { entries: [entry] } });
  assert.equal(incomplete.status, 'incomplete'); assert.equal(incomplete.qualityReview.applied, true);
  const stale = await normalizeDocument(source, { overrides: [{ ...entry, revisionId: 122 }] });
  assert.equal(stale.status, 'downloaded'); assert.equal(stale.qualityReview.applied, false);
  const unbound = await normalizeDocument(source, { overrides: [{ ...entry, revisionId: undefined }] });
  assert.equal(unbound.qualityReview.applied, false);
  const other = await normalizeDocument(source, { overrides: [{ ...entry, requestedTitle: '其他' }] });
  assert.equal(other.qualityReview, undefined);
});

test('an editorial downloaded override cannot hide technical missing material', async () => {
  const result = await normalizeDocument(doc('甲', '{{:乙}}'), {
    overrides: [{ requestedTitle: '甲', revisionId: 123, status: 'downloaded', reason: '來源正文存在' }]
  });
  assert.equal(result.status, 'incomplete');
});

test('images retain file names and captions and glyph-dependent text is marked incomplete', async () => {
  const result = await normalizeDocument(doc('甲', '正文[[File:calendar.png|thumb|200px|曆法數表]]'));
  assert.ok(result.text.includes('〔圖像未轉錄：calendar.png；圖說：曆法數表〕'));
  assert.equal(result.status, 'incomplete'); assert.equal(result.acquisitionStatus, 'downloaded');
  assert.ok(result.extractionNotes.some(note => note.includes('影像內容尚未轉為文字')));
  const glyph = await normalizeDocument(doc('乙', '自有{{SKchar|2652}}。'));
  assert.equal(glyph.status, 'incomplete');
});

test('main-index metadata cannot contain nested original or derived bodies', () => {
  const record = doc('甲', 'TOP_SECRET', {
    text: 'DERIVED_SECRET', rawWikitext: 'RAW_SECRET', arbitrary: { nested: { wikitext: 'SECRET' } },
    editionNote: '補充異版', supplementsDocumentId: 'document:original',
    transclusionIssues: [{ kind: 'missing', title: '乙', wikitext: 'ISSUE_SECRET' }],
    qualityReview: { status: 'incomplete', reason: '缺表', wikitext: 'REVIEW_SECRET' },
    transclusions: [doc('乙', 'DEPENDENCY_SECRET', { text: 'DEPENDENCY_DERIVED', transclusions: [doc('丙', 'DEEP_SECRET')] })]
  });
  const result = metadata(record), serialized = JSON.stringify(result);
  for (const value of ['SECRET', 'wikitext', '"text"', 'rawWikitext', 'arbitrary']) assert.ok(!serialized.includes(value), value);
  assert.equal(result.editionNote, '補充異版'); assert.equal(result.supplementsDocumentId, 'document:original');
  assert.equal(result.transclusions[0].transclusions[0].revisionId, 123);
  record.transclusions.push(record);
  assert.doesNotThrow(() => JSON.stringify(metadata(record)));
});

test('corpus output paths stay inside the archive directory', () => {
  const root = path.resolve(__dirname, '..');
  assert.equal(corpusFile(root, '/static/data/history/archive-books/shiji.json'), path.join(root, 'backend/static/data/history/archive-books/shiji.json'));
  for (const value of ['/static/data/history/archive-books/../../secret.json', '/elsewhere/file.json', '/static/data/history/archive-books/script.js'])
    assert.throws(() => corpusFile(root, value));
});
