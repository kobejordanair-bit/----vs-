// Independent, read-only inspection of the completed public delivery package.
// Never reads cloudflare/private, original userdata snapshots or production.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { strictJsonParse, record } from '../cloudflare/src/contracts.mjs';
import { contentHash, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_LAYERS } from '../cloudflare/scripts/analysis-pilot-layers-import.mjs';
import { validateCompleteAudit, markdownToHtml } from './build-delivery.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const deliveryRoot = path.resolve(appRoot, '..', '人物分析ChatGPT試跑_2026-10-09', '完整交付');
const json = async file => strictJsonParse(await fs.readFile(file, 'utf8'));
const source = relative => path.join(appRoot, relative);
const delivered = relative => path.join(deliveryRoot, relative);
const findings = [], checks = [];
function check(id, passed, metadata = {}) { checks.push({ id, passed: Boolean(passed), ...metadata }); if (!passed) findings.push({ code: id, severity: 'error' }); }
const names = {
  'emperor_北魏孝文帝_33257620': 'xiaowendi',
  'general_王翦_306401394': 'wangjian',
  'minister_姚崇_2003901767': 'yaochong',
};

async function walk(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) { check('no_symlink', false, { path: relative }); continue; }
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function inspectJson(value, filename, depth = 0) {
  if (depth > 100) { findings.push({ code: 'json_scan_depth_exceeded', severity: 'error', path: filename }); return; }
  if (Array.isArray(value)) { for (const item of value) inspectJson(item, filename, depth + 1); return; }
  if (!record(value)) return;
  if (Array.isArray(value.customLegends) && record(value.modifiedLegends) && (record(value.chatHistories) || Array.isArray(value.soulSaves))) findings.push({ code: 'private_userdata_document_present', severity: 'error', path: filename });
  for (const [key, item] of Object.entries(value)) {
    if (['APP_SECRET', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'CLOUDFLARE_API_TOKEN', 'MONGODB_URI'].includes(key) && typeof item === 'string' && item.trim()) findings.push({ code: 'credential_value_present', severity: 'error', path: filename });
    if (['soulSaves', 'simulationHistory'].includes(key) && Array.isArray(item) && item.length) findings.push({ code: 'private_progress_records_present', severity: 'error', path: filename });
    if (key === 'chatHistories' && record(item) && Object.values(item).some(Array.isArray)) findings.push({ code: 'private_chat_records_present', severity: 'error', path: filename });
    if (key === 'discussionHistories' && record(item) && Object.values(item).some(group => Array.isArray(group?.messages))) findings.push({ code: 'private_discussion_records_present', severity: 'error', path: filename });
    inspectJson(item, filename, depth + 1);
  }
}

const audit = await json(source('analysis-pilot/complete-delivery-audit.json'));
const packageAudit = await json(delivered('analysis-pilot/complete-delivery-audit.json'));
const deep = await json(delivered('analysis-pilot/results.v1.json'));
const layers = await json(delivered('analysis-pilot/layer-results.v1.json'));
const manifest = await json(delivered('public-artifact-manifest.json'));
const status = await json(delivered('delivery-status.json'));
validateCompleteAudit(packageAudit, deep, layers);
check('audit_matches_final_public_source', isDeepStrictEqual(audit, packageAudit));
check('status_binds_audit_and_manifest', status.passed === true && status.status === 'complete_delivered' && status.auditSha256 === contentHash(audit) && status.manifestSha256 === contentHash(manifest));
check('revision_and_library_verified', audit.revision.before === 1 && audit.revision.after === 3 && audit.figures.after.uniqueIds === 962);
check('eight_new_manuscripts_declared', status.newManuscripts === 8 && manifest.newManuscripts === 8 && audit.authorization.totalAddedFields === 8);
check('nine_function_pages_declared', status.personFunctionPages === 9 && manifest.personFunctionPages === 9);

const actualFiles = await walk(deliveryRoot), manifestPaths = new Set();
let manifestHashMatches = 0, sourceMatches = 0;
for (const item of manifest.files) {
  const absolute = delivered(item.path), relative = path.relative(deliveryRoot, absolute);
  if (!item.path || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) || manifestPaths.has(item.path)) { check('manifest_paths_unique_and_contained', false); continue; }
  manifestPaths.add(item.path);
  const bytes = await fs.readFile(absolute);
  if (bytes.length === item.bytes && sha256(bytes) === item.sha256) manifestHashMatches++;
  else check('manifest_file_hash_mismatch', false, { path: item.path });
  if (item.path.startsWith('analysis-pilot/') || item.path.startsWith('cloudflare/') || item.path.startsWith('backend/')) {
    const original = await fs.readFile(source(item.path));
    if (sha256(original) === item.sha256) sourceMatches++;
    else check('copied_source_hash_mismatch', false, { path: item.path });
  }
}
check('all_manifest_file_hashes_match', manifestHashMatches === manifest.files.length, { files: manifest.files.length, matching: manifestHashMatches });
check('package_has_no_unlisted_payload', actualFiles.every(relative => manifestPaths.has(relative) || ['delivery-status.json', 'public-artifact-manifest.json'].includes(relative)), { files: actualFiles.length });
check('no_sensitive_paths_or_backups', actualFiles.every(relative => !/(?:^|\/|[._-])(?:private|secrets?|credentials?|tokens?|keys?|backups?|userdata|snapshot|bson)(?:[._-]|\/|$)/i.test(relative) && !/\.(?:zip|sqlite|db|bson|env)$/i.test(relative)));

