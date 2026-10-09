// Local verification only. Inputs are JSON data, never evaluated or uploaded.
// Reports contain counts, booleans, field names and hashes, never private prose.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { record, strictJsonParse, USER_FIELDS } from '../cloudflare/src/contracts.mjs';
import { loadBaseLibrary, auditSnapshot } from '../cloudflare/scripts/audit-counts.mjs';
import { PilotError, sourceUserdata, contentHash, sha256, planPilot } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_LAYERS, planLayerImport } from '../cloudflare/scripts/analysis-pilot-layers-import.mjs';

const own = (value, key) => Object.hasOwn(value, key);
const targetIds = Object.keys(AUTHORIZED_LAYERS);
const sameIds = values => isDeepStrictEqual([...values].sort(), [...targetIds].sort());
const fail = code => { throw new PilotError(code); };
const envelope = userdata => ({ format: 'dynasty-migration-snapshot', schemaVersion: 1, documents: { userdata, worldworkspaces: null } });

function restoreAllowedChanges(after, before) {
  const restored = structuredClone(after);
  delete restored.revision;
  for (const id of targetIds) {
    const original = own(before.modifiedLegends, id) ? before.modifiedLegends[id] : null;
    const current = restored.modifiedLegends[id];
    if (!record(current)) fail('final_target_missing');
    for (const field of ['deepAnalysis', ...AUTHORIZED_LAYERS[id]]) {
      if (original && own(original, field)) current[field] = structuredClone(original[field]);
      else delete current[field];
    }
    if (!original && !Object.keys(current).length) delete restored.modifiedLegends[id];
  }
  return restored;
}

function worldInput(input) {
  const provided = input?.format === 'dynasty-migration-snapshot' && input.schemaVersion === 1
    && record(input.documents) && own(input.documents, 'worldworkspaces');
  if (provided && input.documents.worldworkspaces !== null && !record(input.documents.worldworkspaces)) fail('invalid_world_snapshot');
  return { provided, value: provided ? input.documents.worldworkspaces : null };
}

