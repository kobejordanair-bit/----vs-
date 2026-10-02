#!/usr/bin/env node
'use strict';

// Public identifiers only are submitted to Wikimedia. Article bodies are parsed in
// memory and discarded; this archive stores bibliography and revision metadata.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const API = 'https://zh.wikipedia.org/w/api.php';
const OUT = path.resolve(__dirname, '../data/source-archive');
const USER_AGENT = 'DynastyHistoricalSourceArchive/1.0 (public bibliography research; local offline archive)';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function cleanTitle(value) {
  return String(value || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '').replace(/'{2,}/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 300);
}
function safeUrl(value) {
  try { const u = new URL(String(value || '').trim().replace(/^\/\//, 'https://')); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
}
function queryName(name) { return String(name || '').replace(/[（(][^（）()]*[）)]/g, '').trim(); }
function wikisourceUrl(target) {
  const i = target.indexOf('#');
  const title = i < 0 ? target : target.slice(0, i), fragment = i < 0 ? null : target.slice(i + 1);
  return 'https://zh.wikisource.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')) + (fragment ? '#' + encodeURIComponent(fragment.replace(/ /g, '_')) : '');
}
function templateBlocks(text) {
  const result = []; const starts = [];
  for (let i = 0; i < text.length - 1; i++) {
    const p = text.slice(i, i + 2);
    if (p === '{{') { starts.push(i); i++; }
    else if (p === '}}' && starts.length) { const start = starts.pop(); result.push(text.slice(start + 2, i)); i++; }
  }
  return result;
}
function templateParts(text) {
  const parts = []; let start = 0, curly = 0, square = 0;
  for (let i = 0; i < text.length; i++) {
    const p = text.slice(i, i + 2);
    if (p === '{{') { curly++; i++; } else if (p === '}}') { curly--; i++; }
    else if (p === '[[') { square++; i++; } else if (p === ']]') { square--; i++; }
    else if (text[i] === '|' && !curly && !square) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start)); return parts;
}
function disambiguationTargets(wikitext) {
  const generic = new Set(['中國','中国','中華人民共和國','中华人民共和国','中華民國','中华民国','臺灣','台湾','香港','澳門','澳门','三國','三国','漢朝','汉朝','西漢','西汉','東漢','东汉','曹魏','孫吳','孙吴','蜀漢','蜀汉','南宋','北宋','宋朝','明朝','清朝','唐朝','隋朝','晉朝','晋朝','西晉','西晋','東晉','东晋','元朝','南北朝','五代十國','五代十国','春秋','戰國','战国','北朝','南朝','前秦','後秦','后秦','後趙','后赵','北魏','北周','北齊','北齐','辽朝','遼朝','金朝','民國','民国']);
  const targets = [];
  for (const line of wikitext.split(/\r?\n/).filter(x => /^\s*[*#]/.test(x))) {
    for (const match of line.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)) {
      const value = cleanTitle(match[1]);
      if (!value || value.includes(':') || /^\d/.test(value) || generic.has(value)) continue;
      targets.push(value); break;
    }
  }
  return [...new Set(targets)].slice(0, 30);
}
function exactNameSearchTitle(title, names) { return names.some(name => queryName(title) === queryName(name)); }
function extractSources(wikitext, pageTitle) {
  const bibliography = [], wikisourceLinks = [], seen = new Set(), wsSeen = new Set();
  const add = entry => {
    entry.citationTitle = cleanTitle(entry.citationTitle);
    if (!entry.citationTitle || entry.citationTitle.length < 2) return;
    entry.url = safeUrl(entry.url);
    const key = entry.citationTitle + '\0' + entry.url;
    if (!seen.has(key)) { seen.add(key); bibliography.push(entry); }
  };
  const addWs = (target, origin) => {
    target = cleanTitle(target).replace(/^zh:/i, '');
    if (!target || /[{}]/.test(target)) return;
    const url = wikisourceUrl(target);
    if (!wsSeen.has(url)) { wsSeen.add(url); wikisourceLinks.push({ title: target, url, origin, retrieved: false }); }
  };
  for (const block of templateBlocks(wikitext)) {
    const parts = templateParts(block), template = parts.shift().trim();
    if (/^(?:cite[ _]?(?:book|web|journal|news|encyclopedia|report|thesis|conference|magazine)|citation|引用书籍|引用書籍|cite)$/i.test(template)) {
      const params = Object.fromEntries(parts.filter(p => p.includes('=')).map(p => { const i = p.indexOf('='); return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()]; }));
      const title = params.title || params['書名'] || params['书名'] || params.chapter;
      if (title) add({ citationTitle: title, url: params.url || params['chapter-url'] || null, type: 'citation-template', template, author: cleanTitle(params.author || [params.last, params.first].filter(Boolean).join(', ')), publisher: cleanTitle(params.publisher || params.journal || params.website), date: cleanTitle(params.date || params.year), isbn: cleanTitle(params.isbn), locator: 'citation template' });
    }
    if (/^(?:wikisource|wikisource-inline|wikisource further reading|维基文库|維基文庫|s)$/i.test(template)) {
      const targets = parts.filter(p => !p.includes('=')).map(p => p.trim()).filter(Boolean);
      if (targets.length) addWs(targets[0] === 'zh' ? targets[1] : targets[0], 'sister-template');
    }
  }
  // Only names of works are retained from reference prose, never the prose itself.
  const refs = Array.from(wikitext.matchAll(/<ref\b[^>]*>([\s\S]*?)<\/ref>/gi), m => m[1]);
  const sectionRe = /^={2,6}\s*(?:參考[文資書]?獻?|参考[文资书]?献?|[傳传][記记][資资文][料獻献]|引用|注釋|註釋|注释|延伸閱讀|延伸阅读|史料|文獻|文献|外部連結|外部链接)[^\n]*={2,6}\s*\n([\s\S]*?)(?=^==[^=]|$(?![\s\S]))/gm;
  for (const m of wikitext.matchAll(sectionRe)) refs.push(m[1]);
  for (const section of refs) {
    for (const match of section.matchAll(/《([^》\n]{1,200})》/g)) add({ citationTitle: match[1], url: null, type: 'named-work', locator: 'reference or bibliography section' });
    for (const match of section.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      const target = cleanTitle(match[1]);
      if (!target.includes(':') && /(?:史|書|书|記|记|鑑|鉴|通典|通考|文選|文选|左傳|左传|國語|国语|三國志|三国志|戰國策|战国策|實錄|实录|史稿)(?:\/|$)/.test(target)) add({ citationTitle: target, url: 'https://zh.wikipedia.org/wiki/' + encodeURIComponent(target), type: 'reference-work-link', locator: 'literal work link in reference or bibliography section' });
    }
    for (const match of section.matchAll(/\[(https?:\/\/[^\s\]]+)\s+([^\]\n]+)\]/g)) add({ citationTitle: match[2], url: match[1], type: 'reference-link', locator: 'reference or bibliography section' });
  }
  for (const match of wikitext.matchAll(/\[\[:?(?:s|wikisource):([^\]|]+)(?:\|[^\]]*)?\]\]/gi)) addWs(match[1], 'literal-wikitext-link');
  for (const match of wikitext.matchAll(/https?:\/\/zh\.wikisource\.org\/wiki\/([^\s|\]<>}"']+)/g)) {
    try { addWs(decodeURIComponent(match[1]), 'literal-url'); } catch { /* malformed source URL remains excluded */ }
  }
  return { bibliography, wikisourceLinks };
}
function pageMetadata(page, retrievedAt) {
  if (Object.hasOwn(page, 'missing') || Object.hasOwn(page, 'invalid')) return null;
  const rev = page.revisions?.[0], text = rev?.slots?.main?.content || rev?.slots?.main?.['*'] || rev?.content || rev?.['*'] || '';
  const sources = extractSources(text, page.title);
  for (const link of page.iwlinks || []) if (link.prefix === 's' && safeUrl(link.url) && !sources.wikisourceLinks.some(r => r.title === link.title)) sources.wikisourceLinks.push({ title: link.title, url: safeUrl(link.url), origin: 'rendered-interwiki-link', retrieved: false });
  return {
    title: page.title, pageId: page.pageid, revisionId: rev?.revid || page.lastrevid || null,
    revisionTimestamp: rev?.timestamp || null, url: page.canonicalurl || page.fullurl || 'https://zh.wikipedia.org/wiki/' + encodeURIComponent(page.title),
    revisionUrl: rev?.revid ? 'https://zh.wikipedia.org/w/index.php?oldid=' + rev.revid : null,
    wikidataId: page.pageprops?.wikibase_item || null,
    isDisambiguation: Boolean(page.pageprops && Object.hasOwn(page.pageprops, 'disambiguation')),
    ...(page.pageprops && Object.hasOwn(page.pageprops, 'disambiguation') ? { disambiguationTargets: disambiguationTargets(text) } : {}),
    ...sources, retrievedAt,
    attribution: { source: 'Chinese Wikipedia contributors', license: 'CC BY-SA 4.0; bibliography metadata only', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', status: 'candidate index, not independently verified evidence' }
  };
}
function mapQueryResult(inputTitles, body, retrievedAt) {
  const aliases = new Map();
  for (const type of ['normalized', 'converted', 'redirects']) for (const r of body.query?.[type] || []) aliases.set(r.from, r.to);
  const pages = new Map((Array.isArray(body.query?.pages) ? body.query.pages : Object.values(body.query?.pages || {})).map(p => [p.title, p]));
  return Object.fromEntries(inputTitles.map(title => {
    let target = title; const visited = new Set();
    while (aliases.has(target) && !visited.has(target)) { visited.add(target); target = aliases.get(target); }
    const p = pages.get(target); return [title, { queryTitle: title, resolvedTitle: target, retrievedAt, status: p && !Object.hasOwn(p, 'missing') && !Object.hasOwn(p, 'invalid') ? 'found' : 'missing', page: p ? pageMetadata(p, retrievedAt) : null }];
  }));
}
async function request(params, options = {}) {
  const fetcher = options.fetcher || fetch, sleeper = options.sleep || sleep;
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const url = new URL(API); for (const [k, v] of Object.entries({ action: 'query', format: 'json', formatversion: '2', maxlag: '5', ...params })) url.searchParams.set(k, v);
      const response = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
      if (!response.ok) { const error = new Error('HTTP ' + response.status); error.retryAfter = Number(response.headers.get('retry-after')); throw error; }
      const body = await response.json(); if (body.error) { const error = new Error(body.error.code + ': ' + body.error.info); error.retryAfter = Math.max(Number(response.headers?.get?.('retry-after')) || 0, body.error.code === 'maxlag' ? 5 : 0); throw error; }
      return body;
    } catch (error) { last = error; if (attempt < 3) await sleeper(Math.max(1000 * 2 ** attempt, (error.retryAfter || 0) * 1000)); }
  }
  throw last;
}
function buildRecord(record, cache) {
  const title = queryName(record.name), result = cache.pages[title];
  const candidates = [result?.page, ...(cache.rescue?.[title]?.pages || []), ...(cache.additional?.[record.id]?.pages || [])].filter(Boolean).filter((p, i, all) => all.findIndex(x => x.pageId === p.pageId) === i);
  const useful = candidates.filter(p => !p.isDisambiguation);
  const status = result?.status === 'error' && !useful.length ? 'error' : !candidates.length ? 'missing' : result?.page?.isDisambiguation || useful.length > 1 ? 'ambiguous' : 'candidate';
  return { recordId: record.id, name: record.name, type: record.type, dynasty: record.dynasty || '未分類', queryName: title, additionalQueries: cache.additional?.[record.id]?.titles || [], status, identityVerified: false, candidates,
    notes: [status === 'candidate' ? '姓名／重新導向命中，人物身份與每條書目尚須逐項核對。' : status === 'ambiguous' ? '同名或消歧義候選，尚未選定此人物對應的頁面。' : status === 'error' ? '來源請求失敗，保留待重試。' : '本輪查無確切頁面，保留缺口。', ...(result?.error ? [result.error] : [])] };
}
function buildManifest(records, bytes, cache) {
  const rows = records.map(r => buildRecord(r, cache));
  const counts = rows.reduce((out, r) => { out[r.status] = (out[r.status] || 0) + 1; return out; }, {});
  const unique = [...new Map(rows.flatMap(r => r.candidates).map(p => [p.pageId, p])).values()];
  return { format: 'dynasty-person-source-harvest', schemaVersion: 1, generatedAt: new Date().toISOString(), sourceSnapshot: { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), recordCount: records.length },
    methodology: { queryFields: ['name', 'public aliases and editorial canonical names'], networkConcurrency: 2, identityVerified: false, storesPrivateAnalysis: false, storesWikipediaFullText: false, note: '來源索引，並非史料查證完成。維基百科提供候選書目與固定修訂版本；書目本身仍需打開原來源核對。書目條目數含同一作品在不同人物頁的重複引用，並非獨立來源數。' },
    summary: { totalRecords: rows.length, uniqueOriginalNames: new Set(rows.map(r => r.name)).size, uniqueQueryNames: new Set(rows.map(r => r.queryName)).size, ...counts, uniqueCandidatePages: unique.length, concreteCandidatePages: unique.filter(p => !p.isDisambiguation).length, bibliographyEntries: unique.reduce((n, p) => n + p.bibliography.length, 0), wikisourceLinks: unique.reduce((n, p) => n + p.wikisourceLinks.length, 0), distinctWikisourceUrls: new Set(unique.flatMap(p => p.wikisourceLinks.map(r => r.url.split('#')[0]))).size }, records: rows };
}
function saveJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temp, file); }
function normalizeCachedLinks(cache) {
  const pages = [...Object.values(cache.pages || {}).map(r => r.page), ...Object.values(cache.rescue || {}).flatMap(r => r.pages || []), ...Object.values(cache.additional || {}).flatMap(r => r.pages || [])].filter(Boolean);
  for (const page of pages) page.wikisourceLinks = (page.wikisourceLinks || []).filter(r => !(r.origin === 'sister-template' && /^[a-z]{2,3}$/.test(r.title))).map(r => ({ ...r, url: wikisourceUrl(r.title) }));
  cache.extractorVersion = 2;
}
async function run(options = {}) {
  const input = path.resolve(options.input || path.resolve(__dirname, '../../資料備份_2026-09-30/962人物完整資料.json'));
  const bytes = fs.readFileSync(input), parsed = JSON.parse(bytes), records = Array.isArray(parsed) ? parsed : parsed.characters;
  if (!Array.isArray(records) || records.some(r => !r.id || !r.name)) throw new Error('Input must contain identified person records.');
  const cacheFile = path.join(OUT, 'harvest-cache.json'), manifestFile = path.join(OUT, 'harvest-person-sources.json');
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : { format: 'dynasty-source-harvest-cache', schemaVersion: 1, pages: {}, rescue: {} };
  normalizeCachedLinks(cache);
  const titles = [...new Set(records.map(r => queryName(r.name)))];
  cache.emptyBibliographyRechecks ||= {};
  const needed = titles.filter(t => !cache.pages[t] || cache.pages[t].status === 'error' || (cache.pages[t].page?.isDisambiguation && !cache.pages[t].page.disambiguationTargets) || (cache.pages[t].page && !cache.pages[t].page.isDisambiguation && !cache.pages[t].page.bibliography.length && !cache.pages[t].page.wikisourceLinks.length && cache.emptyBibliographyRechecks[t] !== 3) || options.refresh);
  const batches = []; for (let i = 0; i < needed.length; i += 20) batches.push(needed.slice(i, i + 20));
  let index = 0, done = 0;
  async function worker() {
    while (index < batches.length) {
      const batch = batches[index++];
      try {
        const body = await request({ titles: batch.join('|'), redirects: '1', converttitles: '1', prop: 'info|pageprops|revisions', inprop: 'url', rvprop: 'ids|timestamp|content', rvslots: 'main' });
        Object.assign(cache.pages, mapQueryResult(batch, body, new Date().toISOString()));
        for (const title of batch) cache.emptyBibliographyRechecks[title] = 3;
      } catch (error) { for (const t of batch) cache.pages[t] = { queryTitle: t, status: 'error', error: error.message, retrievedAt: new Date().toISOString(), page: null }; }
      saveJson(cacheFile, cache); const result = buildManifest(records, bytes, cache); saveJson(manifestFile, result);
      console.log(JSON.stringify({ batch: ++done, batches: batches.length, ...result.summary }));
      await sleep(300);
    }
  }
  await Promise.all([worker(), worker()]);
  // Editorial aliases are additional retrieval queries only. Even a reviewed
  // name must not turn a fetched encyclopedia page into verified identity data.
  const editorialFile = path.join(OUT, 'editorial-reviews.json'), aliasFile = path.join(OUT, 'harvest-query-aliases.json');
  const editorial = fs.existsSync(editorialFile) ? JSON.parse(fs.readFileSync(editorialFile, 'utf8')) : { identityReviews: [] };
  const aliases = fs.existsSync(aliasFile) ? JSON.parse(fs.readFileSync(aliasFile, 'utf8')).queries || [] : [];
  const additions = new Map();
  for (const review of editorial.identityReviews || []) for (const recordId of review.recordIds || []) {
    const record = records.find(r => r.id === recordId); if (!record) continue;
    const terms = [review.canonicalName, ...(!cache.pages[queryName(record.name)]?.page ? review.aliases || [] : [])].filter(Boolean).map(queryName).filter(t => t && t !== queryName(record.name));
    if (terms.length) additions.set(recordId, [...new Set(terms)]);
  }
  for (const entry of aliases) if (records.some(r => r.id === entry.recordId)) additions.set(entry.recordId, [...new Set([...(additions.get(entry.recordId) || []), ...(entry.titles || []).map(queryName)])]);
  const extraTitles = [...new Set([...additions.values()].flat())].filter(t => !cache.pages[t] || cache.pages[t].status === 'error');
  for (let i = 0; i < extraTitles.length; i += 20) {
    const batch = extraTitles.slice(i, i + 20);
    try { const body = await request({ titles: batch.join('|'), redirects: '1', converttitles: '1', prop: 'info|pageprops|revisions', inprop: 'url', rvprop: 'ids|timestamp|content', rvslots: 'main' }); Object.assign(cache.pages, mapQueryResult(batch, body, new Date().toISOString())); }
    catch (error) { for (const t of batch) cache.pages[t] = { queryTitle: t, status: 'error', error: error.message, retrievedAt: new Date().toISOString(), page: null }; }
    saveJson(cacheFile, cache); await sleep(300);
  }
  cache.additional ||= {};
  for (const [id, terms] of additions) cache.additional[id] = { titles: terms, pages: terms.map(t => cache.pages[t]?.page).filter(Boolean), retrievedAt: new Date().toISOString() };
  saveJson(cacheFile, cache); saveJson(manifestFile, buildManifest(records, bytes, cache));
  if (options.rescue) {
    const rescueTitles = titles.filter(t => (!cache.pages[t]?.page || cache.pages[t]?.page?.isDisambiguation) && (!cache.rescue[t] || cache.rescue[t].error || cache.rescue[t].qualityVersion < 2 || !cache.rescue[t].qualityVersion));
    const plans = new Map();
    for (const name of rescueTitles) {
      const direct = cache.pages[name]?.page?.disambiguationTargets || [];
      const corresponding = records.filter(r => queryName(r.name) === name);
      const additional = corresponding.flatMap(r => cache.additional[r.id]?.titles || []);
      let found = direct;
      if (!direct.length && !additional.length) {
        try { const search = await request({ list: 'search', srsearch: 'intitle:' + name, srnamespace: '0', srlimit: '5', srprop: '' }); found = (search.query?.search || []).map(r => r.title).filter(t => exactNameSearchTitle(t, [name, cache.pages[name]?.resolvedTitle || name])); }
        catch (error) { plans.set(name, { titles: [], error: error.message }); continue; }
        await sleep(300);
      }
      plans.set(name, { titles: [...new Set([...found, ...additional])].slice(0, 40) });
    }
    const previousPages = new Map([...Object.values(cache.pages).map(r => r.page), ...Object.values(cache.rescue).flatMap(r => r.pages || [])].filter(Boolean).map(p => [p.title, p]));
    const needTargets = [...new Set([...plans.values()].flatMap(p => p.titles))].filter(t => (!cache.pages[t] || cache.pages[t].status === 'error') && !previousPages.has(t));
    const targetBatches = []; for (let i = 0; i < needTargets.length; i += 20) targetBatches.push(needTargets.slice(i, i + 20));
    let targetIndex = 0;
    async function rescueTargetWorker() {
      while (targetIndex < targetBatches.length) {
        const batch = targetBatches[targetIndex++];
        try { const body = await request({ titles: batch.join('|'), redirects: '1', converttitles: '1', prop: 'info|pageprops|revisions', inprop: 'url', rvprop: 'ids|timestamp|content', rvslots: 'main' }); Object.assign(cache.pages, mapQueryResult(batch, body, new Date().toISOString())); }
        catch (error) { for (const t of batch) cache.pages[t] = { queryTitle: t, status: 'error', error: error.message, retrievedAt: new Date().toISOString(), page: null }; }
        saveJson(cacheFile, cache); console.log(JSON.stringify({ rescueTargetBatch: targetIndex, batches: targetBatches.length })); await sleep(300);
      }
    }
    await Promise.all([rescueTargetWorker(), rescueTargetWorker()]);
    for (const [name, plan] of plans) {
      const record = records.find(r => queryName(r.name) === name);
      const errors = plan.titles.filter(t => cache.pages[t]?.status === 'error').map(t => cache.pages[t].error);
      const pages = plan.titles.map(t => cache.pages[t]?.page || previousPages.get(t)).filter(Boolean);
      cache.rescue[name] = { query: name, qualityVersion: 3, selectionMethod: 'literal disambiguation targets, editorial aliases, or exact-name search; batched retrieval', originalDynasty: record.dynasty || null, retrievedAt: new Date().toISOString(), pages, ...(plan.error || errors.length ? { error: plan.error || errors.join('; ') } : {}) };
    }
    saveJson(cacheFile, cache); const rescued = buildManifest(records, bytes, cache); saveJson(manifestFile, rescued); console.log(JSON.stringify({ rescuedNames: plans.size, ...rescued.summary }));
  }
  cache.bibliographyChecks ||= {};
  const bibliographyGaps = buildManifest(records, bytes, cache).records.filter(r => !r.candidates.some(p => p.bibliography.length || p.wikisourceLinks.length)).map(r => r.queryName).filter(t => cache.bibliographyChecks[t] !== 4);
  for (let i = 0; i < bibliographyGaps.length; i += 20) {
    const batch = [...new Set(bibliographyGaps.slice(i, i + 20))];
    try {
      const body = await request({ titles: batch.join('|'), redirects: '1', converttitles: '1', prop: 'info|pageprops|revisions|iwlinks', inprop: 'url', rvprop: 'ids|timestamp|content', rvslots: 'main', iwprefix: 's', iwprop: 'url', iwlimit: '500' });
      Object.assign(cache.pages, mapQueryResult(batch, body, new Date().toISOString())); for (const title of batch) cache.bibliographyChecks[title] = 4;
    } catch (error) { console.warn(JSON.stringify({ bibliographyRecheck: 'failed', error: error.message, titles: batch })); }
    saveJson(cacheFile, cache); await sleep(300);
  }
  const result = buildManifest(records, bytes, cache); saveJson(manifestFile, result); return result;
}
module.exports = { queryName, cleanTitle, safeUrl, wikisourceUrl, templateBlocks, templateParts, disambiguationTargets, exactNameSearchTitle, extractSources, pageMetadata, mapQueryResult, buildRecord, buildManifest, normalizeCachedLinks, request, run };
if (require.main === module) run({ input: process.argv.find(x => x.startsWith('--input='))?.slice(8), refresh: process.argv.includes('--refresh'), rescue: process.argv.includes('--rescue') }).then(r => console.log(JSON.stringify(r.summary))).catch(e => { console.error(e.message); process.exitCode = 1; });
