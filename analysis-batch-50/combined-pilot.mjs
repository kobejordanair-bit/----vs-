// One actual ChatGPT response, split mechanically into the existing two tasks.
// Original frozen prompts stay intact. No historical text or scores are authored.
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { loadFixedManifest } from './import.mjs';
import { validateRequest, normalizeBatchExport, parseManuscript } from './capture.mjs';
import { verifyOriginalPromptBinding } from './prompt-bindings.mjs';

const fail = code => { throw Error(code); };
export function splitCombined(raw, id) {
  const normalized = normalizeBatchExport(raw).text.replace(/^\\(<!-- BATCH50_COMPLETE [^\s<>]+ analysisStats -->)$/gm, '$1');
  const analysisMarker = `<!-- BATCH50_COMPLETE ${id} analysisStats -->`;
  const soulMarker = `<!-- BATCH50_COMPLETE ${id} soulEssence -->`;
  const lines = normalized.trimEnd().split('\n');
  const cuts = lines.flatMap((line, i) => line.trim() === analysisMarker ? [i] : []);
  if (cuts.length !== 1 || lines.at(-1).trim() !== soulMarker) fail('combined_incomplete');
  const analysisRaw = lines.slice(0, cuts[0] + 1).join('\n') + '\n';
  const soulRaw = lines.slice(cuts[0] + 1).join('\n').trim() + '\n';
  const analysisFields = parseManuscript(analysisRaw, id, 'analysisStats');
  const soulFields = parseManuscript(soulRaw, id, 'soulEssence');
  return { normalized, analysisRaw, soulRaw, analysisFields, soulFields };
}

