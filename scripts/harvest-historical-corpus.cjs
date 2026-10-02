'use strict';
// Ancient-text transcription snapshots. Retrieval is never presented as editorial verification.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const DIRECTORY = path.join(ROOT, 'backend/static/data/history/archive-books');
const MANIFEST = path.join(ROOT, 'data/source-archive/corpus-manifest.json');
const API = 'https://zh.wikisource.org/w/api.php';
const BOOKS = [
 ['shiji','史記'],['hanshu','漢書'],['houhanshu','後漢書'],['sanguozhi','三國志'],['jinshu','晉書'],['songshu','宋書'],
 ['nanqishu','南齊書'],['liangshu','梁書'],['chenshu','陳書'],['weishu','魏書'],['beiqishu','北齊書'],['zhoushu','周書'],
 ['suishu','隋書'],['nanshi','南史'],['beishi','北史'],['jiutangshu','舊唐書'],['xintangshu','新唐書'],
 ['jiuwudaishi','舊五代史'],['xinwudaishi','新五代史'],['songshi','宋史'],['liaoshi','遼史'],['jinshi','金史'],
 ['yuanshi','元史'],['mingshi','明史'],['qingshigao','清史稿'],['zizhitongjian','資治通鑑'],
 ['zuozhuan','春秋左氏傳'],['guoyu','國語'],['zhanguoce','戰國策']
];
const sourceURL = title => 'https://zh.wikisource.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const { plainText, extractionVersion } = require('./wikisource-text.cjs');
async function api(params) {
  const url = new URL(API); url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', maxlag: '5', ...params });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'DynastySourceArchive/1.0 (local educational research; rate-limited)' }, signal: AbortSignal.timeout(60000) });
      if (!response.ok) { if (response.status === 429 || response.status >= 500) { await delay(Math.max(2000 * (attempt + 1), Number(response.headers.get('retry-after') || 0) * 1000)); continue; } throw Error('HTTP ' + response.status); }
      const data = await response.json(); if (data.error) { if (data.error.code === 'maxlag') { await delay(4000); continue; } throw Error(data.error.code + ': ' + data.error.info); }
      await delay(180); return data;
    } catch (error) { if (attempt === 3) throw error; await delay(1200 * (attempt + 1)); }
  }
  throw Error('Source retries exhausted');
}
function writeJSON(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data) + '\n', 'utf8'); }
async function enumerateBook(key, title) {
  if(key==='zhanguoce') {
    const editionTitles=['戰國策 (士禮居叢書本)','戰國策 (髙誘注, 姚宏續注, 四庫全書本)','戰國策 (鮑彪注, 四庫全書本)'];
    const editions=[];for(const edition of editionTitles)editions.push(await enumerateBook('edition',edition));
    return {id:'book:'+key,title,canonicalTitle:title,sourceUrl:sourceURL(title),indexRevisionId:null,indexRevisionTimestamp:null,indexAccessedAt:new Date().toISOString(),
      editionIndexes:editions.map(({chapterTitles,documents,contentPath,...meta})=>meta),
      chapterTitles:editions.flatMap(edition=>edition.chapterTitles.filter(chapter=>!edition.chapterTitles.some(other=>other.startsWith(chapter+'/')))),
      contentPath:'/static/data/history/archive-books/'+key+'.json',license:editions[0].license,notes:'三種明示底本分開保存：士禮居叢書本、高誘注姚宏續注四庫全書本、鮑彪注四庫全書本。相同篇章在不同版本不算獨立史實證據。'};
  }
  const links = new Set(); let continuation = {}, page;
  do {
    const response = await api({ titles: title, redirects: '1', prop: 'links|info|revisions', plnamespace: '0', pllimit: '500', inprop: 'url', rvprop: 'ids|timestamp', ...continuation });
    page = response.query.pages[0]; (page.links || []).forEach(link => links.add(link.title)); continuation = response.continue;
  } while (continuation);
  if (page.missing) throw Error('Missing catalogue: ' + title);
  const prefixes = [title + '/', page.title + '/'];
  const chapters = [...links].filter(link => prefixes.some(prefix => link.startsWith(prefix)) && !/全[覽览文]|序言|目[錄录]|提要|補遺|补遗|附[錄录]/.test(link.split('/').slice(1).join('/')));
  return { id: 'book:' + key, title, canonicalTitle: page.title, sourceUrl: sourceURL(page.title), indexRevisionId: page.revisions?.[0]?.revid || null, indexRevisionTimestamp: page.revisions?.[0]?.timestamp || null,
    indexAccessedAt: new Date().toISOString(), chapterTitles: chapters.length ? chapters.sort((a,b) => a.localeCompare(b, 'zh-Hant', {numeric:true})) : [page.title],
    contentPath: '/static/data/history/archive-books/' + key + '.json', license: 'Ancient underlying text; Wikisource transcription attribution and CC BY-SA 4.0 for applicable contributions',
    notes: '這是維基文庫轉錄版本快照，未逐卷校勘；機器整理閱讀文字可能省略模板、表格格式或轉引，請以固定版本與原始維基文字核對。' };
}
async function harvestBook(meta) {
  const output = path.join(DIRECTORY, meta.id.slice(5) + '.json');
  let cached = { format: 'dynasty-historical-book', schemaVersion: 1, bookId: meta.id, documents: [] };
  if (fs.existsSync(output)) { try { cached = JSON.parse(fs.readFileSync(output, 'utf8')); } catch { /* Explicit checkpoint remains intact until fresh successful records are available. */ } }
  const documents = new Map(cached.documents.filter(document => document.status === 'downloaded').map(document => [document.requestedTitle, document]));
  const remaining = meta.chapterTitles.filter(title => !documents.has(title));
  for (let offset = 0; offset < remaining.length; offset += 40) {
    const batch = remaining.slice(offset, offset + 40);
    try {
      const response = await api({ titles: batch.join('|'), redirects: '1', prop: 'revisions|info', inprop: 'url', rvprop: 'ids|timestamp|content', rvslots: 'main' });
      const redirects = new Map((response.query.redirects || []).map(entry => [entry.from, entry.to]));
      const pages = new Map(response.query.pages.map(page => [page.title, page]));
      for (const title of batch) {
        let target = title; for (let hops = 0; redirects.has(target) && hops < 10; hops++) target = redirects.get(target);
        const page = pages.get(target), revision = page?.revisions?.[0], raw = revision?.slots?.main?.content || '', text = plainText(raw);
        const status = !page || page.missing ? 'missing' : !revision ? 'error' : text.length < 100 ? 'incomplete' : 'downloaded';
        documents.set(title, { id: 'document:' + meta.id.slice(5) + '-' + digest(title).slice(0,16), bookId: meta.id, requestedTitle: title, title: page?.title || title,
          sourceUrl: sourceURL(page?.title || title), revisionUrl: revision ? 'https://zh.wikisource.org/w/index.php?oldid=' + revision.revid : null,
          historyUrl: sourceURL(page?.title || title) + '?action=history', revisionId: revision?.revid || null, revisionTimestamp: revision?.timestamp || null,
          retrievedAt: new Date().toISOString(), sha256: digest(raw), textSha256: digest(text), characters: text.length, contentPath: meta.contentPath,
          status, text, wikitext: raw, reuse: meta.license, extraction: extractionVersion });
      }
    } catch (error) { for (const title of batch) documents.set(title, { id:'document:' + meta.id.slice(5) + '-' + digest(title).slice(0,16),bookId:meta.id,requestedTitle:title,title,sourceUrl:sourceURL(title),status:'error',error:error.message,characters:0,contentPath:meta.contentPath }); }
    writeJSON(output, { ...cached, generatedAt: new Date().toISOString(), attribution: { provider: '中文維基文庫及其貢獻者', sourceUrl: meta.sourceUrl, licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/', changeNotice: '保留原始維基文字，另以程式移除部分格式產生閱讀文字。', policyUrl:'https://zh.wikisource.org/wiki/Wikisource:版權信息' }, documents: [...documents.values()] });
    console.log(meta.title + ' ' + Math.min(offset + 40, remaining.length) + '/' + remaining.length + ' retrieved; ' + documents.size + ' checkpointed');
  }
  return { ...meta, chapterCount: meta.chapterTitles.length, downloadedCount: [...documents.values()].filter(d => d.status === 'downloaded').length, status: [...documents.values()].every(d => d.status === 'downloaded') ? 'downloaded' : 'partial', documents: [...documents.values()].map(({text,wikitext,...metadata}) => metadata) };
}
async function run() {
  fs.mkdirSync(DIRECTORY, { recursive: true });
  let manifest = { format:'dynasty-historical-corpus',schemaVersion:1,createdAt:new Date().toISOString(),books:[],limitations:['取得網頁快照不是逐卷查證。','人物姓名出現只供尋找材料，不等於已核實同一人。','機器整理文字可能丟失排版與模板，固定版本和原始文字供回查。'] };
  if (fs.existsSync(MANIFEST)) manifest = JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
  const selected = process.argv.includes('--book') ? BOOKS.filter(([id]) => id === process.argv[process.argv.indexOf('--book')+1]) : BOOKS;
  let cursor = 0;
  async function worker() { while(cursor < selected.length) {
    const [key,title] = selected[cursor++];
    try {
      let book = manifest.books.find(item=>item.id==='book:'+key);
      if (!book || process.argv.includes('--refresh-index')) book = await enumerateBook(key,title);
      console.log('CATALOGUE '+title+' '+book.chapterTitles.length+' discovered pages');
      book = await harvestBook(book); manifest.books = [...manifest.books.filter(item=>item.id!==book.id),book]; manifest.updatedAt=new Date().toISOString(); writeJSON(MANIFEST,manifest);
    } catch(error) { console.error(title+': '+error.message); }
  } }
  await Promise.all([worker(),worker()]);
  console.log(JSON.stringify({books:manifest.books.length,documents:manifest.books.reduce((n,b)=>n+b.chapterCount,0),downloaded:manifest.books.reduce((n,b)=>n+b.downloadedCount,0)}));
}
if(require.main===module) run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={plainText,sourceURL,digest,BOOKS,api};
