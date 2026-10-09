#!/usr/bin/env node
// Offline inventory only. Private inputs are never evaluated or sent anywhere.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { strictJsonParse, record } from '../src/contracts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const PERSISTED_FIELDS = ['customLegends', 'modifiedLegends', 'chatHistories', 'simulationHistory', 'discussionHistories', 'soulSaves', 'hegemonySavedSim', 'scenes', 'sceneEdits', 'soulSession'];
const WORLD_FIELDS = ['format', 'schemaVersion', 'sessions', 'activeSessionId', 'selection', 'notes', 'narratives'];
const ANALYSIS_FIELDS = ['deepAnalysis', 'analysis', 'soulEssence'];
const list = value => Array.isArray(value) ? value : [];
const map = value => record(value) ? value : {};
const exists = value => value === undefined ? 0 : 1;
const entries = value => Array.isArray(value) ? value.length : record(value) ? Object.keys(value).length : 0;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value ?? null);
}
const hash = value => sha256(canonical(value));
const extras = (value, known) => Object.fromEntries(Object.entries(map(value)).filter(([key]) => !known.includes(key)));

export async function loadBaseLibrary() {
  const backend = path.join(root, '..', 'backend');
  const baseSource = await fs.readFile(path.join(backend, 'static/data/legends.js'), 'utf8');
  const frontend = await fs.readFile(path.join(backend, 'index.html'), 'utf8');
  const generateStart = frontend.indexOf('function generateId(type, name)');
  const guessStart = frontend.indexOf('function guessDynasty(l)');
  const guessEnd = frontend.indexOf('// --- DATA INITIALIZATION & CLEANUP ---', guessStart);
  if (generateStart < 0 || guessStart <= generateStart || guessEnd <= guessStart) throw new Error('內建人物初始化程式無法辨識');
  // Only checked-in public code runs in the VM; private snapshots never enter it.
  const initialization = `${baseSource}\n${frontend.slice(generateStart, guessStart)}\n${frontend.slice(guessStart, guessEnd)}\nstaticLegendsData.map(l => {
    const copy = { ...l, id: generateId(l.type, l.name), dynasty: guessDynasty(l) };
    copy.desc = copy.desc.replace(/\\n/g, '').replace(/。。/g, '。').trim();
    if (copy.poem && copy.desc.endsWith(copy.poem)) copy.desc = copy.desc.substring(0, copy.desc.length - copy.poem.length).trim();
    return copy;
  });`;
  const base = JSON.parse(JSON.stringify(vm.runInNewContext(initialization, {}, { timeout: 1000 })));
  return { base, baseSourceSha256: sha256(baseSource), initializationSourceSha256: sha256(frontend.slice(generateStart, guessEnd)) };
}

function validateEnvelope(snapshot) {
  if (!record(snapshot) || !['dynasty-migration-snapshot', 'dynasty-preliminary-snapshot'].includes(snapshot.format) || snapshot.schemaVersion !== 1 || !record(snapshot.documents)
      || Object.keys(snapshot.documents).length !== 2 || !Object.hasOwn(snapshot.documents, 'userdata') || !Object.hasOwn(snapshot.documents, 'worldworkspaces')
      || Object.values(snapshot.documents).some(document => document !== null && !record(document))) throw new Error('快照格式不正確');
  const userdata = snapshot.documents.userdata;
  if (userdata !== null) {
    if (Object.hasOwn(userdata, 'customLegends') && (!Array.isArray(userdata.customLegends) || userdata.customLegends.some(item => !record(item)))) throw new Error('自訂人物欄位格式不正確');
    if (Object.hasOwn(userdata, 'modifiedLegends') && !record(userdata.modifiedLegends)) throw new Error('人物修改欄位格式不正確');
  }
}