let manuscriptPagesMatch = 0;
for (const [id, slug] of Object.entries(names)) {
  for (const field of ['deepAnalysis', 'analysis', 'soulEssence']) {
    const text = field === 'deepAnalysis' ? deep.records.find(item => item.id === id).deepAnalysis
      : AUTHORIZED_LAYERS[id].includes(field) ? layers.records.find(item => item.id === id).fields[field]
      : await fs.readFile(delivered('analysis-pilot/drafts/wangjian.existing.analysis.md'), 'utf8');
    const html = await fs.readFile(delivered(`articles/${slug}.${field}.html`), 'utf8');
    if (html.includes(`<article class="manuscript">${markdownToHtml(text)}</article>`) && html.includes(sha256(text))) manuscriptPagesMatch++;
    else check('article_page_matches_saved_prose', false, { path: `articles/${slug}.${field}.html` });
    if (slug === 'wangjian' && field === 'analysis') check('wangjian_existing_article_label_and_hash', html.includes('網站既有賞析 · 全文保留') && audit.authorization.existingWangJianAnalysisPreserved === true && sha256(text) === sha256(await fs.readFile(source('analysis-pilot/drafts/wangjian.existing.analysis.md'), 'utf8')));
  }
}
check('all_nine_pages_match_original_manuscripts', manuscriptPagesMatch === 9, { matching: manuscriptPagesMatch });
const articleFiles = actualFiles.filter(relative => relative.startsWith('articles/') && relative.endsWith('.html'));
check('exactly_nine_article_pages', articleFiles.length === 9, { pages: articleFiles.length });
const overview = await fs.readFile(delivered('總覽.html'), 'utf8');
const cardCounts = [...overview.matchAll(/<span class="number">(\d+)<\/span>/g)].map(match => Number(match[1]));
check('overview_counts_match_audit', isDeepStrictEqual(cardCounts, [audit.figures.after.uniqueIds, audit.figures.after.deepAnalysis.uniqueFigures, audit.figures.after.analysis.uniqueFigures, audit.figures.after.soulEssence.uniqueFigures]));
let localLinks = 0, brokenLinks = 0;
for (const relative of ['總覽.html', ...articleFiles]) {
  const html = await fs.readFile(delivered(relative), 'utf8');
  for (const match of html.matchAll(/href="([^"#]+)"/g)) {
    if (/^https:\/\//.test(match[1])) continue;
    localLinks++;
    const target = path.resolve(path.dirname(delivered(relative)), decodeURIComponent(match[1]));
    try { if (!(await fs.stat(target)).isFile()) brokenLinks++; } catch { brokenLinks++; }
  }
}
check('all_local_html_links_exist', brokenLinks === 0, { links: localLinks, broken: brokenLinks });

let textFilesScanned = 0, jsonFilesScanned = 0;
for (const relative of actualFiles) {
  if (!/\.(?:json|md|txt|log|mjs|html|css)$/i.test(relative)) continue;
  const text = await fs.readFile(delivered(relative), 'utf8'); textFilesScanned++;
  if (/\.(?:json)$/i.test(relative)) { inspectJson(strictJsonParse(text), relative); jsonFilesScanned++; }
  if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/.test(text) || /\bAIza[0-9A-Za-z_-]{30,}\b/.test(text) || /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(text)) findings.push({ code: 'credential_pattern_detected', severity: 'error', path: relative });
}
check('public_json_has_no_private_state_or_credential_values', !findings.some(item => /private|credential/.test(item.code)), { textFilesScanned, jsonFilesScanned, binaryFilesNotTextScanned: actualFiles.length - textFilesScanned });

const report = {
  format: 'dynasty-public-pilot-package-review', schemaVersion: 1, reviewedAt: new Date().toISOString(), reviewer: 'Independent Codex delivery review subagent',
  scope: 'Read-only public delivery package, manifest, HTML pages and corresponding public app artifacts. No cloudflare/private snapshots, production or browser access.',
  passed: findings.length === 0 && checks.every(item => item.passed), status: findings.length === 0 && checks.every(item => item.passed) ? 'package_verified' : 'package_review_failed',
  checks, findings,
  figures: { total: audit.figures.after.uniqueIds, deepAnalysis: audit.figures.after.deepAnalysis.uniqueFigures, analysis: audit.figures.after.analysis.uniqueFigures, soulEssence: audit.figures.after.soulEssence.uniqueFigures },
  manuscripts: { newlyAdded: 8, preservedExisting: 1, htmlPages: 9 },
  files: { actual: actualFiles.length, manifest: manifest.files.length, manifestHashesMatching: manifestHashMatches, copiedSourcesMatching: sourceMatches, textFilesScanned, jsonFilesScanned },
  integrity: { publicAuditSha256: contentHash(audit), publicManifestSha256: contentHash(manifest), unaffectedBeforeSha256: audit.userdataHashes.unaffectedBeforeSha256, unaffectedAfterSha256: audit.userdataHashes.unaffectedAfterSha256 },
  limitations: ['Credential-pattern and structured JSON scans do not prove the absence of every possible arbitrary secret string. No original private userdata was opened; preservation conclusions refer to the matching final public audit.'],
};
await fs.writeFile(path.join(here, 'package-review.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, passed: report.passed, checks: checks.length, findings: findings.length, files: actualFiles.length, manifestHashMatches, manuscriptPagesMatch, figures: report.figures }));
process.exitCode = report.passed ? 0 : 1;