async function writeNew(path, value) {
  try { await lstat(path); fail('combined_output_exists'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await writeFile(path, value, { flag: 'wx' });
}

async function compile(slug) {
  const manifest = await loadFixedManifest();
  const request = JSON.parse(await readFile(`analysis-batch-50/tasks/${slug}.json`, 'utf8'));
  const target = validateRequest(manifest, request);
  const [analysis, soul, deep, sources, reference] = await Promise.all([
    readFile(request.tasks.analysisStats.promptFile, 'utf8'),
    readFile(request.tasks.soulEssence.promptFile, 'utf8'),
    readFile(target.preserved.deepAnalysis.path, 'utf8'),
    readFile(target.sourcesPath, 'utf8'),
    readFile(request.tasks.analysisStats.referencePath, 'utf8'),
  ]);
  for (const [task, prompt] of [['analysisStats', analysis], ['soulEssence', soul]]) {
    verifyOriginalPromptBinding({ target, request, task, prompt, deepAnalysis: deep, sourcePackage: sources });
    if (sha256(prompt) !== request.tasks[task].promptSha256) fail('frozen_prompt_changed');
  }
  if (sha256(reference) !== request.tasks.analysisStats.referenceSha256) fail('reference_changed');
  const sourceOccurrences = soul.split(sources).length - 1;
  if (sourceOccurrences !== 1 || !soul.includes(deep.slice(0, 2000))) fail('dedup_context_not_found');
  const replacements = [
    [sources, '來源包已完整列於上方賞析任務；沿用同一份，不重讀。'],
    [deep.slice(0, 2000), '完整原深度評鑑已列於上方賞析任務；沿用同一份，不重讀。'],
    [`請先完整讀取本人物已完成、查核後的賞析：analysis-batch-50/drafts/${slug}.analysis.md`, '使用本回應上文剛完成的賞析，兩層輸出後由 Codex 一起查核。'],
    [`請先透過工作區連接完整讀取上面本人物賞析，以及 ${target.preserved.deepAnalysis.path} 的完整深度評鑑，不能只用上面2000字節錄；賞析尚未完成時請等待，不要用其他人的文章或聊天替代。`, '使用上文完整原深度評鑑及本回應剛寫完的賞析；本試跑不等待尚不存在的分拆文章檔案，不用其他人的文章代替。'],
  ];
  let deduplicatedSoul = soul;
  for (const [from, to] of replacements) {
    if (!deduplicatedSoul.includes(from)) fail('expected_transport_instruction_missing');
    deduplicatedSoul = deduplicatedSoul.replace(from, to);
  }
  const referenceInstruction = `請完整讀取 ${request.tasks.analysisStats.referencePath} 既有66人的五維`;
  if (!analysis.includes(referenceInstruction)) fail('reference_instruction_missing');
  const compiledAnalysis = analysis.replace(referenceInstruction, '使用本資料包末尾完整附錄的既有66人五維');
  const packet = `【單人合併試跑｜${target.name}】\n以下保留賞析與靈魂內核的原PROMPT、文風範例及完整資料。僅共用背景資料與改成同回應串接，不修改分析準則。先完整寫賞析和五維，輸出其完成標記；緊接完整寫七欄靈魂內核，輸出其完成標記。一個回應完成兩部分，兩者一起查核。來源搜尋共用一次；請實際搜尋並打開原典／官方／學術來源，不把舊評鑑的推論當成新史實。維持有力、具體、人物不可替換的論述，不反覆寫通用保守聲明。正文引用可點擊的來源；不用另外列重複來源清單或工作進度。\n\n【A｜賞析與五維原PROMPT】\n${compiledAnalysis}\n\n【B｜靈魂內核原PROMPT；僅共用資料與串接方式調整】\n${deduplicatedSoul}\n\n【共用完整五維校準附錄】\n${reference}\n\n【最後執行提醒】\n第一行必須是stats JSON；賞析完整四章後加STATS_REASONS_BEGIN，再完整第五章五維理由，接analysisStats完成標記。緊接七欄內核，最後是soulEssence完成標記。兩個完成標記均獨立成行。不要讀其他工作檔、不等待drafts/${slug}.analysis.md；直接以本包及實際上網資料完成這一人。\n`;
  const proof = {
    format: 'dynasty-combined-person-prompt', schemaVersion: 1, slug, recordId: target.id,
    manifestSha256: contentHash(manifest), requestSha256: contentHash(request),
    originalPromptHashes: Object.fromEntries(['analysisStats','soulEssence'].map(t=>[t,request.tasks[t].promptSha256])),
    sharedSourcesSha256: sha256(sources), sharedDeepSha256: sha256(deep), referenceSha256: sha256(reference),
    originalPromptBodiesUnchangedOnDisk: true,
    transportAdjustments: ['shared source packet once','full preserved deep context once instead of duplicated excerpt','same-response appraisal context','embedded shared benchmark once'],
    previousTwoPromptCharacters: analysis.length+soul.length,
    previousBenchmarkReadCharacters: reference.length,
    comparisonScope: 'Two original task prompts plus one benchmark read; excludes the old additional deep/source/appraisal rereads and task metadata.',
    compiledPacketCharacters: packet.length, packetSha256: sha256(packet),
    packetFile: `analysis-batch-50/prompts/${slug}.combined.prompt.md`, compiledAt: new Date().toISOString(),
  };
  await writeNew(proof.packetFile, packet);
  await writeNew(`analysis-batch-50/tasks/${slug}.combined.json`, JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({status:'compiled',slug,characters:packet.length,previous:analysis.length+soul.length+reference.length,packetSha256:proof.packetSha256}));
}

async function split(slug, conversationUrl) {
  const request=JSON.parse(await readFile(`analysis-batch-50/tasks/${slug}.json`,'utf8'));
  const promptProof=JSON.parse(await readFile(`analysis-batch-50/tasks/${slug}.combined.json`,'utf8'));
  const packet=await readFile(promptProof.packetFile,'utf8');
  if(sha256(packet)!==promptProof.packetSha256) fail('combined_prompt_changed');
  const raw=await readFile(`analysis-batch-50/drafts/${slug}.combined.raw.md`,'utf8');
  const evidence=await readFile(`analysis-batch-50/drafts/${slug}.combined.search-evidence.txt`,'utf8');
  const result=splitCombined(raw,request.id);
  const parts={analysisStats:result.analysisRaw,soulEssence:result.soulRaw};
  // Validate every destination before writing any split file.
  const outputs=Object.entries(parts).flatMap(([task,text])=>[
    [`analysis-batch-50/drafts/${slug}.${task}.raw.md`,text],
    [`analysis-batch-50/drafts/${slug}.${task}.search-evidence.txt`,evidence],
  ]);
  for(const [path] of outputs){try{await lstat(path);fail('combined_output_exists');}catch(e){if(e.code!=='ENOENT')throw e;}}
  for(const [path,text] of outputs) await writeNew(path,text);
  const proof={format:'dynasty-combined-actual-response',schemaVersion:1,slug,recordId:request.id,
    provider:'ChatGPT web',conversationUrl,generatedAt:new Date().toISOString(),
    originalClipboardFile:`analysis-batch-50/drafts/${slug}.combined.raw.md`,originalClipboardSha256:sha256(raw),
    normalizedCombinedSha256:sha256(result.normalized),packetSha256:promptProof.packetSha256,
    searchEvidenceSha256:sha256(evidence),actualResponseCount:1,
    parts:Object.fromEntries(Object.entries(parts).map(([task,text])=>[task,{rawFile:`analysis-batch-50/drafts/${slug}.${task}.raw.md`,rawSha256:sha256(text)}])),
    composition:'One untouched browser clipboard retained; known export normalization and exact marker split only. Both tasks come from the same actual response; prose and scores are not authored or rewritten.'};
  await writeNew(`analysis-batch-50/drafts/${slug}.combined.capture.json`,JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({status:'split',slug,actualResponses:1,stats:result.analysisFields.stats,analysisCharacters:result.analysisFields.analysis.length,soulCharacters:result.soulFields.soulEssence.length}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [mode,slug,url]=process.argv.slice(2);
  try{if(!/^\d{2}$/.test(slug))fail('invalid_slug');if(mode==='compile')await compile(slug);else if(mode==='split')await split(slug,url);else fail('invalid_mode');}
  catch(e){console.error(JSON.stringify({passed:false,error:e.message}));process.exitCode=1;}
}
