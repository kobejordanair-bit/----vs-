// One-command finishing step for a Claude-authored person:
//   node analysis-batch-50/claude/finish.mjs NN https://claude.ai/code/session_...
// Reads claude/specs/NN.json (actual searches, archive quotations, review
// checks, non-archive sources), writes the search log, splits the manuscript,
// writes the self-reviews, assembles results.NN-NN.v1.json and refreshes
// claude-ledger.v1.json. Never overwrites an existing output.
import { readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDocument, locate } from './archive-quote.mjs';
import { split, loadClaudePerson, assembleClaudeResults, SOURCE_ACCESS } from '../claude-author.mjs';
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
  const progress = await readJson(at('progress.v1.json')), claude = new Map();
  for (const file of (await readdir(batchDir)).filter(name => /^results\.\d\d-\d\d\.v1\.json$/.test(name)).sort()) {
    const batch = await readJson(at(file));
    for (const item of batch.records) if (item.provenance.provider === CLAUDE_PROVIDER) claude.set(item.id, { file, sha256: sha256(await readFile(at(file))) });
  }
  const receipts = await readJson(at('claude-receipts.v1.json')).catch(() => ({ imports: [] }));
  const imported = new Map(receipts.imports.flatMap(entry => entry.ids.map(id => [id, entry])));
  const notes = {
    '05': 'ChatGPT 稿史實查核不合格（李勣 666 年任遼東道行軍大總管 vs 668 年克平壤），未匯入；失敗稿存 attempts/05.analysisStats.1/。',
    '06': '已發布 analysis/stats/statsAnalysis（import.06-06.apply.json）；缺 soulEssence。需綁定既有回執的 soul-only 續補匯入路徑，不得放寬成任意覆蓋。',
  };
  const records = progress.records.map(record => {
    const full = record.fullyImported, partial = record.importedFields.length > 0 && !full, own = claude.get(record.id), receipt = imported.get(record.id);
    const entry = { slug: record.slug, id: record.id, name: record.name, provider: own ? CLAUDE_PROVIDER : (full || partial || record.slug === '05') ? 'ChatGPT web' : null,
      generated: Boolean(own) || full || partial || record.slug === '05', reviewed: Boolean(own) || full || partial, assembled: Boolean(own) || full || partial,
      imported: full || Boolean(receipt?.verified), verified: full || Boolean(receipt?.verified), importedFields: receipt?.verified ? ['analysis', 'soulEssence', 'stats', 'statsAnalysis'] : record.importedFields,
      status: receipt?.verified ? 'fully_imported' : own ? 'assembled_awaiting_local_dry_run' : record.status };
    if (own) Object.assign(entry, { reviewKind: 'self_review_not_independent', resultsFile: `analysis-batch-50/${own.file}`, resultsSha256: own.sha256 });
    if (notes[record.slug] && !own) entry.note = notes[record.slug];
    return entry;
  });
  const count = key => records.filter(item => item[key]).length;
  const ledger = { format: 'dynasty-batch50-claude-ledger', schemaVersion: 1, asOf: new Date().toISOString().slice(0, 10), targetCount: 50, libraryTotalExpected: 962,
    authorPolicy: { file: 'analysis-batch-50/author-policy.v2.json', sha256: AUTHOR_POLICY_SHA256 },
    basis: 'progress.v1.json (unchanged, receipt-bound) plus Claude results files and claude-receipts.v1.json. Only imported+verified counts as complete; import requires a local authorized run.',
    latestVerifiedPublicationRevision: receipts.latestVerifiedRevision ?? 7,
    counts: { generated: count('generated'), reviewed: count('reviewed'), assembled: count('assembled'), imported: count('imported'), verified: count('verified'),
      partialImported: records.filter(item => item.importedFields.length && !item.imported).length, importedFields: records.reduce((sum, item) => sum + item.importedFields.length, 0),
      claudeAssembledAwaitingImport: records.filter(item => item.status === 'assembled_awaiting_local_dry_run').length, remainingIncomplete: 50 - count('verified') },
    caveats: ['audit-progress.mjs / final-audit-proof.mjs assume ten consecutive 5-person full batches; not run against this mixed chain until adapted.', 'import.01-01.dry-run.json was never applied and is not counted.'],
    records };
  await writeFile(at('claude-ledger.v1.json'), JSON.stringify(ledger, null, 2) + '\n');
  return ledger.counts;
}

async function finish(slug, sessionUrl) {
  const spec = await readJson(at('claude', 'specs', `${slug}.json`)), proof = await readJson(at('tasks', `${slug}.combined.json`));
  const archive = await archiveSources(spec.archiveChecks ?? []);
  const logPath = at('drafts', `${slug}.combined.search-log.json`);
  if (!await exists(logPath)) await writeNew(logPath, JSON.stringify({ format: 'dynasty-batch50-claude-search-log', schemaVersion: 1, recordId: proof.recordId,
    packetSha256: proof.packetSha256, author: CLAUDE_PROVIDER, sessionUrl, recordedAt: new Date().toISOString().slice(0, 10),
    webSearches: spec.webSearches.map(item => ({ tool: 'WebSearch', query: item.query, returnedUrls: item.returnedUrls })),
    archiveChecks: spec.archiveChecks, limits: spec.limits }, null, 2) + '\n');
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

const [slug, sessionUrl] = process.argv.slice(2);
if (slug === 'ledger') console.log(JSON.stringify(await refreshLedger()));
else if (!/^\d\d$/.test(slug || '') || !sessionUrl) { console.error('usage: finish.mjs NN SESSION_URL | finish.mjs ledger'); process.exitCode = 1; }
else await finish(slug, sessionUrl).catch(error => { console.error(error.message); process.exitCode = 1; });