export function auditSnapshot(snapshot, base, comparison = null, expectedTotal = null) {
  validateEnvelope(snapshot);
  if (comparison !== null) validateEnvelope(comparison);
  if (!Array.isArray(base) || base.some(item => !record(item) || typeof item.id !== 'string')) throw new Error('內建人物欄位格式不正確');
  if (expectedTotal !== null && (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0)) throw new Error('期望人物數不正確');
  const userdata = map(snapshot.documents.userdata), worldDocument = map(snapshot.documents.worldworkspaces);
  const custom = list(userdata.customLegends), modifications = map(userdata.modifiedLegends);
  // Same concatenation, shallow overlay and immutable source id as refreshData().
  const merged = [...base, ...custom].map(figure => {
    const modification = modifications[figure.id];
    if (!modification) return figure;
    return { ...figure, ...modification, id: figure.id, isModified: Object.keys(modification).some(key => !['stats', 'analysis', 'statsAnalysis'].includes(key)) };
  });
  const validId = figure => typeof figure.id === 'string' && figure.id.length > 0;
  const baseIds = new Set(base.filter(validId).map(figure => figure.id));
  const customIds = custom.filter(validId).map(figure => figure.id);
  const validMerged = merged.filter(validId), byId = new Map(validMerged.map(figure => [figure.id, figure]));
  const uniqueFigures = [...byId.values()];
  const unknownUserdata = extras(userdata, [...PERSISTED_FIELDS, 'revision', '_id']);
  const workspace = map(worldDocument.workspace), unknownWorldDocument = extras(worldDocument, ['revision', 'workspace', '_id']);
  const unknownWorkspace = extras(workspace, WORLD_FIELDS);
  const orphanCount = group => Object.keys(map(group)).filter(id => !byId.has(id)).length;
  const chats = map(userdata.chatHistories), discussions = map(userdata.discussionHistories);
  const worldSessions = list(workspace.sessions), savedSoul = list(userdata.soulSaves);
  const activeSoul = map(userdata.soulSession), hegemony = map(userdata.hegemonySavedSim);
  const fieldSummaries = Object.fromEntries(PERSISTED_FIELDS.map(field => [field, { present: exists(userdata[field]), entries: entries(userdata[field]), sha256: hash(userdata[field]) }]));
  const report = {
    schemaVersion: 1,
    // Preliminary captures may race with source writes and are inventory only.
    // Neither matching counts nor a matching comparison promotes their stage.
    stage: snapshot.format === 'dynasty-preliminary-snapshot' || comparison?.format === 'dynasty-preliminary-snapshot' ? 'preliminary' : 'migration',
    eligibleForFormalCutover: 0,
    userdata: {
      documentPresent: snapshot.documents.userdata === null ? 0 : 1,
      revision: Number.isSafeInteger(userdata.revision) ? userdata.revision : 0,
      topLevelFields: Object.keys(userdata).length,
      unknownTopLevelFields: Object.keys(unknownUserdata).length,
      unknownFieldsSha256: hash(unknownUserdata), fullDocumentSha256: hash(snapshot.documents.userdata),
      fields: fieldSummaries,
    },
    figures: {
      builtIn: base.length, custom: custom.length, modifications: Object.keys(modifications).length,
      visibleEntries: merged.length, uniqueIds: byId.size,
      invalidIds: merged.length - validMerged.length,
      duplicateMergedIds: validMerged.length - byId.size,
      duplicateCustomIds: customIds.length - new Set(customIds).size,
      customCollisionsWithBuiltIn: customIds.filter(id => baseIds.has(id)).length,
      invalidModificationRecords: Object.values(modifications).filter(value => !record(value)).length,
      orphanModificationRecords: orphanCount(modifications),
      emperor: merged.filter(figure => figure.type === 'emperor').length,
      general: merged.filter(figure => figure.type === 'general').length,
      minister: merged.filter(figure => figure.type === 'minister').length,
      withAnyAnalysis: uniqueFigures.filter(figure => ANALYSIS_FIELDS.some(field => Boolean(figure[field]))).length,
      mergedLibrarySha256: hash(merged),
      ...Object.fromEntries(ANALYSIS_FIELDS.map(field => [field, {
        uniqueFigures: uniqueFigures.filter(figure => Boolean(figure[field])).length,
        storedModificationRecords: Object.values(modifications).filter(value => record(value) && Boolean(value[field])).length,
        textCharacters: uniqueFigures.reduce((total, figure) => total + (typeof figure[field] === 'string' ? figure[field].length : 0), 0),
        nonTextValues: uniqueFigures.filter(figure => Boolean(figure[field]) && typeof figure[field] !== 'string').length,
      }])),
    },
    histories: {
      chatGroups: Object.keys(chats).length, chatMessages: Object.values(chats).reduce((total, messages) => total + list(messages).length, 0),
      orphanChatGroups: orphanCount(chats), invalidChatGroups: Object.values(chats).filter(value => !Array.isArray(value)).length,
      discussionGroups: Object.keys(discussions).length, discussionMessages: Object.values(discussions).reduce((total, group) => total + list(group?.messages).length, 0),
      orphanDiscussionGroups: orphanCount(discussions), invalidDiscussionGroups: Object.values(discussions).filter(value => !record(value) || !Array.isArray(value.messages)).length,
      simulations: list(userdata.simulationHistory).length, soulSavedGames: savedSoul.length,
      soulSavedChapters: savedSoul.reduce((total, save) => total + list(save?.snapshot?.chapters).length, 0),
      activeSoulSessionPresent: record(userdata.soulSession) ? 1 : 0, activeSoulChapters: list(activeSoul.chapters).length,
      hegemonyPresent: record(userdata.hegemonySavedSim) ? 1 : 0, hegemonyFactions: list(hegemony.factions).length, hegemonyPhases: list(hegemony.phases).length,
      scenes: list(userdata.scenes).length, sceneEdits: Object.keys(map(userdata.sceneEdits)).length,
    },
    world: {
      documentPresent: snapshot.documents.worldworkspaces === null ? 0 : 1,
      revision: Number.isSafeInteger(worldDocument.revision) ? worldDocument.revision : 0,
      fullDocumentSha256: hash(snapshot.documents.worldworkspaces),
      unknownTopLevelFields: Object.keys(unknownWorldDocument).length, unknownFieldsSha256: hash(unknownWorldDocument),
      workspacePresent: record(worldDocument.workspace) ? 1 : 0,
      workspaceSchemaVersion: Number.isSafeInteger(workspace.schemaVersion) ? workspace.schemaVersion : 0,
      workspaceUnknownFields: Object.keys(unknownWorkspace).length, workspaceUnknownFieldsSha256: hash(unknownWorkspace),
      workspaceSha256: hash(worldDocument.workspace), sessions: worldSessions.length,
      workspaceNarratives: list(workspace.narratives).length,
      sessionNarratives: worldSessions.reduce((total, session) => total + list(session?.narratives).length, 0),
      selectedFigures: list(workspace.selection?.recordIds).length, analysisAnchors: list(workspace.selection?.anchors).length,
    },
  };
  if (expectedTotal !== null) report.expectedFigures = { expected: expectedTotal, countMatches: byId.size === expectedTotal ? 1 : 0 };
  if (comparison !== null) {
    const userdataMatches = isDeepStrictEqual(snapshot.documents.userdata, comparison.documents.userdata);
    const worldMatches = isDeepStrictEqual(snapshot.documents.worldworkspaces, comparison.documents.worldworkspaces);
    report.comparison = {
      matchingDocuments: Number(userdataMatches) + Number(worldMatches), mismatchingDocuments: 2 - Number(userdataMatches) - Number(worldMatches),
      userdataMatches: Number(userdataMatches), worldMatches: Number(worldMatches),
      sourceFullDocumentsSha256: hash(snapshot.documents), comparisonFullDocumentsSha256: hash(comparison.documents),
    };
    report.eligibleForFormalCutover = report.stage === 'migration' && userdataMatches && worldMatches
      && report.figures.invalidIds === 0 && report.figures.duplicateMergedIds === 0
      && (expectedTotal === null || report.expectedFigures.countMatches === 1) ? 1 : 0;
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2), values = {};
  for (let index = 0; index < args.length; index++) {
    if (!['--snapshot', '--compare', '--output', '--expect-total'].includes(args[index]) || !args[index + 1]) throw new Error('需要有效快照與選項');
    values[args[index].slice(2)] = args[++index];
  }
  if (!values.snapshot) throw new Error('需要 --snapshot');
  const snapshotBytes = await fs.readFile(values.snapshot);
  const snapshot = strictJsonParse(snapshotBytes.toString('utf8'));
  const comparison = values.compare ? strictJsonParse(await fs.readFile(values.compare, 'utf8')) : null;
  const expectedTotal = values['expect-total'] === undefined ? null : Number(values['expect-total']);
  const { base, baseSourceSha256, initializationSourceSha256 } = await loadBaseLibrary();
  const report = { ...auditSnapshot(snapshot, base, comparison, expectedTotal), snapshotFileSha256: sha256(snapshotBytes), baseSourceSha256, initializationSourceSha256 };
  if (values.output) {
    await fs.mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
    await fs.writeFile(values.output, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.comparison?.mismatchingDocuments || report.expectedFigures?.countMatches === 0) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('資料數目核對失敗；請確認快照、欄位與輸出目錄。未顯示私人內容。'); process.exitCode = 1; });
}
