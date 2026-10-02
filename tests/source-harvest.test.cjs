'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harvest = require('../scripts/harvest-person-sources.cjs');

test('queries remove display-role parentheses without using private prose', () => {
  assert.equal(harvest.queryName('諸葛亮(名臣)'), '諸葛亮');
  assert.equal(harvest.queryName('順治帝（福臨)'), '順治帝');
  assert.equal(harvest.queryName('李德（奧托·布勞恩）'), '李德');
});

test('bibliography extracts nested citation titles, fields, named works and source links', () => {
  const result = harvest.extractSources(`PRIVATE ARTICLE BODY\n<ref>{{cite book |title=[[史記|史記新注]] |author=司馬遷 |publisher=書局 |year=2000 |isbn=123 |url=https://example.org/book}}</ref>\n<ref>《漢書》卷一，這是不能被複製的敘述。</ref>\n== 參考文獻 ==\n* [https://example.org/research 學術研究] \n* 《資治通鑑》\n\n== 生平 ==\n不要匯出。\n[[s:史記/卷092|原典]]`, '韓信');
  assert.equal(result.bibliography.find(r => r.type === 'citation-template').citationTitle, '史記新注');
  assert.equal(result.bibliography.find(r => r.type === 'citation-template').author, '司馬遷');
  assert.ok(result.bibliography.some(r => r.citationTitle === '漢書'));
  assert.ok(result.bibliography.some(r => r.citationTitle === '資治通鑑'));
  assert.ok(result.bibliography.some(r => r.citationTitle === '學術研究'));
  assert.equal(result.wikisourceLinks[0].title, '史記/卷092');
  assert.equal(result.wikisourceLinks[0].retrieved, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|不能被複製|不要匯出/);
});

test('literal linked books in a bibliography survive even without title brackets', () => {
  const result = harvest.extractSources('== 參考資料 ==\n* [[舊唐書]]卷六十\n* [[羅士信]]\n', '羅士信');
  assert.equal(result.bibliography.length, 1);
  assert.equal(result.bibliography[0].citationTitle, '舊唐書');
  assert.equal(result.bibliography[0].type, 'reference-work-link');
});

test('duplicate bibliography and Wikisource references are deduplicated', () => {
  const result = harvest.extractSources('<ref>《史記》《史記》</ref>[[s:史記/卷007]][[s:史記/卷007|本紀]]', '項羽');
  assert.equal(result.bibliography.length, 1);
  assert.equal(result.wikisourceLinks.length, 1);
});

test('Wikisource section fragments remain fragments instead of page-title characters', () => {
  const result = harvest.extractSources('[[s:史記/卷092#淮陰侯|段落]]', '韓信');
  const url = new URL(result.wikisourceLinks[0].url);
  assert.equal(decodeURIComponent(url.hash), '#淮陰侯');
  assert.equal(decodeURIComponent(url.pathname), '/wiki/史記/卷092');
});

test('unsupported sister templates cannot turn a language code into a Chinese work', () => {
  const result = harvest.extractSources('{{wikisourcelang|ja|日本史料}}', '測試');
  assert.equal(result.wikisourceLinks.length, 0);
});

test('inline sister links and biography headings provide actual bibliography targets', () => {
  const result = harvest.extractSources('==传记资料==\n*《宋史》卷368\n{{wikisource-inline|史記/卷041|越王勾踐世家}}\n[[:s:清史稿/卷460|鄧世昌]]', '測試');
  assert.ok(result.bibliography.some(r => r.citationTitle === '宋史'));
  assert.deepEqual(result.wikisourceLinks.map(r => r.title), ['史記/卷041', '清史稿/卷460']);
});

test('rendered interwiki metadata fills dynamically generated source links without claiming retrieval', () => {
  const p = harvest.pageMetadata({title:'房遗爱',pageid:1,iwlinks:[{prefix:'s',title:'新唐書/卷096',url:'https://zh.wikisource.org/wiki/新唐書/卷096'}],revisions:[]}, 'now');
  assert.equal(p.wikisourceLinks[0].origin, 'rendered-interwiki-link');
  assert.equal(p.wikisourceLinks[0].retrieved, false);
});

test('disambiguation rescue follows explicit candidates and skips period links', () => {
  const result = harvest.disambiguationTargets('* [[曹丕]]，曹魏皇帝\n* [[西漢]][[陳平 (漢朝)|陳平]]，政治家\n[[Category:消歧義頁]]\n* [[陳平 (漢朝)]]');
  assert.deepEqual(result, ['曹丕', '陳平 (漢朝)']);
});

test('search rescue excludes similar strings and keeps exact-name disambiguators', () => {
  assert.equal(harvest.exactNameSearchTitle('符堅角殼灰介', ['符堅']), false);
  assert.equal(harvest.exactNameSearchTitle('劉永基', ['劉基', '刘基']), false);
  assert.equal(harvest.exactNameSearchTitle('刘基 (明朝)', ['劉基', '刘基']), true);
});

test('unsafe protocols and HTML never survive as active bibliography markup', () => {
  const result = harvest.extractSources('<ref>{{cite web|title=<img src=x onerror=alert(1)>歷史研究|url=javascript:alert(1)}}</ref>', '測試');
  assert.equal(result.bibliography[0].citationTitle, '歷史研究');
  assert.equal(result.bibliography[0].url, null);
  assert.equal(harvest.safeUrl('data:text/html,test'), null);
});

