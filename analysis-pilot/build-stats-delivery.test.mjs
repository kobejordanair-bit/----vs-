import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, readdir, realpath, rm } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { USER_FIELDS } from '../cloudflare/src/contracts.mjs';
import { contentHash, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_STATS_IDS, STATS_DIMENSIONS } from '../cloudflare/scripts/analysis-pilot-stats-import.mjs';
import { validateStatsDelivery, expectedStatsObservations, writeStatsDelivery, parseStatsDeliveryArguments, PUBLIC_EVIDENCE, PUBLIC_CODE, STATS_DEPLOYMENT_VERSION } from './build-stats-delivery.mjs';

const H = value => sha256('synthetic-only:' + value);
const ORIGIN = 'https://dynasty.piamamba.com/play', WANG = 'general_王翦_306401394';
// All content, hashes and scores in this fixture are synthetic and never imported.
function fixture(complete = false) {
  const batch = { format: 'dynasty-analysis-pilot-stats-results', schemaVersion: 1, records: AUTHORIZED_STATS_IDS.map(id => ({ id, inputSha256: H('input:' + id), promptSha256: H('prompt:' + id),
    fields: { stats: [10, 20, 30, 40, 50], statsAnalysis: STATS_DIMENSIONS.map((name, index) => `### ${name}：${(index + 1) * 10}\n${'完全合成測試理由，不代表任何人物的歷史事實或正式評分。'.repeat(3)}`).join('\n\n') },
    provenance: { provider: 'ChatGPT web', generatedAt: '2026-10-09T00:00:00Z', conversationUrl: 'https://chatgpt.com/c/synthetic-test', webSearchPerformed: true, checkedSources: [{ title: 'Synthetic source', url: 'https://example.org/test', locator: 'Fixture' }] } })) };
  const request = { format: 'dynasty-stats-completion-request', schemaVersion: 1, baselineRevision: 3, allowedIds: [...AUTHORIZED_STATS_IDS], statsOrder: [...STATS_DIMENSIONS],
    policy: { preserveAllExistingArticles: true, preserveWangJianStats: true, actualChatGPTWebAndWebSearchRequired: true, privateStateExcluded: true },
    records: batch.records.map(item => ({ id: item.id, promptSha256: item.promptSha256, analysisSha256: H(item.id + ':analysis'), deepAnalysisSha256: H(item.id + ':deepAnalysis'), soulEssenceSha256: H(item.id + ':soulEssence') })) };
  const audit = { format: 'dynasty-stats-completion-audit', schemaVersion: 1, status: 'complete_verified', passed: true, verifiedAt: '2026-10-09T01:00:00Z', batchSha256: contentHash(batch), beforeRevision: 3, afterRevision: 4, addedFields: 4, targetCount: 2,
    statsCountBefore: 64, statsCountAfter: 66, figureCount: 962, figureIdsPreserved: true, wangJianStatsPreserved: true, rawExtrasPreserved: true, rawStoredDocumentMatchesExpected: true, rawCasSucceeded: true,
    unaffectedBeforeSha256: H('before'), unaffectedAfterSha256: H('before'),
    userdataFields: Object.fromEntries(USER_FIELDS.map(field => [field, { beforeSha256: H(field), afterRemovingAdditionsSha256: H(field), preserved: true }])),
    articles: [...AUTHORIZED_STATS_IDS, WANG].flatMap(id => ['analysis', 'deepAnalysis', 'soulEssence'].map(field => ({ id, field, beforeSha256: H(id + ':' + field), afterSha256: H(id + ':' + field), preserved: true }))) };
  const importReport = { format: 'dynasty-analysis-pilot-stats-import', schemaVersion: 1, mode: 'apply', status: 'applied_verified', passed: true, beforeRevision: 3, plannedAfterRevision: 4, targetCount: 2, changedFields: 4,
    batchSha256: contentHash(batch), beforeSha256: H('before'), plannedAfterSha256: H('after'), writeAttempted: true, writeSucceeded: true,
    writtenFieldHashes: batch.records.flatMap(item => ['stats', 'statsAnalysis'].map(field => ({ field, sha256: field === 'stats' ? contentHash(item.fields[field]) : sha256(item.fields[field]) }))),
    verification: { passed: true, targetsMatch: true, contentPreserved: true, revisionMatches: true, afterRevision: 4, afterSha256: H('after'), unaffectedBeforeSha256: H('unaffected'), unaffectedAfterSha256: H('unaffected') } };
  const deployment = { format: 'dynasty-stats-ui-deployment', schemaVersion: 1, passed: true, versionId: STATS_DEPLOYMENT_VERSION, origin: ORIGIN, httpStatus: 200, publishedHasStatsDetails: true, publishedMatchesRawSource: true, sourceRawSha256: H('frontend'), publishedSha256: H('frontend') };
  const expected = expectedStatsObservations(batch);
  const readEvidence = { method: 'browser_fetch_monitor', passed: true, monitorStartedBeforeOpen: true, aiRequests: 0, userdataPosts: 0 };
  const browser = { format: 'dynasty-stats-browser-verification', schemaVersion: 1, origin: ORIGIN, publishedVersionId: STATS_DEPLOYMENT_VERSION, publishedSourceMatches: true, productionImportVerified: true,
    status: complete ? 'verified' : 'awaiting_user_login', complete, newStatsPanelsVerified: complete, pendingReason: 'Synthetic pending login fixture',
    observations: complete ? expected.map(item => ({ ...item, passed: true, radarVisible: true, reasonSections: item.reasonSections.map(section => ({ ...section, headingVisible: true, bodyVisible: true, headMatched: true, tailMatched: true })), readEvidence: { ...readEvidence } })) : [],
    persistedReload: { method: 'fresh_sdk_document_read', passed: true, browserReloadPerformed: false, readAt: '2026-10-09T02:00:00Z', revision: 4, documentSha256: H('after'), records: expected.map(({ id, stats, statsAnalysisSha256 }) => ({ id, stats, statsAnalysisSha256 })) } };
  return { batch, audit, request, importReport, deployment, browser };
}
function rejected(mutations, complete = true) {
  for (const mutate of mutations) { const inputs = fixture(complete); mutate(inputs); assert.throws(() => validateStatsDelivery(inputs)); }
}
const files = materials => {
  const core = { 'stats-results.v1.json': materials.batch, 'stats-completion-audit.json': materials.audit, 'stats-request.v1.json': materials.request, 'stats-import-apply.json': materials.importReport, 'stats-deployment.json': materials.deployment, 'stats-browser-verification.json': materials.browser };
  return [...PUBLIC_EVIDENCE.map(path => ({ path: 'evidence/' + path, bytes: Buffer.from(core[path] ? JSON.stringify(core[path]) : 'Synthetic public evidence') })), ...PUBLIC_CODE.map(path => ({ path: 'code/' + path, bytes: Buffer.from('Synthetic public code') }))];
};
async function temporary(t) {
  const testRoot = dirname(fileURLToPath(import.meta.url));
  const directory = await mkdtemp(join(testRoot, 'dynasty-stats-delivery-test-'));
  t.after(async () => { const actual = await realpath(directory); assert.equal(dirname(actual).toLowerCase(), (await realpath(testRoot)).toLowerCase()); assert.ok(basename(actual).startsWith('dynasty-stats-delivery-test-')); await rm(actual, { recursive: true, force: true }); });
  return directory;
}

