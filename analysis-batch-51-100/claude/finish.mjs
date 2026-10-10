// One-command finishing step for a Claude-authored person:
//   node analysis-batch-51-100/claude/finish.mjs NN https://claude.ai/code/session_...
// Reads claude/specs/NN.json (actual searches, archive quotations, review
// checks, non-archive sources), writes the search log, splits the manuscript,
// writes the self-reviews, assembles results.NN-NN.v1.json and refreshes
// claude-ledger.v1.json. Never overwrites an existing output.
import { readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDocument, locate } from './archive-quote.mjs';
import { split, loadClaudePerson, assembleClaudeResults, splitSoulOnly, loadClaudeSoulPerson, assembleClaudeSoulResults, SOURCE_ACCESS } from '../claude-author.mjs';
import { loadFixedManifest } from '../import.mjs';
import { CLAUDE_PROVIDER, AUTHOR_POLICY_SHA256 } from './provenance.mjs';
import { contentHash } from '../../cloudflare/scripts/analysis-pilot-import.mjs';

const batchDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => resolve(batchDir, ...parts);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const exists = async path => { try { await lstat(path); return true; } catch { return false; } };
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeNew = async (path, text) => writeFile(path, text, { flag: 'wx' });
const fail = message => { throw Error(message); };

async function archiveSources(checks) {
  const byUrl = new Map();
  for (const check of checks) {
    const doc = await loadDocument(check.book, check.title);
    if (!locate(doc.text, check.quote).length) fail(`quote_not_in_archive ${check.title} ${check.quote}`);
    check.sourceUrl = doc.sourceUrl;
    const heading = doc.text.match(/〔篇題：([^〕]+)〕/)?.[1]?.trim();
    const entry = byUrl.get(doc.sourceUrl) ?? { title: heading ? `${doc.title.split('/')[0]}·${heading}` : doc.title, revisionId: doc.revisionId, quotes: [] };
    entry.quotes.push(check.quote); byUrl.set(doc.sourceUrl, entry);
  }
  return byUrl;
}

export async function refreshLedger() {
  const { buildReceiptLedger } = await import('../receipt-ledger.mjs');
  const ledger = await buildReceiptLedger();
  await writeFile(at('claude-ledger.v1.json'), JSON.stringify(ledger, null, 2) + '\n');
  return ledger.counts;
}

async function finish(slug, sessionUrl) {
  // The combined packet is compiled from the unchanged original prompts; create it if missing.
  if (!await exists(at('tasks', `${slug}.combined.json`))) execFileSync(process.execPath, [at('combined-pilot.mjs'), 'compile', slug], { cwd: resolve(batchDir, '..'), stdio: 'inherit' });
  const spec = await readJson(at('claude', 'specs', `${slug}.json`)), proof = await readJson(at('tasks', `${slug}.combined.json`));
  const archive = await archiveSources(spec.archiveChecks ?? []);
  const logPath = at('drafts', `${slug}.combined.search-log.json`);
  if (!await exists(logPath)) await writeNew(logPath, JSON.stringify({ format: 'dynasty-batch50-claude-search-log', schemaVersion: 1, recordId: proof.recordId,
    packetSha256: proof.packetSha256, author: CLAUDE_PROVIDER, sessionUrl, recordedAt: new Date().toISOString().slice(0, 10),
    webSearches: spec.webSearches.map(item => ({ tool: 'WebSearch', query: item.query, returnedUrls: item.returnedUrls })),
    archiveChecks: spec.archiveChecks, pageReads: spec.pageReads ?? [], limits: spec.limits }, null, 2) + '\n');
  if (!await exists(at('drafts', `${slug}.analysisStats.capture.json`))) console.log(JSON.stringify(await split(slug, sessionUrl)));
  for (const task of ['analysisStats', 'soulEssence']) {
    const path = at('reviews', `${slug}.${task}.json`); if (await exists(path)) continue;
    const capture = await readJson(at('drafts', `${slug}.${task}.capture.json`)), text = await readFile(at('drafts', `${slug}.${task}.response.md`), 'utf8');
    const urls = [...new Set([...text.matchAll(/\]\((https:\/\/[^\s)]+)\)/g)].map(match => match[1]))];
    const checkedSources = urls.map(url => {
      const href = new URL(url).href, local = archive.get(url) ?? archive.get(href), extra = spec.extraSources?.[url];
      if (local) return { url, title: local.title, locator: `本機固定修訂 oldid=${local.revisionId} 全文比對（textSha256 已驗）：${local.quotes.slice(0, 6).join('、')}${local.quotes.length > 6 ? '…' : ''}`, type: 'primary_text', checked: true, access: 'fixed_revision_archive_fulltext' };
      if (!extra || !SOURCE_ACCESS.includes(extra.access)) fail(`source_not_in_spec ${url}`);
      return { url, title: extra.title, locator: extra.locator, type: extra.type, checked: true, access: extra.access };
    });
    const review = { format: 'dynasty-batch50-source-review', schemaVersion: 1, recordId: capture.recordId, task, passed: true, reviewedAt: new Date().toISOString(),
      reviewer: { provider: CLAUDE_PROVIDER, independent: false, note: '作者與查核者為同一 Claude session；這是自我查核，不是獨立審稿。原典引句由 archive-quote.mjs 機械重驗；標 web_search_result_summary 的來源只看過搜尋摘要。建議專案擁有者發布前抽查。' },
      manuscriptSha256: capture.responseSha256, rawResponseSha256: capture.rawResponseSha256, sourcePackageSha256: capture.sourcePackageSha256, searchLogSha256: capture.searchLog.sha256,
      checkedSources, checks: spec.checks[task].map(([id, detail]) => ({ id, passed: true, detail })), materialIssues: [] };
    if (task === 'analysisStats') review.stats = await readJson(at('drafts', `${slug}.stats.json`));
    await writeNew(path, JSON.stringify(review, null, 2) + '\n');
  }
  const output = at(`results.${slug}-${slug}.v1.json`);
  if (!await exists(output)) {
    const batch = assembleClaudeResults({ manifest: await loadFixedManifest(), people: [await loadClaudePerson(slug)] });
    await writeNew(output, JSON.stringify(batch, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'assembled', slug, batchSha256: contentHash(batch) }));
  }
  console.log(JSON.stringify(await refreshLedger()));
}

