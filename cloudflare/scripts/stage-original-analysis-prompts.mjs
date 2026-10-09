// Read-only extraction of the website's prompt templates. This script never
// reads userdata, conversations, credentials or generated character articles.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const frontendUrl = new URL('../../backend/index.html', import.meta.url);
const outputUrl = new URL('../../analysis-pilot/original-prompts.v1.json', import.meta.url);
const source = await fs.readFile(frontendUrl, 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const lineAt = offset => source.slice(0, offset).split('\n').length;

function template(functionName, declaration) {
  const functionOffset = source.indexOf(`async function ${functionName}(`);
  assert.ok(functionOffset >= 0, `${functionName} exists`);
  const declarationOffset = source.indexOf(declaration, functionOffset);
  assert.ok(declarationOffset >= functionOffset, `${declaration} exists`);
  const start = source.indexOf('`', declarationOffset);
  let end = start + 1;
  while (end < source.length) {
    if (source[end] === '\\') { end += 2; continue; }
    if (source[end] === '`') break;
    end++;
  }
  assert.ok(end < source.length, 'template closes');
  const rawTemplateLiteral = source.slice(start, end + 1);
  // Compiling an uncalled arrow checks the original JS template syntax without
  // resolving or executing any interpolation against the running app.
  new vm.Script(`() => (${rawTemplateLiteral})`);
  return {
    function: functionName,
    sourceLineStart: lineAt(start),
    sourceLineEnd: lineAt(end),
    rawTemplateLiteral,
    templateSha256: sha256(rawTemplateLiteral),
  };
}

const deepCalibration = {
  ...template('_loadCalibrationContent', 'const prompt = `'),
  outputField: 'deepAnalysis',
  interpolations: {
    rankingRef: '原網站的【現有人物評級參考表】；staticLegendsData 與 customLegends 合併，以 modifiedLegends.rank 優先，格式為「姓名(評級)」並以頓號串接。此檔只保存模板，不填入人物資料。',
    typeLabel: "legend.type === 'emperor' ? '帝王' : legend.type === 'general' ? '將領' : '名臣'",
    'legend.name': '當前人物姓名',
    'legend.rank': '當前人物現有評級',
    'legend.title': '當前人物稱號',
    'legend.tag': '當前人物標籤',
    'legend.desc': '當前人物簡評',
    'legend.poem': '當前人物判詞',
  },
};
const analysis = {
  ...template('_loadReviewContent', 'let prompt = `'),
  outputField: 'analysis',
  interpolations: {
    'legend.name': '當前人物姓名',
    'legend.title': '當前人物稱號',
    'legend.type': '角色本位條件式完整保留在原模板中：emperor 對應帝王，general 對應將領，其餘對應臣子。',
  },
  conditionalStatsAppend: {
    ...template('_loadReviewContent', 'prompt += `'),
    condition: 'needsStats = forceRegen || !cachedStats；僅在此條件成立時把以下原模板附加到賞析模板。',
    outputField: 'stats（五維 JSON 由網站原函式擷取，並從 analysis 文章移除）',
  },
};
const soulEssence = {
  ...template('_generateSoulEssence', 'const prompt = `'),
  outputField: 'soulEssence',
  interpolations: {
    sourceBlock: '原函式先組成的人物背景區塊；以下保留有背景、無背景的原模板。此檔不填入任何人物文章、聊天內容或私有資料。',
  },
  sourceBlockTemplates: {
    withContext: {
      ...template('_generateSoulEssence', '? `以下是關於'),
      interpolations: {
        'legend.name': '當前人物姓名',
        "legend.title||''": '當前人物稱號，空值轉空字串',
        "legend.dynasty||''": '當前人物朝代，空值轉空字串',
        sourceCtx: '執行時傳入的背景文字；本檔不含其值。',
      },
    },
    withoutContext: {
      ...template('_generateSoulEssence', ': `歷史人物'),
      interpolations: {
        'legend.name': '當前人物姓名',
        "legend.title||''": '當前人物稱號，空值轉空字串',
        "legend.dynasty||''": '當前人物朝代，空值轉空字串',
      },
    },
  },
};

for (const text of ['【核心史觀】', '【三大維度評分邏輯】', '【多重身份隔離法則】', '第一步【榜單錨定】', '第二步【獨立史學剖析】', '第三步【縱向標定與雙向防線】', '第四步【全榜邏輯一致性校準】', '【建議定案】']) assert.ok(deepCalibration.rawTemplateLiteral.includes(text));
for (const text of ['【分析準則】', '**角色本位**', '【歷史局勢與定位】', '【深度功過剖析】', '【人性與性格側寫】', '【如果生在現代】']) assert.ok(analysis.rawTemplateLiteral.includes(text));
for (const text of ['[史載]', '[推斷]', '[詮釋]', '【說話邏輯】', '【壓力反應】', '【核心驅動】', '【慣性盲點】', '【情感結構】', '【參照系】', '【內在裂縫】', '只輸出以上七個欄位']) assert.ok(soulEssence.rawTemplateLiteral.includes(text));

const result = {
  format: 'dynasty-original-analysis-prompts',
  schemaVersion: 1,
  extractedAt: new Date().toISOString(),
  source: { path: 'backend/index.html', sha256: sha256(source) },
  extraction: '逐字擷取原 JavaScript template literal（保留反引號、插值表達式、換行及跳脫字元）；未執行模板、未填入任何資料、未改写文風。',
  templates: { deepCalibration, analysis, soulEssence },
  verification: { originalTemplateSyntaxValid: true, requiredOriginalSectionsPresent: true, userdataRead: false, websiteSourceModified: false },
};
await fs.mkdir(new URL('../../analysis-pilot/', import.meta.url), { recursive: true });
await fs.writeFile(outputUrl, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ path: fileURLToPath(outputUrl), source: result.source, templateLocations: Object.fromEntries(Object.entries(result.templates).map(([key, value]) => [key, { function: value.function, sourceLineStart: value.sourceLineStart, sourceLineEnd: value.sourceLineEnd, sha256: value.templateSha256 }])), verification: result.verification }, null, 2));