test('revision metadata and attribution persist, full article text does not', () => {
  const meta = harvest.pageMetadata({ title: '韓信', pageid: 42, pageprops: { wikibase_item: 'Q1' }, revisions: [{ revid: 9, timestamp: '2026-10-02T00:00:00Z', slots: { main: { content: 'NOT FOR ARCHIVE<ref>《史記》</ref>' } } }] }, '2026-10-02T01:00:00Z');
  assert.equal(meta.revisionId, 9);
  assert.equal(meta.wikidataId, 'Q1');
  assert.equal(meta.revisionUrl, 'https://zh.wikipedia.org/w/index.php?oldid=9');
  assert.match(meta.attribution.license, /CC BY-SA/);
  assert.doesNotMatch(JSON.stringify(meta), /NOT FOR ARCHIVE/);
});

test('normalization, Chinese conversion and redirects resolve in sequence', () => {
  const mapped = harvest.mapQueryResult(['Original_name'], { query: { normalized: [{ from: 'Original_name', to: 'Original name' }], converted: [{ from: 'Original name', to: '韓信' }], redirects: [{ from: '韓信', to: '韩信' }], pages: [{ pageid: 1, title: '韩信' }] } }, 'now');
  assert.equal(mapped.Original_name.resolvedTitle, '韩信');
  assert.equal(mapped.Original_name.status, 'found');
});

test('missing page and cyclic redirects remain safe explicit gaps', () => {
  const mapped = harvest.mapQueryResult(['不存在'], { query: { redirects: [{ from: '不存在', to: '也不存在' }, { from: '也不存在', to: '不存在' }], pages: [{ title: '不存在', missing: true }] } }, 'now');
  assert.equal(mapped['不存在'].status, 'missing');
  assert.equal(mapped['不存在'].page, null);
});

test('same-name metadata is a candidate and never an identity verification', () => {
  const record = harvest.buildRecord({ id: 'p1', name: '王猛', type: 'minister', dynasty: '前秦', analysis: 'PRIVATE' }, { pages: { 王猛: { status: 'found', page: { pageId: 1, title: '王猛', isDisambiguation: false } } } });
  assert.equal(record.status, 'candidate');
  assert.equal(record.identityVerified, false);
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE/);
});

test('editorial alias retrieval preserves original record and unresolved identity', () => {
  const record = harvest.buildRecord({ id: 'p1', name: '符堅', type: 'emperor' }, { pages: { 符堅: { status: 'missing', page: null } }, additional: { p1: { titles: ['苻堅'], pages: [{ pageId: 1, title: '苻堅', isDisambiguation: false }] } } });
  assert.equal(record.name, '符堅');
  assert.deepEqual(record.additionalQueries, ['苻堅']);
  assert.equal(record.status, 'candidate');
  assert.equal(record.identityVerified, false);
});

test('disambiguation and several concrete alternatives are unresolved', () => {
  const result = harvest.buildRecord({ id: 'p1', name: '王猛', type: 'minister' }, { pages: { 王猛: { status: 'found', page: { pageId: 1, isDisambiguation: true } } }, rescue: { 王猛: { pages: [{ pageId: 2, isDisambiguation: false }, { pageId: 3, isDisambiguation: false }] } } });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 3);
});

test('manifest retains every original record even for missing and failed sources', () => {
  const input = [{ id: '1', name: '甲', type: 'minister', deepAnalysis: 'SECRET' }, { id: '2', name: '乙', type: 'general' }, { id: '3', name: '甲', type: 'emperor' }];
  const result = harvest.buildManifest(input, Buffer.from('fixture'), { pages: { 乙: { status: 'error', error: 'HTTP 503' } } });
  assert.equal(result.records.length, 3);
  assert.equal(result.summary.missing, 2);
  assert.equal(result.summary.error, 1);
  assert.equal(result.sourceSnapshot.sha256.length, 64);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|deepAnalysis/);
});

test('HTTP retry honors retry-after and transmits only supplied public API fields', async () => {
  const waits = [], urls = []; let calls = 0;
  const result = await harvest.request({ titles: '韓信' }, { sleep: async ms => waits.push(ms), fetcher: async url => {
    urls.push(String(url)); calls++;
    if (calls === 1) return { ok: false, status: 429, headers: new Headers({ 'retry-after': '3' }) };
    return { ok: true, json: async () => ({ query: { pages: [] } }) };
  } });
  assert.equal(calls, 2); assert.deepEqual(waits, [3000]);
  assert.equal(new URL(urls[0]).searchParams.get('titles'), '韓信');
  assert.deepEqual(result, { query: { pages: [] } });
});

test('API maxlag is retried and persistent failure is surfaced', async () => {
  let calls = 0;
  await assert.rejects(() => harvest.request({ titles: '韓信' }, { sleep: async () => {}, fetcher: async () => { calls++; return { ok: true, json: async () => ({ error: { code: 'maxlag', info: 'try later' } }) }; } }), /maxlag/);
  assert.equal(calls, 4);
});
