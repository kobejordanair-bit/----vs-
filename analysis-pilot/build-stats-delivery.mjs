// Offline public packaging. Importing this module never reads or writes files.
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { strictJsonParse, USER_FIELDS, record } from '../cloudflare/src/contracts.mjs';
import { validateStatsBatch, validateStatsAnalysis, STATS_DIMENSIONS, AUTHORIZED_STATS_IDS } from '../cloudflare/scripts/analysis-pilot-stats-import.mjs';
import { sha256, contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { markdownToHtml } from './build-delivery.mjs';

const here = dirname(fileURLToPath(import.meta.url)), appRoot = resolve(here, '..'), workspaceRoot = resolve(appRoot, '..');
export const STATS_DEPLOYMENT_VERSION = '4be36bf6-dff7-4799-9a4a-528a33407a95';
const ORIGIN = 'https://dynasty.piamamba.com/play', WANG_ID = 'general_王翦_306401394';
const ARTICLE_FIELDS = ['analysis', 'deepAnalysis', 'soulEssence'];
const FIGURES = { emperor_北魏孝文帝_33257620: { name: '北魏孝文帝', slug: 'xiaowendi' }, minister_姚崇_2003901767: { name: '姚崇', slug: 'yaochong' } };
const hashOk = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sameIds = (ids, expected = AUTHORIZED_STATS_IDS) => Array.isArray(ids) && isDeepStrictEqual([...ids].sort(), [...expected].sort());
const sameHash = (before, after) => hashOk(before) && before === after;
const within = (root, target) => { const path = relative(root, target); return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)); };
const blocked = path => /(?:^|[\/\\._-])(?:private|secrets?|credentials?|tokens?|keys?|backup|backups|userdata|snapshot|bson)(?:[\/\\._-]|$)/i.test(path);
const escape = text => String(text ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const link = path => path.split('/').map(part => part === '..' ? part : encodeURIComponent(part)).join('/');
function bad(code) { const error = new Error(code); error.code = code; throw error; }

export function expectedStatsObservations(batch) {
  validateStatsBatch(batch);
  return batch.records.map(item => ({ id: item.id, stats: [...item.fields.stats], statsAnalysisSha256: sha256(item.fields.statsAnalysis),
    reasonSections: validateStatsAnalysis(item.fields.statsAnalysis, item.fields.stats).map(section => ({ dimension: section.dimension, score: section.score, sourceReasonSha256: sha256(section.reason), sourceReasonUtf16CodeUnits: section.reason.length })) }));
}
function validateReadEvidence(evidence) {
  if (!record(evidence) || !['browser_network_log', 'browser_fetch_monitor'].includes(evidence.method)
    || evidence.passed !== true || evidence.monitorStartedBeforeOpen !== true || evidence.aiRequests !== 0 || evidence.userdataPosts !== 0) bad('cached_read_observation_required');
}
function validateObservation(observation, expected) {
  if (!record(observation) || observation.passed !== true || !isDeepStrictEqual(observation.stats, expected.stats)
    || observation.radarVisible !== true || observation.statsAnalysisSha256 !== expected.statsAnalysisSha256) bad('stats_browser_values_mismatch');
  if (!Array.isArray(observation.reasonSections) || observation.reasonSections.length !== 5) bad('stats_browser_reasons_incomplete');
  for (const [index, section] of observation.reasonSections.entries()) {
    const source = expected.reasonSections[index];
    if (!record(section) || section.dimension !== source.dimension || section.score !== source.score
      || section.sourceReasonSha256 !== source.sourceReasonSha256 || section.headingVisible !== true
      || section.bodyVisible !== true || section.headMatched !== true || section.tailMatched !== true) bad('stats_browser_reasons_mismatch');
  }
  validateReadEvidence(observation.readEvidence);
}
function validatePersistence(evidence, expected, importReport, audit) {
  if (!record(evidence) || evidence.passed !== true || evidence.revision !== 4
    || !Number.isFinite(Date.parse(evidence.readAt)) || Date.parse(evidence.readAt) < Date.parse(audit.verifiedAt)
    || evidence.documentSha256 !== importReport.verification.afterSha256
    || !Array.isArray(evidence.records) || !sameIds(evidence.records.map(item => item.id))) bad('fresh_persisted_read_required');
  for (const item of evidence.records) {
    const source = expected.find(value => value.id === item.id);
    if (!isDeepStrictEqual(item.stats, source.stats) || item.statsAnalysisSha256 !== source.statsAnalysisSha256) bad('persisted_stats_mismatch');
  }
  if (evidence.method === 'fresh_sdk_document_read') {
    if (evidence.browserReloadPerformed !== false || evidence.writeAttempted === true) bad('sdk_read_must_not_claim_browser_reload');
  } else if (evidence.method === 'browser_reload') {
    if (evidence.browserReloadPerformed !== true || evidence.versionId !== STATS_DEPLOYMENT_VERSION) bad('browser_reload_version_mismatch');
    validateReadEvidence(evidence.readEvidence);
  } else bad('persisted_read_method_required');
  return evidence.method;
}

export function validateStatsDelivery({ batch, audit, request, importReport, deployment, browser }) {
  validateStatsBatch(batch);
  const batchSha256 = contentHash(batch), expected = expectedStatsObservations(batch);
  if (!record(request) || request.format !== 'dynasty-stats-completion-request' || request.schemaVersion !== 1
    || request.baselineRevision !== 3 || !sameIds(request.allowedIds) || !isDeepStrictEqual(request.statsOrder, STATS_DIMENSIONS)
    || !Array.isArray(request.records) || !sameIds(request.records.map(item => item.id))
    || request.policy?.preserveAllExistingArticles !== true || request.policy?.preserveWangJianStats !== true
    || request.policy?.actualChatGPTWebAndWebSearchRequired !== true || request.policy?.privateStateExcluded !== true) bad('stats_delivery_request_mismatch');
  for (const item of batch.records) {
    const input = request.records.find(value => value.id === item.id);
    if (input.promptSha256 !== item.promptSha256 || ARTICLE_FIELDS.some(field => !hashOk(input[field + 'Sha256']))) bad('stats_delivery_input_binding_mismatch');
  }
  if (!record(importReport) || importReport.format !== 'dynasty-analysis-pilot-stats-import' || importReport.schemaVersion !== 1
    || importReport.mode !== 'apply' || importReport.status !== 'applied_verified' || importReport.passed !== true
    || importReport.beforeRevision !== 3 || importReport.plannedAfterRevision !== 4 || importReport.targetCount !== 2
    || importReport.changedFields !== 4 || importReport.batchSha256 !== batchSha256 || importReport.writeAttempted !== true || importReport.writeSucceeded !== true
    || importReport.verification?.passed !== true || importReport.verification.targetsMatch !== true || importReport.verification.contentPreserved !== true
    || importReport.verification.revisionMatches !== true || importReport.verification.afterRevision !== 4
    || !sameHash(importReport.plannedAfterSha256, importReport.verification.afterSha256)
    || !sameHash(importReport.verification.unaffectedBeforeSha256, importReport.verification.unaffectedAfterSha256)) bad('stats_delivery_apply_report_mismatch');
  const writtenFieldHashes = batch.records.flatMap(item => ['stats', 'statsAnalysis'].map(field => ({ field, sha256: field === 'stats' ? contentHash(item.fields[field]) : sha256(item.fields[field]) })));
  if (!isDeepStrictEqual(importReport.writtenFieldHashes, writtenFieldHashes)) bad('stats_delivery_written_field_hash_mismatch');
  if (!record(audit) || audit.format !== 'dynasty-stats-completion-audit' || audit.schemaVersion !== 1
    || audit.passed !== true || audit.status !== 'complete_verified' || audit.batchSha256 !== batchSha256
    || audit.beforeRevision !== 3 || audit.afterRevision !== 4 || audit.targetCount !== 2 || audit.addedFields !== 4
    || audit.figureCount !== 962 || audit.figureIdsPreserved !== true || audit.wangJianStatsPreserved !== true
    || audit.rawExtrasPreserved !== true || audit.rawStoredDocumentMatchesExpected !== true || audit.rawCasSucceeded !== true
    || !sameHash(audit.unaffectedBeforeSha256, audit.unaffectedAfterSha256) || audit.unaffectedBeforeSha256 !== importReport.beforeSha256
    || !Number.isFinite(Date.parse(audit.verifiedAt)) || !Number.isSafeInteger(audit.statsCountBefore)
    || audit.statsCountBefore < 0 || audit.statsCountAfter !== audit.statsCountBefore + 2) bad('stats_delivery_preservation_audit_required');
  if (!record(audit.userdataFields) || !sameIds(Object.keys(audit.userdataFields), USER_FIELDS)
    || USER_FIELDS.some(field => audit.userdataFields[field]?.preserved !== true || !sameHash(audit.userdataFields[field].beforeSha256, audit.userdataFields[field].afterRemovingAdditionsSha256))) bad('stats_delivery_userdata_preservation_required');
  const articleKeys = [...AUTHORIZED_STATS_IDS, WANG_ID].flatMap(id => ARTICLE_FIELDS.map(field => id + ':' + field));
  if (!Array.isArray(audit.articles) || !sameIds(audit.articles.map(item => item.id + ':' + item.field), articleKeys)
    || audit.articles.some(item => item.preserved !== true || !sameHash(item.beforeSha256, item.afterSha256))) bad('stats_delivery_nine_articles_required');
  for (const input of request.records) for (const field of ARTICLE_FIELDS) {
    if (audit.articles.find(item => item.id === input.id && item.field === field).beforeSha256 !== input[field + 'Sha256']) bad('stats_delivery_article_input_hash_mismatch');
  }
  if (!record(deployment) || deployment.format !== 'dynasty-stats-ui-deployment' || deployment.schemaVersion !== 1
    || deployment.passed !== true || deployment.versionId !== STATS_DEPLOYMENT_VERSION || deployment.origin !== ORIGIN
    || deployment.httpStatus !== 200 || deployment.publishedHasStatsDetails !== true || deployment.publishedMatchesRawSource !== true
    || !sameHash(deployment.sourceRawSha256, deployment.publishedSha256)) bad('stats_delivery_deployment_mismatch');
  if (!record(browser) || browser.format !== 'dynasty-stats-browser-verification' || browser.schemaVersion !== 1
    || browser.origin !== ORIGIN || browser.publishedVersionId !== deployment.versionId || browser.publishedSourceMatches !== true
    || browser.productionImportVerified !== true || !Array.isArray(browser.observations)) bad('stats_delivery_browser_receipt_invalid');
  let persistedReadMethod = null;
  if (browser.persistedReload !== undefined) persistedReadMethod = validatePersistence(browser.persistedReload, expected, importReport, audit);
  if (browser.complete === true) {
    if (browser.status !== 'verified' || browser.newStatsPanelsVerified !== true || !sameIds(browser.observations.map(item => item.id))) bad('stats_delivery_complete_observations_required');
    for (const observation of browser.observations) validateObservation(observation, expected.find(item => item.id === observation.id));
    if (!persistedReadMethod) bad('fresh_persisted_read_required');
  } else if (browser.complete === false) {
    if (!['awaiting_user_login', 'verification_in_progress'].includes(browser.status) || browser.newStatsPanelsVerified !== false
      || typeof browser.pendingReason !== 'string' || !browser.pendingReason.trim()) bad('stats_delivery_pending_status_required');
  } else bad('stats_delivery_browser_complete_boolean_required');
  return { passed: true, batchSha256, browserComplete: browser.complete, browserStatus: browser.status, persistedReadMethod, expected };
}

export const PUBLIC_EVIDENCE = Object.freeze([
  'stats-results.v1.json', 'stats-completion-audit.json', 'stats-import-apply.json', 'stats-deployment.json', 'stats-sdk-final-read.json',
  'browser-verification-observed.json', 'stats-browser-verification.json', 'stats-final-tests.log', 'stats-delivery-tests.log', 'drafts/stats-review.iteration3.raw.md', 'stats-request.v1.json',
  'stats-input-bindings.v1.json', 'stats-reference.v1.json', 'website-source-binding.json', 'stats-d1-adapter-design.v1.json', 'stats-capture-contract.md',
  ...Object.values(FIGURES).flatMap(({ slug }) => ['prompts/' + slug + '.stats.prompt.md', 'drafts/' + slug + '.stats.raw.md', 'drafts/' + slug + '.stats.md', 'drafts/' + slug + '.stats.capture.json', 'drafts/' + slug + '.stats.search-evidence.txt', 'source-review.' + slug + '.stats.json']),
]);
export const PUBLIC_CODE = Object.freeze(['backend/index.html', 'cloudflare/scripts/analysis-pilot-stats-import.mjs', 'cloudflare/tests/analysis-stats-only.test.mjs', 'cloudflare/tests/analysis-pilot-stats-import.test.mjs', 'analysis-pilot/original-prompt-renderer.mjs', 'analysis-pilot/original-website-source.html', 'analysis-pilot/build-stats-delivery.mjs', 'analysis-pilot/build-stats-delivery.test.mjs']);
async function readPublicFile(root, path) {
  const target = resolve(root, path);
  if (!within(root, target) || blocked(path)) bad('regular_public_evidence_required');
  const info = await lstat(target), actual = await realpath(target);
  if (!info.isFile() || info.isSymbolicLink() || !within(await realpath(root), actual) || blocked(relative(root, actual))) bad('regular_public_evidence_required');
  return readFile(target);
}
export function parseStatsDeliveryArguments(values) {
  if (!values.length) return { output: resolve(workspaceRoot, '人物分析ChatGPT試跑_2026-10-09/五維補評交付') };
  if (values.length !== 2 || values[0] !== '--output' || !values[1] || values[1].startsWith('--')) bad('usage_output_fresh_path_required');
  const output = resolve(values[1]);
  if (!within(workspaceRoot, output) || output === workspaceRoot || blocked(relative(workspaceRoot, output))) bad('public_delivery_output_required');
  return { output };
}

export async function writeStatsDelivery(materials, sourceFiles, output, boundary = workspaceRoot) {
  const validation = validateStatsDelivery(materials); // No filesystem writes before the gate.
  const allowed = [...PUBLIC_EVIDENCE.map(path => 'evidence/' + path), ...PUBLIC_CODE.map(path => 'code/' + path)];
  if (!Array.isArray(sourceFiles) || !sameIds(sourceFiles.map(item => item.path), allowed) || sourceFiles.some(item => !Buffer.isBuffer(item.bytes))) bad('public_delivery_files_incomplete');
  for (const [key, name] of Object.entries({ batch: 'stats-results.v1.json', audit: 'stats-completion-audit.json', request: 'stats-request.v1.json', importReport: 'stats-import-apply.json', deployment: 'stats-deployment.json', browser: 'stats-browser-verification.json' })) {
    const copied = strictJsonParse(sourceFiles.find(item => item.path === 'evidence/' + name).bytes.toString('utf8'));
    if (!isDeepStrictEqual(copied, materials[key])) bad('packaged_evidence_differs_from_validated_inputs');
  }
  output = resolve(output);
  if (!within(boundary, output) || output === resolve(boundary) || blocked(relative(boundary, output))) bad('public_delivery_output_required');
  try { await lstat(output); bad('delivery_output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parent = dirname(output), parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || !within(await realpath(boundary), await realpath(parent))) bad('public_delivery_parent_required');
  const { batch, audit } = materials;
  const browserText = validation.browserComplete ? '新版雷達圖、分數與五段理由已實際瀏覽驗證。' : '資料匯入與介面部署已完成；新版畫面驗證尚未完成。' + (validation.browserStatus === 'awaiting_user_login' ? '等待使用者登入。' : '驗證進行中。');
  const persistenceText = validation.persistedReadMethod === 'fresh_sdk_document_read' ? '已用 SDK 重新讀取正式文件確認保存；此證據不代表瀏覽器重新整理。' : validation.persistedReadMethod === 'browser_reload' ? '已實際重新整理瀏覽器並核對保存內容。' : '保存後重新讀取的驗收尚待完成。';
  const css = 'body{margin:0;background:#f5f1e8;color:#28383e;font:17px/1.85 "Microsoft JhengHei",sans-serif}main{max-width:980px;margin:auto;padding:44px 24px}h1,h2,h3{font-family:"PMingLiU",serif}a{color:#49627b}table{width:100%;border-collapse:collapse;background:#fffdf7}th,td{padding:13px;border-bottom:1px solid #dbd2bd;text-align:center}.article{background:#fffdf7;padding:24px;border:1px solid #dbd2bd;border-radius:12px;margin:24px 0}.muted{font-size:14px;color:#637177}';
  const page = (title, body) => '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) + '</title><style>' + css + '</style><main><p class="muted">' + escape(browserText) + '</p><p class="muted">' + escape(persistenceText) + '</p>' + body + '</main></html>';
  const generated = batch.records.map(item => {
    const meta = FIGURES[item.id];
    return { path: meta.slug + '.五維.html', bytes: Buffer.from(page(meta.name + '・五維補評', '<a href="總覽.html">← 返回五維總覽</a><h1>' + escape(meta.name) + '・五維補評</h1><p>統率／武力／智謀／政治／魅力：' + item.fields.stats.map(escape).join('／') + '</p><article class="article">' + markdownToHtml(item.fields.statsAnalysis) + '</article><p class="muted">ChatGPT 實際網搜稿；文體轉換未補寫正文。正文 SHA-256：' + escape(sha256(item.fields.statsAnalysis)) + '</p>')) };
  });
  const rows = batch.records.map(item => '<tr><th>' + escape(FIGURES[item.id].name) + '</th>' + item.fields.stats.map(value => '<td>' + escape(value) + '</td>').join('') + '<td><a href="' + link(FIGURES[item.id].slug + '.五維.html') + '">閱讀理由</a></td></tr>').join('');
  const originalOverview = relative(output, resolve(workspaceRoot, '人物分析ChatGPT試跑_2026-10-09/最終交付/總覽.html')).split(sep).join('/');
  const title = validation.browserComplete ? '五維補評與新版畫面驗證完成' : '五維補評已匯入・新版畫面待驗證';
  generated.push({ path: '總覽.html', bytes: Buffer.from(page('王侯將相・五維補評交付', '<h1>' + escape(title) + '</h1><p>孝文帝與姚崇的五項能力與理由已補上。九份原文章、王翦原五維及其他使用者資料均通過保全核對。</p><p><a href="' + ORIGIN + '">開啟網站</a> · <a href="' + link(originalOverview) + '">閱讀原九份文章</a></p><table><thead><tr><th>人物</th>' + STATS_DIMENSIONS.map(name => '<th>' + escape(name) + '</th>').join('') + '<th>全文</th></tr></thead><tbody>' + rows + '</tbody></table><div class="article"><h2>網站功能修正</h2><p>賞析頁顯示雷達圖、數值與獨立理由。生成或重算五維只更新數值與理由，保留賞析原文；純閱讀使用已保存內容。</p><p>userdata revision ' + escape(audit.beforeRevision) + ' → ' + escape(audit.afterRevision) + '，只新增兩人四個欄位。<a href="evidence/stats-completion-audit.json">資料保全核對</a> · <a href="evidence/stats-browser-verification.json">網站驗證收據</a></p></div><h2>可重現證據</h2><p>原 PROMPT、實際 ChatGPT 稿件、網搜紀錄、來源查核、測試與部署收據：<a href="public-manifest.json">檔案清單與雜湊</a>。</p>')) });
  await mkdir(output, { recursive: false });
  const manifest = [];
  for (const item of [...sourceFiles, ...generated]) {
    const target = resolve(output, item.path);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, item.bytes, { flag: 'wx' });
    manifest.push({ path: item.path, bytes: item.bytes.length, sha256: sha256(item.bytes) });
  }
  await writeFile(resolve(output, 'public-manifest.json'), JSON.stringify({ format: 'dynasty-stats-public-delivery', schemaVersion: 1, createdAt: new Date().toISOString(), browserVerificationComplete: validation.browserComplete, browserVerificationStatus: validation.browserStatus, persistedReadMethod: validation.persistedReadMethod, privateFilesIncluded: false, files: manifest }, null, 2) + '\n', { flag: 'wx' });
  return { status: validation.browserComplete ? 'public_delivery_verified' : 'public_delivery_pending_browser', fileCount: manifest.length, output, browserVerificationComplete: validation.browserComplete };
}

export async function main(values = process.argv.slice(2)) {
  try {
    const args = parseStatsDeliveryArguments(values), sourceFiles = [];
    for (const path of PUBLIC_EVIDENCE) sourceFiles.push({ path: 'evidence/' + path, bytes: await readPublicFile(here, path) });
    for (const path of PUBLIC_CODE) sourceFiles.push({ path: 'code/' + path, bytes: await readPublicFile(appRoot, path) });
    const json = name => strictJsonParse(sourceFiles.find(item => item.path === 'evidence/' + name).bytes.toString('utf8'));
    const materials = { batch: json('stats-results.v1.json'), audit: json('stats-completion-audit.json'), request: json('stats-request.v1.json'), importReport: json('stats-import-apply.json'), deployment: json('stats-deployment.json'), browser: json('stats-browser-verification.json') };
    validateStatsDelivery(materials);
    if (sha256(sourceFiles.find(item => item.path === 'code/backend/index.html').bytes) !== materials.deployment.sourceRawSha256) bad('delivery_code_differs_from_deployment');
    const result = await writeStatsDelivery(materials, sourceFiles, args.output);
    console.log(JSON.stringify(result)); return 0;
  } catch (error) { console.error(JSON.stringify({ status: error.code || 'stats_delivery_failed', passed: false })); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
