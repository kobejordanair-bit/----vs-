// Packages only completed, verified public artifacts. Never reads cloudflare/
// private, credentials, backups or production; never generates historical prose.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { strictJsonParse, USER_FIELDS } from '../cloudflare/src/contracts.mjs';
import { PilotError, contentHash, sha256, validateBatch } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_LAYERS, validateLayerBatch } from '../cloudflare/scripts/analysis-pilot-layers-import.mjs';
import { loadOriginalPromptMaterials, renderOriginalTemplate } from './original-prompt-renderer.mjs';

const pilotRoot = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(pilotRoot, '..');
const workspaceRoot = path.resolve(appRoot, '..');
const FIGURES = [
  { id: 'emperor_北魏孝文帝_33257620', slug: 'xiaowendi', name: '北魏孝文帝' },
  { id: 'general_王翦_306401394', slug: 'wangjian', name: '王翦' },
  { id: 'minister_姚崇_2003901767', slug: 'yaochong', name: '姚崇' },
];
const LABELS = { deepAnalysis: '校準評級', analysis: '人物賞析', soulEssence: '靈魂內核' };
const ORIGIN = 'https://dynasty.piamamba.com/play';
const bad = code => { throw new PilotError(code); };
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const blockedName = value => /(?:^|[._-])(?:private|secrets?|credentials?|tokens?|keys?|backup|backups|userdata|snapshot|bson)(?:[._-]|$)/i.test(value);
const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const link = value => value.split('/').map(encodeURIComponent).join('/');
const safeExternal = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? escape(url.href) : ''; } catch { return ''; } };

function publicPath(value) {
  const resolved = path.resolve(appRoot, value);
  if (!within(pilotRoot, resolved) || path.relative(pilotRoot, resolved).split(path.sep).some(blockedName)) bad('public_artifact_path_required');
  return resolved;
}
async function readPublic(value) {
  const resolved = publicPath(value), info = await fs.lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink()) bad('regular_public_artifact_required');
  return fs.readFile(resolved, 'utf8');
}
const readJson = async value => strictJsonParse(await readPublic(value));

export function validateCompleteAudit(audit, deep, layers) {
  if (audit?.format !== 'dynasty-complete-pilot-delivery-audit' || audit.schemaVersion !== 1 || audit.status !== 'complete_verified' || audit.passed !== true) bad('complete_delivery_audit_required');
  validateBatch(deep); validateLayerBatch(layers);
  const ids = FIGURES.map(figure => figure.id).sort();
  if (!isDeepStrictEqual(deep.records.map(record => record.id).sort(), ids) || !isDeepStrictEqual(layers.records.map(record => record.id).sort(), ids)) bad('delivery_target_mismatch');
  if (audit.authorization?.deepAnalysisAdditions !== 3 || audit.authorization.additionalLayerAdditions !== 5 || audit.authorization.totalAddedFields !== 8 || audit.authorization.existingWangJianAnalysisPreserved !== true) bad('complete_delivery_scope_mismatch');
  if (audit.revision?.passed !== true || audit.revision.after !== audit.revision.before + 2) bad('complete_delivery_revision_mismatch');
  if (audit.batchHashes?.deepBatchSha256 !== contentHash(deep) || audit.batchHashes.layersBatchSha256 !== contentHash(layers)) bad('delivery_batch_hash_mismatch');
  if (USER_FIELDS.some(field => audit.userdataFields?.[field]?.preserved !== true || audit.userdataFields[field].beforeSha256 !== audit.userdataFields[field].afterRemovingAllowedAdditionsSha256) || typeof audit.userdataHashes?.unaffectedBeforeSha256 !== 'string' || audit.userdataHashes.unaffectedBeforeSha256 !== audit.userdataHashes.unaffectedAfterSha256 || audit.histories?.preserved !== true) bad('complete_delivery_preservation_missing');
  if (!Number.isSafeInteger(audit.figures?.after?.uniqueIds) || audit.figures.after.uniqueIds < 3 || audit.figures.before?.uniqueIds !== audit.figures.after.uniqueIds || !isDeepStrictEqual(audit.histories.before, audit.histories.after) || typeof audit.worldworkspaces?.checked !== 'boolean') bad('delivery_inventory_missing');
  for (const [field, addition] of Object.entries({ deepAnalysis: 3, analysis: 2, soulEssence: 3 })) {
    const beforeCount = audit.figures.before[field]?.uniqueFigures, afterCount = audit.figures.after[field]?.uniqueFigures;
    if (!Number.isSafeInteger(beforeCount) || beforeCount < 0 || afterCount !== beforeCount + addition) bad('delivery_analysis_counts_mismatch');
  }
  for (const figure of FIGURES) {
    const record = layers.records.find(item => item.id === figure.id);
    if (!isDeepStrictEqual(Object.keys(record.fields).sort(), [...AUTHORIZED_LAYERS[figure.id]].sort())) bad('delivery_layer_count_mismatch');
    const row = audit.layers?.find(item => item.id === figure.id);
    for (const field of ['deepAnalysis', ...AUTHORIZED_LAYERS[figure.id]]) {
      const text = field === 'deepAnalysis' ? deep.records.find(item => item.id === figure.id).deepAnalysis : record.fields[field];
      if (!row?.additions?.some(item => item.field === field && item.sha256 === sha256(text) && item.utf16CodeUnits === text.length)) bad('delivery_layer_hash_mismatch');
    }
  }
  return audit;
}