test('a complete delivery requires two exact observed panels and an explicit fresh SDK document read', () => {
  const result = validateStatsDelivery(fixture(true));
  assert.equal(result.browserComplete, true);
  assert.equal(result.persistedReadMethod, 'fresh_sdk_document_read');
  assert.equal(result.expected.length, 2);
});
test('pending login and verification progress remain pending, even when persisted document read already passed', () => {
  for (const status of ['awaiting_user_login', 'verification_in_progress']) { const inputs = fixture(); inputs.browser.status = status; assert.equal(validateStatsDelivery(inputs).browserComplete, false); }
  rejected([p => { p.browser.status = 'verified'; }, p => { p.browser.newStatsPanelsVerified = true; }, p => { p.browser.pendingReason = ''; }, p => { delete p.browser.complete; }], false);
});
test('empty, missing, duplicate or unrelated observations cannot declare completion', () => {
  rejected([p => { p.browser.observations = []; }, p => { p.browser.observations.pop(); }, p => { p.browser.observations[1] = structuredClone(p.browser.observations[0]); }, p => { p.browser.observations[0].id = WANG; }, p => { p.browser.observations[0].passed = false; }]);
});
test('request, apply and audit are pinned to this exact 3 to 4 import and two people/four fields', () => {
  rejected([p => { p.request.baselineRevision = 4; }, p => { p.importReport.beforeRevision = 2; }, p => { p.importReport.plannedAfterRevision = 5; }, p => { p.audit.beforeRevision = 8; p.audit.afterRevision = 9; }, p => { p.audit.afterRevision = '<script>bad</script>'; }, p => { p.importReport.changedFields = 5; }, p => { p.audit.targetCount = 3; }, p => { p.request.allowedIds.push(WANG); }, p => { p.importReport.status = 'planned'; }]);
});
test('batch, written fields, article input and deployment hashes must all match', () => {
  rejected([p => { p.audit.batchSha256 = H('wrong'); }, p => { p.importReport.batchSha256 = H('wrong'); }, p => { p.importReport.writtenFieldHashes[1].sha256 = H('wrong'); }, p => { p.request.records[0].promptSha256 = H('wrong'); }, p => { p.request.records[0].analysisSha256 = H('wrong'); }, p => { p.deployment.publishedSha256 = H('wrong'); }]);
});
test('all 962 identities, nine articles, ten userdata fields, Wang stats and raw CAS preservation are mandatory', () => {
  rejected([p => { p.audit.figureCount = 961; }, p => { p.audit.figureIdsPreserved = false; }, p => { p.audit.articles.pop(); }, p => { p.audit.articles[0].afterSha256 = H('changed'); }, p => { p.audit.articles[0] = structuredClone(p.audit.articles[1]); }, p => { delete p.audit.userdataFields.soulSaves; }, p => { p.audit.userdataFields.chatHistories.preserved = false; }, p => { p.audit.userdataFields.customLegends.afterRemovingAdditionsSha256 = H('changed'); }, p => { p.audit.wangJianStatsPreserved = false; }, p => { p.audit.rawExtrasPreserved = false; }, p => { p.audit.rawCasSucceeded = false; }, p => { p.audit.rawStoredDocumentMatchesExpected = false; }, p => { p.importReport.verification.contentPreserved = false; }]);
});
test('browser version, displayed scores, radar and all five ordered matching reasons are required', () => {
  rejected([p => { p.deployment.versionId = 'old-version'; }, p => { p.browser.publishedVersionId = 'old-version'; }, p => { p.browser.observations[0].stats[0]++; }, p => { p.browser.observations[0].radarVisible = false; }, p => { p.browser.observations[0].statsAnalysisSha256 = H('wrong'); }, p => { p.browser.observations[0].reasonSections.pop(); }, p => { p.browser.observations[0].reasonSections.reverse(); }, p => { p.browser.observations[0].reasonSections[0].score++; }, p => { p.browser.observations[0].reasonSections[0].sourceReasonSha256 = H('wrong'); }, p => { p.browser.observations[0].reasonSections[0].tailMatched = false; }, p => { p.browser.observations[0].reasonSections[0].bodyVisible = false; }]);
});
test('cached-read proof cannot come from static tests or include AI calls/userdata POSTs', () => {
  rejected([p => { delete p.browser.observations[0].readEvidence; }, p => { p.browser.observations[0].readEvidence.method = 'unit_tests'; }, p => { p.browser.observations[0].readEvidence.monitorStartedBeforeOpen = false; }, p => { p.browser.observations[0].readEvidence.aiRequests = 1; }, p => { p.browser.observations[0].readEvidence.userdataPosts = 1; }, p => { p.browser.observations[0].readEvidence.passed = false; }]);
});
test('fresh SDK proof must match saved scores/document and cannot claim browser reload', () => {
  rejected([p => { delete p.browser.persistedReload; }, p => { p.browser.persistedReload.documentSha256 = H('wrong'); }, p => { p.browser.persistedReload.revision = 3; }, p => { p.browser.persistedReload.readAt = '2026-10-08T00:00:00Z'; }, p => { p.browser.persistedReload.browserReloadPerformed = true; }, p => { p.browser.persistedReload.records[0].stats[0]++; }, p => { p.browser.persistedReload.records[0].statsAnalysisSha256 = H('wrong'); }]);
  const inputs = fixture(true);
  Object.assign(inputs.browser.persistedReload, { method: 'browser_reload', browserReloadPerformed: true, versionId: STATS_DEPLOYMENT_VERSION, readEvidence: { ...inputs.browser.observations[0].readEvidence } });
  assert.equal(validateStatsDelivery(inputs).persistedReadMethod, 'browser_reload');
});
test('failed gate does not create the output directory or write package files', async t => {
  const parent = await temporary(t), output = join(parent, 'never-created'), inputs = fixture(true);
  inputs.browser.observations = [];
  await assert.rejects(writeStatsDelivery(inputs, files(inputs), output, parent));
  await assert.rejects(stat(output), { code: 'ENOENT' });
  assert.deepEqual(await readdir(parent), []);
  const valid = fixture(), mismatch = files(valid);
  mismatch.find(item => item.path === 'evidence/stats-browser-verification.json').bytes = Buffer.from(JSON.stringify({ ...valid.browser, status: 'verified' }));
  await assert.rejects(writeStatsDelivery(valid, mismatch, output, parent), /packaged_evidence_differs/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});
test('pending package and manifest explicitly preserve pending state and distinguish SDK read from browser reload', async t => {
  const parent = await temporary(t), output = join(parent, 'pending-package'), inputs = fixture();
  const result = await writeStatsDelivery(inputs, files(inputs), output, parent);
  assert.equal(result.status, 'public_delivery_pending_browser');
  const html = await readFile(join(output, '總覽.html'), 'utf8'), manifest = JSON.parse(await readFile(join(output, 'public-manifest.json'), 'utf8'));
  assert.match(html, /新版畫面驗證尚未完成/);
  assert.match(html, /此證據不代表瀏覽器重新整理/);
  assert.doesNotMatch(html, /新版雷達圖、分數與五段理由已實際瀏覽驗證/);
  assert.equal(manifest.browserVerificationComplete, false);
  assert.equal(manifest.persistedReadMethod, 'fresh_sdk_document_read');
  for (const item of manifest.files) { const bytes = await readFile(resolve(output, item.path)); assert.equal(bytes.length, item.bytes); assert.equal(sha256(bytes), item.sha256); }
  await assert.rejects(writeStatsDelivery(inputs, files(inputs), output, parent), /delivery_output_exists/);
});
test('helper import has no main side effects and CLI accepts only a fresh public output flag', () => {
  const target = new URL('./build-stats-delivery.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(target)}); console.log('safe-import-only');`], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'safe-import-only');
  assert.equal(result.stderr, '');
  const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  assert.equal(parseStatsDeliveryArguments(['--output', join(workspace, 'synthetic-public-output')]).output, join(workspace, 'synthetic-public-output'));
  for (const args of [['--bad'], ['--output'], ['--output', workspace], ['--output', join(workspace, 'cloudflare/private/out')], ['--output', join(workspace, '../outside')]]) assert.throws(() => parseStatsDeliveryArguments(args));
});