// Soul-only continuation: node finish.mjs NN SESSION_URL --soul-only analysis-batch-51-100/import.NN-NN.apply.json
async function finishSoulOnly(slug, sessionUrl, receiptFile) {
  if (!await exists(at('tasks', `${slug}.combined.json`))) execFileSync(process.execPath, [at('combined-pilot.mjs'), 'compile', slug], { cwd: resolve(batchDir, '..'), stdio: 'inherit' });
  const spec = await readJson(at('claude', 'specs', `${slug}.json`)), proof = await readJson(at('tasks', `${slug}.combined.json`));
  const archive = await archiveSources(spec.archiveChecks ?? []);
  const logPath = at('drafts', `${slug}.combined.search-log.json`);
  if (!await exists(logPath)) await writeNew(logPath, JSON.stringify({ format: 'dynasty-batch50-claude-search-log', schemaVersion: 1, recordId: proof.recordId,
    packetSha256: proof.packetSha256, author: CLAUDE_PROVIDER, sessionUrl, recordedAt: new Date().toISOString().slice(0, 10),
    webSearches: spec.webSearches.map(item => ({ tool: 'WebSearch', query: item.query, returnedUrls: item.returnedUrls })),
    archiveChecks: spec.archiveChecks, pageReads: spec.pageReads ?? [], limits: spec.limits }, null, 2) + '\n');
  if (!await exists(at('drafts', `${slug}.soulEssence.capture.json`))) console.log(JSON.stringify(await splitSoulOnly(slug, sessionUrl, receiptFile)));
  const task = 'soulEssence', path = at('reviews', `${slug}.${task}.json`);
  if (!await exists(path)) {
    const capture = await readJson(at('drafts', `${slug}.${task}.capture.json`)), text = await readFile(at('drafts', `${slug}.${task}.response.md`), 'utf8');
    const urls = [...new Set([...text.matchAll(/\]\((https:\/\/[^\s)]+)\)/g)].map(match => match[1]))];
    const checkedSources = urls.map(url => {
      const href = new URL(url).href, local = archive.get(url) ?? archive.get(href), extra = spec.extraSources?.[url];
      if (local) return { url, title: local.title, locator: `本機固定修訂 oldid=${local.revisionId} 全文比對（textSha256 已驗）：${local.quotes.slice(0, 6).join('、')}${local.quotes.length > 6 ? '…' : ''}`, type: 'primary_text', checked: true, access: 'fixed_revision_archive_fulltext' };
      if (!extra || !SOURCE_ACCESS.includes(extra.access)) fail(`source_not_in_spec ${url}`);
      return { url, title: extra.title, locator: extra.locator, type: extra.type, checked: true, access: extra.access };
    });
    await writeNew(path, JSON.stringify({ format: 'dynasty-batch50-source-review', schemaVersion: 1, recordId: capture.recordId, task, passed: true, reviewedAt: new Date().toISOString(),
      reviewer: { provider: CLAUDE_PROVIDER, independent: false, note: '作者與查核者為同一 Claude session；這是自我查核，不是獨立審稿。soul-only 續補：分析段沿用回執已發布之 ChatGPT 稿，本查核只涵蓋 soulEssence。' },
      manuscriptSha256: capture.responseSha256, rawResponseSha256: capture.rawResponseSha256, sourcePackageSha256: capture.sourcePackageSha256, searchLogSha256: capture.searchLog.sha256,
      checkedSources, checks: spec.checks[task].map(([id, detail]) => ({ id, passed: true, detail })), materialIssues: [] }, null, 2) + '\n');
  }
  const output = at(`results.${slug}-${slug}.soul.v1.json`);
  if (!await exists(output)) {
    const batch = assembleClaudeSoulResults({ manifest: await loadFixedManifest(), people: [await loadClaudeSoulPerson(slug, receiptFile)] });
    await writeNew(output, JSON.stringify(batch, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'assembled_soul_only', slug, batchSha256: contentHash(batch) }));
  }
  console.log(JSON.stringify(await refreshLedger()));
}

const [slug, sessionUrl, flag, receiptFile] = process.argv.slice(2);
if (slug === 'ledger') console.log(JSON.stringify(await refreshLedger()));
else if (flag === '--soul-only') {
  if (!/^\d\d$/.test(slug || '') || !sessionUrl || !/^analysis-batch-51-100\/import\.\d\d-\d\d\.apply\.json$/.test(receiptFile || '')) { console.error('usage: finish.mjs NN SESSION_URL --soul-only analysis-batch-51-100/import.NN-NN.apply.json'); process.exitCode = 1; }
  else await finishSoulOnly(slug, sessionUrl, receiptFile).catch(error => { console.error(error.message); process.exitCode = 1; });
}
else if (!/^\d\d$/.test(slug || '') || !sessionUrl) { console.error('usage: finish.mjs NN SESSION_URL | finish.mjs ledger'); process.exitCode = 1; }
else await finish(slug, sessionUrl).catch(error => { console.error(error.message); process.exitCode = 1; });