async function verifiedManuscript({ figure, field, task, text, provenance }) {
  const raw = await readPublic(task.draftPath), capture = await readJson(task.capturePath), qa = await readJson(task.reviewPath);
  const sourcePath = `analysis-pilot/sources/${figure.slug}.md`, source = await readPublic(sourcePath);
  const marker = field === 'deepAnalysis' ? `<!-- PILOT_COMPLETE ${figure.id} -->` : `<!-- LAYER_COMPLETE ${figure.id} ${field} -->`;
  if (!raw.trimEnd().endsWith(marker) || raw.trimEnd().slice(0, -marker.length).trimEnd() !== text) bad('delivery_manuscript_mismatch');
  if (capture.responseSha256 !== sha256(raw) || capture.promptSha256 !== task.promptSha256 || sha256(task.prompt) !== task.promptSha256) bad('delivery_capture_mismatch');
  if (qa.passed !== true || qa.manuscriptSha256 !== sha256(raw) || qa.sourcePackageSha256 !== sha256(source)) bad('delivery_source_review_missing_or_stale');
  if (capture.webSearchVerified !== true && capture.webSearchPerformed !== true) bad('delivery_web_search_evidence_missing');
  const qaExternal = Array.isArray(qa.checkedExternalSources) ? qa.checkedExternalSources : [];
  const checkedSources = [...(provenance.checkedSources || []), ...qaExternal].filter((item, index, all) => all.findIndex(other => other.url === item.url) === index);
  return { figure, field, text, newArticle: true, capture, qa, checkedSources, task, sourcePath };
}

async function testsSummary() {
  const names = ['importer-tests.log', 'layers-importer-tests.log', 'review-cache-verification.log', 'complete-verification-helper-tests.log', 'helpers-tests.log', 'delivery-helper-tests.log'];
  const rows = [];
  for (const name of names) {
    const text = await readPublic(`analysis-pilot/${name}`);
    const tests = text.match(/(?:^|\n)[^\n]*?\btests\s+(\d+)\s*(?:\r?\n|$)/)?.[1];
    const passed = text.match(/(?:^|\n)[^\n]*?\bpass\s+(\d+)\s*(?:\r?\n|$)/)?.[1];
    const failed = text.match(/(?:^|\n)[^\n]*?\bfail\s+(\d+)\s*(?:\r?\n|$)/)?.[1];
    if (tests === undefined || passed !== tests || failed !== '0') bad('delivery_test_log_not_passing');
    rows.push({ name, tests: Number(tests), passed: Number(passed), failed: 0, sha256: sha256(text) });
  }
  return rows;
}