export function verifyCompletePilot(beforeInput, afterInput, base, deepBatch, layersBatch) {
  const before = sourceUserdata(beforeInput), after = sourceUserdata(afterInput);
  if (!Array.isArray(deepBatch?.records) || !sameIds(deepBatch.records.map(item => item?.id))) fail('complete_pilot_target_mismatch');
  if (!Array.isArray(layersBatch?.records) || !sameIds(layersBatch.records.map(item => item?.id))) fail('complete_pilot_target_mismatch');
  // Each phase's existing validators bind the batch to the full merged target
  // input and reject overwrites of already populated layers.
  const first = planPilot(before, before, base, deepBatch);
  const second = planLayerImport(first.after, first.after, base, layersBatch);
  if (first.report.changedFields !== 3 || second.report.changedFields !== 5) fail('complete_pilot_layer_count_mismatch');
  if (after.revision !== before.revision + 2) fail('complete_pilot_revision_mismatch');
  if (!isDeepStrictEqual(after, second.after)) fail('unapproved_userdata_change');

  const restored = restoreAllowedChanges(after, before), baseline = structuredClone(before);
  delete baseline.revision;
  const userdataFields = Object.fromEntries(USER_FIELDS.map(field => [field, {
    preserved: isDeepStrictEqual(baseline[field], restored[field]),
    beforeSha256: contentHash(baseline[field]),
    afterRemovingAllowedAdditionsSha256: contentHash(restored[field]),
    directlyEqualBeforeAndAfter: isDeepStrictEqual(before[field], after[field]),
  }]));
  if (Object.values(userdataFields).some(value => !value.preserved) || !isDeepStrictEqual(baseline, restored)) fail('userdata_preservation_failed');

  const beforeInventory = auditSnapshot(envelope(before), base);
  const afterInventory = auditSnapshot(envelope(after), base);
  if (beforeInventory.figures.uniqueIds !== afterInventory.figures.uniqueIds
    || beforeInventory.figures.visibleEntries !== afterInventory.figures.visibleEntries
    || !isDeepStrictEqual(beforeInventory.histories, afterInventory.histories)) fail('inventory_preservation_failed');

  const beforeWorld = worldInput(beforeInput), afterWorld = worldInput(afterInput);
  const worldChecked = beforeWorld.provided && afterWorld.provided;
  if (worldChecked && !isDeepStrictEqual(beforeWorld.value, afterWorld.value)) fail('provided_world_snapshot_changed');
  const worldworkspaces = {
    checked: worldChecked,
    providedBefore: beforeWorld.provided,
    providedAfter: afterWorld.provided,
    passed: worldChecked ? true : null,
    scope: worldChecked ? 'Compared only the worldworkspaces supplied in the two input snapshots; no remote reads.' : 'Both worldworkspaces snapshots were not supplied; no world verification claimed.',
    ...(worldChecked ? { beforeSha256: contentHash(beforeWorld.value), afterSha256: contentHash(afterWorld.value) } : {}),
  };

  const layers = targetIds.map(id => ({
    id,
    additions: ['deepAnalysis', ...AUTHORIZED_LAYERS[id]].map(field => {
      const text = after.modifiedLegends[id][field];
      return { field, characters: [...text].length, utf16CodeUnits: text.length, sha256: sha256(text) };
    }),
  }));
  return {
    format: 'dynasty-complete-pilot-delivery-audit', schemaVersion: 1,
    verifiedAt: new Date().toISOString(), status: 'complete_verified', passed: true,
    scope: 'Local API-visible userdata: all 10 persisted fields and all other visible top-level fields; only the three authorized figures and eight missing prose fields may change.',
    revision: { before: before.revision, after: after.revision, expectedIncrease: 2, passed: true },
    authorization: { targetCount: 3, deepAnalysisAdditions: 3, additionalLayerAdditions: 5, totalAddedFields: 8, existingWangJianAnalysisPreserved: isDeepStrictEqual(before.modifiedLegends['general_王翦_306401394']?.analysis, after.modifiedLegends['general_王翦_306401394']?.analysis), ratingsAndStatsPreserved: true, unrelatedFiguresPreserved: true },
    userdataFields,
    userdataHashes: { beforeSha256: contentHash(before), afterSha256: contentHash(after), unaffectedBeforeSha256: contentHash(baseline), unaffectedAfterSha256: contentHash(restored) },
    batchHashes: { deepBatchSha256: contentHash(deepBatch), layersBatchSha256: contentHash(layersBatch), baseLibrarySha256: contentHash(base) },
    figures: { before: beforeInventory.figures, after: afterInventory.figures },
    histories: { before: beforeInventory.histories, after: afterInventory.histories, preserved: true },
    layers, worldworkspaces,
  };
}

export function parseVerificationArguments(values) {
  const allowed = ['--before', '--after', '--deep-batch', '--layers-batch', '--output'];
  const args = {};
  for (let index = 0; index < values.length; index++) {
    const option = values[index];
    if (!allowed.includes(option) || own(args, option) || !values[index + 1] || values[index + 1].startsWith('--')) fail('invalid_verification_arguments');
    args[option] = path.resolve(values[++index]);
  }
  if (allowed.some(option => !own(args, option))) fail('missing_verification_argument');
  return args;
}

export async function main(values = process.argv.slice(2)) {
  let output = null;
  try {
    const args = parseVerificationArguments(values); output = args['--output'];
    try { await fs.stat(output); fail('verification_output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const inputs = await Promise.all(['--before', '--after', '--deep-batch', '--layers-batch'].map(async option => strictJsonParse(await fs.readFile(args[option], 'utf8'))));
    const { base, baseSourceSha256, initializationSourceSha256 } = await loadBaseLibrary();
    const report = { ...verifyCompletePilot(...inputs.slice(0, 2), base, ...inputs.slice(2)), publicLibrarySourceHashes: { baseSourceSha256, initializationSourceSha256 } };
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, passed: report.passed, targetCount: report.authorization.targetCount, addedFields: report.authorization.totalAddedFields, beforeRevision: report.revision.before, afterRevision: report.revision.after, figures: report.figures.after.uniqueIds, worldChecked: report.worldworkspaces.checked }));
    return 0;
  } catch (error) {
    const report = { format: 'dynasty-complete-pilot-delivery-audit', schemaVersion: 1, status: error instanceof PilotError ? error.code : 'verification_failed', passed: false };
    if (output) {
      try { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); } catch { /* Existing output is never replaced. */ }
    }
    console.error(JSON.stringify(report));
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