export async function collectDelivery(args) {
  const audit = await readJson(args.audit), deep = await readJson(args.deepResults), layers = await readJson(args.layerResults);
  validateCompleteAudit(audit, deep, layers);
  const deepRequest = await readJson(args.deepRequest), layerRequest = await readJson(args.layerRequest), original = await readJson('analysis-pilot/original-prompts.v1.json');
  const deployment = await readJson('analysis-pilot/ui-deployment.json');
  if (deployment.origin !== new URL(ORIGIN).origin || typeof deployment.versionId !== 'string' || deployment.focusedReviewTestsPassed !== 3 || deployment.websiteDataWritePerformedByDeployment !== false) bad('delivery_ui_deployment_record_missing');
  if (original.format !== 'dynasty-original-analysis-prompts' || original.verification?.requiredOriginalSectionsPresent !== true || original.verification.originalTemplateSyntaxValid !== true) bad('delivery_original_prompts_missing');
  if (deepRequest.policy?.originalPromptPreserved !== true || deepRequest.policy.existingStyleSamplesUsed !== true || deepRequest.policy.actualWebSearchRequired !== true || layerRequest.policy?.reuseOriginalPrompts !== true || layerRequest.policy.preserveExistingWritingStyle !== true || layerRequest.policy.webSearchRequired !== true) bad('delivery_prompt_style_policy_missing');
  const materials = await loadOriginalPromptMaterials();
  const checkOriginal = (task, field, context, sourceBlock = '') => {
    const template = materials.original.templates[field === 'deepAnalysis' ? 'deepCalibration' : field];
    const rendered = renderOriginalTemplate(template, { legend: context, rankingRef: materials.rankingRef, sourceBlock });
    const style = materials.styles[`${context.type}.${field}`];
    if (task.originalTemplateSha256 !== template.templateSha256 || task.renderedOriginalSha256 !== sha256(rendered) || !task.prompt.startsWith(rendered) || !style || task.styleSamplePath !== style.path || task.styleSampleSha256 !== style.sha256 || !task.prompt.includes(style.text)) bad('delivery_original_prompt_or_style_changed');
  };
  const articles = [];
  for (const figure of FIGURES) {
    const deepRecord = deep.records.find(item => item.id === figure.id), request = deepRequest.records?.find(item => item.id === figure.id);
    if (!request || request.slug !== figure.slug || request.promptSha256 !== deepRecord.promptSha256 || deepRecord.provenance.originalWebsitePromptPreserved !== true || deepRecord.provenance.existingWritingStyleUsed !== true || deepRecord.provenance.webSearchVerified !== true) bad('delivery_deep_request_mismatch');
    checkOriginal(request, 'deepAnalysis', request.context);
    articles.push(await verifiedManuscript({ figure, field: 'deepAnalysis', task: request, text: deepRecord.deepAnalysis, provenance: deepRecord.provenance }));
    const layerRecord = layers.records.find(item => item.id === figure.id), layerTask = layerRequest.records?.find(item => item.id === figure.id);
    if (!layerTask || layerTask.promptSha256 !== layerRecord.promptSha256) bad('delivery_layer_request_mismatch');
    for (const field of AUTHORIZED_LAYERS[figure.id]) {
      const task = layerTask.layers?.[field];
      if (!task) bad('delivery_layer_task_missing');
      const sourceCtx = `${field === 'soulEssence' ? `【賞析】\n請透過工作區外掛讀取完整歷史賞析稿：${task.contextPaths?.[0]?.path}\n\n` : ''}【深度評鑑】\n${layerTask.deepAnalysis.text.slice(0, 2000)}\n\n`;
      const sourceBlock = field === 'soulEssence' ? renderOriginalTemplate(materials.original.templates.soulEssence.sourceBlockTemplates.withContext, { legend: layerTask.context, sourceCtx }) : '';
      checkOriginal(task, field, layerTask.context, sourceBlock);
      articles.push(await verifiedManuscript({ figure, field, task, text: layerRecord.fields[field], provenance: layerRecord.provenance }));
    }
    if (figure.slug === 'wangjian') {
      const text = await readPublic('analysis-pilot/drafts/wangjian.existing.analysis.md');
      if (layerTask.preservedAnalysis?.action !== 'preserve_exactly' || layerTask.preservedAnalysis.sha256 !== sha256(text)) bad('delivery_existing_analysis_mismatch');
      articles.push({ figure, field: 'analysis', text, newArticle: false, capture: null, qa: null, checkedSources: [] });
    }
  }
  if (articles.length !== 9 || articles.filter(item => item.newArticle).length !== 8) bad('complete_eight_manuscripts_required');
  return { audit, articles, tests: await testsSummary() };
}

function inline(text) {
  const escaped = escape(text);
  return escaped.replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g, (whole, label, url) => { const href = safeExternal(url.replace(/&amp;/g, '&')); return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : whole; })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}
export function markdownToHtml(text) {
  const output = [], paragraph = [];
  const flush = () => { if (paragraph.length) { output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph.length = 0; } };
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flush(); const level = Math.min(heading[1].length + 1, 6); output.push(`<h${level}>${inline(heading[2])}</h${level}>`); }
    else if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flush(); output.push('<hr>'); }
    else if (/^>\s?/.test(line)) { flush(); output.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); }
    else paragraph.push(line);
  }
  flush(); return output.join('\n');
}

const CSS = `:root{color-scheme:light;--ink:#21323a;--paper:#f7f4ed;--gold:#a7833e;--line:#d9d4c8}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.8 "Segoe UI","Microsoft JhengHei",sans-serif}main{max-width:1120px;margin:auto;padding:54px 28px 70px}header{padding:22px 0 28px;border-bottom:3px solid var(--gold)}.eyebrow{color:#795c2b;font-size:13px;letter-spacing:.15em}h1{font:600 38px/1.35 "Noto Serif TC","PMingLiU",serif;margin:14px 0 20px}h2{font-size:24px;margin-top:36px}h3{font-size:20px}a{color:#425f7b;text-underline-offset:4px}p{margin:12px 0}.muted{color:#657177}.button{display:inline-block;padding:10px 18px;border:1px solid var(--gold);border-radius:8px;text-decoration:none;color:#684f23;background:#fffdf8}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:26px 0}.card{background:#fffdfa;border:1px solid var(--line);border-radius:12px;padding:20px}.number{display:block;font-size:30px;font-weight:600}.badge{display:inline-block;font-size:12px;line-height:1.5;padding:4px 8px;border-radius:5px;background:#e8efe9;color:#31583b}.existing{background:#f0e8d8;color:#715c38}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;background:#fffdfa}th,td{padding:16px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{background:#ece6d8;font-weight:600}.small{font-size:13px}details{background:#fffdfa;border:1px solid var(--line);border-radius:8px;padding:14px 18px;margin:18px 0}summary{cursor:pointer;font-weight:600}.manuscript{font-family:"Noto Serif TC","PMingLiU",serif;font-size:18px;overflow-wrap:anywhere;line-height:1.95}.manuscript p{margin:22px 0}.manuscript h2,.manuscript h3{font-family:inherit;line-height:1.5}.manuscript blockquote{margin:20px 0;padding:10px 20px;border-left:3px solid var(--gold);background:#f0ece2}.hash{font-family:Consolas,monospace;overflow-wrap:anywhere;font-size:12px}footer{border-top:1px solid var(--line);margin-top:40px;padding-top:22px;color:#657177;font-size:13px}@media(max-width:680px){main{padding:28px 18px}h1{font-size:30px}.stats{grid-template-columns:repeat(2,1fr)}th,td{padding:12px}.manuscript{font-size:17px}}`;
function page(title, body) { return `<!doctype html>\n<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>\n`; }

function articlePage(article) {
  const status = article.newArticle ? '<span class="badge">ChatGPT 網頁新稿 · 已查核並匯入</span>' : '<span class="badge existing">網站既有賞析 · 全文保留</span>';
  const sources = article.checkedSources.map(item => { const href = safeExternal(item.url); return `<li>${href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${escape(item.title)}</a>` : escape(item.title)}<p class="small muted">${escape(item.locator)}</p></li>`; }).join('');
  const evidence = article.newArticle ? `<details><summary>原 PROMPT、網搜與查證紀錄</summary><ul><li><a href="../${link(article.task.capturePath)}">ChatGPT 原始擷取紀錄</a></li><li><a href="../${link(article.task.reviewPath)}">本篇史料查證報告</a></li><li><a href="../${link(article.sourcePath)}">原典史料包</a></li><li><a href="../analysis-pilot/original-prompts.v1.json">網站原 PROMPT 三套完整模板</a></li><li>實際網搜：擷取紀錄已標示執行；正文與來源的 SHA 對應已核對。</li></ul>${sources ? `<h3>本篇核查來源</h3><ul>${sources}</ul>` : ''}${article.qa.caveats?.length ? `<h3>查證範圍</h3><ul>${article.qa.caveats.map(value => `<li>${escape(value)}</li>`).join('')}</ul>` : ''}</details>` : '<p class="small muted">本頁為網站既有賞析，交付核對確認原文雜湊與網站保存內容一致。</p>';
  return page(`${article.figure.name}・${LABELS[article.field]}`, `<nav><a href="../總覽.html">← 返回完整交付總覽</a></nav><header><div class="eyebrow">王侯將相 · 人物資料完整試跑</div><h1>${escape(article.figure.name)}<br>${escape(LABELS[article.field])}</h1>${status}<p class="small muted">${[...article.text].length.toLocaleString('zh-TW')} 字元</p></header><article class="manuscript">${markdownToHtml(article.text)}</article>${evidence}<footer>本文呈現已保存的原文章內容，版面轉換未補寫歷史正文。SHA-256：<span class="hash">${sha256(article.text)}</span></footer>`);
}

function overview({ audit, articles, tests }) {
  const count = audit.figures.after, before = audit.figures.before, history = audit.histories.after;
  const table = FIGURES.map(figure => `<tr><th scope="row">${escape(figure.name)}</th>${Object.keys(LABELS).map(field => { const article = articles.find(item => item.figure.id === figure.id && item.field === field); return `<td><a href="articles/${figure.slug}.${field}.html">${LABELS[field]}</a><br><span class="badge ${article.newArticle ? '' : 'existing'}">${article.newArticle ? '已新增並匯入' : '原賞析完整保留'}</span><br><span class="small muted">${[...article.text].length.toLocaleString('zh-TW')} 字元</span></td>`; }).join('')}</tr>`).join('');
  const testsTable = tests.map(test => `<tr><td><a href="analysis-pilot/${link(test.name)}">${escape(test.name)}</a></td><td>${test.passed} / ${test.tests}</td><td>0</td></tr>`).join('');
  const world = audit.worldworkspaces.checked ? '僅核對兩份提供的 worldworkspaces 快照，結果一致。' : '本次未提供完整的兩份世界資料快照，交付驗證未宣稱核查世界資料。';
  return page('王侯將相・人物分析完整試跑交付', `<header><div class="eyebrow">ChatGPT 網頁生成 · 原 PROMPT · 史料查證 · 網站資料核對</div><h1>三位人物，三套完整功能</h1><p>本次新增 3 篇校準評級、2 篇人物賞析、3 篇靈魂內核，共 8 篇新稿。王翦既有賞析全文保留，九個人物功能頁面可由下表閱讀。</p><a class="button" href="${ORIGIN}" target="_blank" rel="noopener noreferrer">開啟王侯將相網站</a><p class="small muted">在網站搜尋人物，開啟「評鑑」，切換賞析、校準與靈魂內核即可閱讀已保存內容。</p></header><section class="stats" aria-label="目前網站資料計數"><div class="card"><span class="number">${count.uniqueIds}</span>人物總數</div><div class="card"><span class="number">${count.deepAnalysis.uniqueFigures}</span>已有校準</div><div class="card"><span class="number">${count.analysis.uniqueFigures}</span>已有賞析</div><div class="card"><span class="number">${count.soulEssence.uniqueFigures}</span>已有靈魂內核</div></section><h2>三人 × 三個功能</h2><div class="table-wrap"><table><thead><tr><th>人物</th><th>校準評級</th><th>人物賞析</th><th>靈魂內核</th></tr></thead><tbody>${table}</tbody></table></div><h2>網站整合與資料保全</h2><div class="card"><p>最終 userdata revision ${audit.revision.before} → ${audit.revision.after}，兩次寫入合計只增加指定的 8 個文章欄位。10 個既有資料欄位及其餘可見欄位經逐欄位深度比對；其餘人物、既有賞析、評級與五維均保留。</p><p>模擬紀錄 ${history.simulations} 筆、魂穿存檔 ${history.soulSavedGames} 份／${history.soulSavedChapters} 章、人物聊天 ${history.chatMessages} 則、評鑑討論 ${history.discussionMessages} 則，內容比對保留。</p><p>${world}</p><p><a href="analysis-pilot/complete-delivery-audit.json">完整最終核對報告</a> · <a href="analysis-pilot/ui-deployment.json">賞析快取介面修正部署紀錄</a></p><p class="small muted">原本 ${before.uniqueIds} 位人物；本次人物總數維持 ${count.uniqueIds}。已有賞析但缺五維時直接顯示原文，生成五維由明確的 AI 按鈕觸發。</p></div><h2>原 PROMPT、文風與真實來源</h2><p>三套網站原 PROMPT 完整保留；實際人物提示與既有文風例文一併保存。每篇新稿的 ChatGPT 擷取紀錄、完成標記、網搜執行記錄、原典來源、查證報告與最終批次雜湊相互核對。</p><ul><li><a href="analysis-pilot/original-prompts.v1.json">原網站校準、賞析、內核三套 PROMPT</a></li><li><a href="analysis-pilot/request.style.v2.json">三篇校準的實際任務與提示</a></li><li><a href="analysis-pilot/layer-request.v1.json">賞析與內核五篇的實際任務與提示</a></li><li><a href="analysis-pilot/style-samples.v1.json">各功能既有文風例文索引</a></li><li><a href="analysis-pilot/results.v1.json">校準匯入批次</a> · <a href="analysis-pilot/layer-results.v1.json">賞析與內核匯入批次</a></li></ul><h2>測試紀錄</h2><div class="table-wrap"><table><thead><tr><th>紀錄</th><th>通過／總數</th><th>失敗</th></tr></thead><tbody>${testsTable}</tbody></table></div><details><summary>交付檔案與重現工具</summary><p><a href="public-artifact-manifest.json">公開成果檔案清單與 SHA-256</a>。analysis-pilot 完整公開材料與相應程式、測試已複製至本資料夾；排除密鑰、私人快照與備份。</p><ul><li><a href="analysis-pilot/verify-complete-pilot.mjs">兩階段完整資料核對 helper</a></li><li><a href="analysis-pilot/build-delivery.mjs">本交付整理 helper</a></li><li><a href="cloudflare/scripts/analysis-pilot-import.mjs">校準安全匯入工具</a></li><li><a href="cloudflare/scripts/analysis-pilot-layers-import.mjs">賞析／內核安全匯入工具</a></li><li><a href="cloudflare/tests/analysis-review-cache.test.mjs">賞析快取回歸測試</a></li></ul></details><footer>交付驗證時間：${escape(audit.verifiedAt)}。本資料夾為公開技術成果與人物文章；私人原始備份另行保管。</footer>`);
}

async function publicFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (blockedName(entry.name) || entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name, full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await publicFiles(full, relative));
    else if (entry.isFile() && /\.(?:json|md|txt|log|mjs|html|css|png|jpe?g|webp)$/i.test(entry.name)) files.push({ source: full, relative: `analysis-pilot/${relative}` });
  }
  return files;
}
const TECHNICAL_FILES = [
  'backend/index.html', 'backend/static/data/legends.js',
  'cloudflare/src/contracts.mjs', 'cloudflare/src/d1-store.mjs',
  'cloudflare/scripts/audit-counts.mjs', 'cloudflare/scripts/analysis-pilot-import.mjs', 'cloudflare/scripts/analysis-pilot-layers-import.mjs', 'cloudflare/scripts/stage-original-analysis-prompts.mjs',
  'cloudflare/tests/analysis-pilot-import.test.mjs', 'cloudflare/tests/analysis-pilot-layers-import.test.mjs', 'cloudflare/tests/analysis-review-cache.test.mjs', 'cloudflare/tests/analysis-pilot-helpers.test.mjs', 'cloudflare/tests/complete-pilot-verification.test.mjs', 'cloudflare/tests/analysis-pilot-delivery.test.mjs',
];

export function parseDeliveryArguments(values) {
  const args = { audit: 'analysis-pilot/complete-delivery-audit.json', deepResults: 'analysis-pilot/results.v1.json', layerResults: 'analysis-pilot/layer-results.v1.json', deepRequest: 'analysis-pilot/request.style.v2.json', layerRequest: 'analysis-pilot/layer-request.v1.json', output: path.join(workspaceRoot, '人物分析ChatGPT試跑_2026-10-09', '完整交付') };
  const options = { '--audit': 'audit', '--deep-results': 'deepResults', '--layer-results': 'layerResults', '--deep-request': 'deepRequest', '--layer-request': 'layerRequest', '--output': 'output' }, seen = new Set();
  for (let index = 0; index < values.length; index++) {
    const key = options[values[index]];
    if (!key || seen.has(key) || !values[index + 1] || values[index + 1].startsWith('--')) bad('invalid_delivery_arguments');
    seen.add(key); args[key] = values[++index];
  }
  args.output = path.resolve(args.output);
  if (!within(workspaceRoot, args.output) || within(appRoot, args.output) || args.output === workspaceRoot) bad('delivery_output_outside_workspace');
  for (const key of ['audit', 'deepResults', 'layerResults', 'deepRequest', 'layerRequest']) publicPath(args[key]);
  return args;
}

export async function main(values = process.argv.slice(2)) {
  try {
    const args = parseDeliveryArguments(values), delivery = await collectDelivery(args);
    // No output directory or completion report is created before all gates pass.
    const files = [...await publicFiles(pilotRoot), ...TECHNICAL_FILES.map(relative => ({ source: path.resolve(appRoot, relative), relative }))];
    const prepared = [];
    for (const file of files) {
      const info = await fs.lstat(file.source);
      if (!info.isFile() || info.isSymbolicLink()) bad('invalid_technical_source');
      const bytes = await fs.readFile(file.source); prepared.push({ ...file, bytes, sha256: sha256(bytes) });
    }
    const outputs = new Map(prepared.map(file => [file.relative, file.bytes]));
    // Normalize the requested artifact aliases used by the local HTML links.
    for (const [key, name] of Object.entries({ audit: 'complete-delivery-audit.json', deepResults: 'results.v1.json', layerResults: 'layer-results.v1.json', deepRequest: 'request.style.v2.json', layerRequest: 'layer-request.v1.json' })) {
      outputs.set(`analysis-pilot/${name}`, await fs.readFile(publicPath(args[key])));
    }
    for (const article of delivery.articles) outputs.set(`articles/${article.figure.slug}.${article.field}.html`, Buffer.from(articlePage(article)));
    outputs.set('總覽.html', Buffer.from(overview(delivery)));
    const manifest = { format: 'dynasty-public-pilot-delivery-manifest', schemaVersion: 1, createdAt: new Date().toISOString(), newManuscripts: 8, personFunctionPages: 9, files: [...outputs].map(([relative, bytes]) => ({ path: relative, bytes: bytes.length, sha256: sha256(bytes) })), excludedCategories: ['credentials', 'keys', 'private snapshots', 'backups', 'symlinks'] };
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    await fs.mkdir(args.output, { recursive: false });
    for (const [relative, bytes] of outputs) { const target = path.join(args.output, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes, { flag: 'wx' }); }
    await fs.writeFile(path.join(args.output, 'public-artifact-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await fs.writeFile(path.join(args.output, 'delivery-status.json'), JSON.stringify({ status: 'complete_delivered', passed: true, newManuscripts: 8, personFunctionPages: 9, auditSha256: contentHash(delivery.audit), manifestSha256: contentHash(manifest) }, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: 'complete_delivered', passed: true, newManuscripts: 8, pages: 9, publicFiles: prepared.length, output: args.output })); return 0;
  } catch (error) { console.error(JSON.stringify({ status: error instanceof PilotError ? error.code : error.code === 'ENOENT' ? 'required_public_artifact_missing' : error.code === 'EEXIST' ? 'delivery_output_exists' : 'delivery_build_failed', passed: false })); return 1; }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
