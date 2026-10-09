// Read-only by default. Credentials and original documents are private inputs;
// reports contain only fixed check names, hashes, counts, model names and status.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { USER_FIELDS, userSnapshot, record, validateWorkspace, validRevision } from '../src/contracts.mjs';

const MAX_RESPONSE_BYTES = 33 * 1024 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = value => sha256(canonicalJson(value));
function safeModel(value, privateStrings) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(value) && !privateStrings.some(secret => secret && value.includes(secret)) ? value : 'unrecognized';
}
function counts(value) {
  return Object.fromEntries(USER_FIELDS.map(field => [field, Array.isArray(value[field]) ? value[field].length : record(value[field]) ? Object.keys(value[field]).length : value[field] === null ? 0 : null]));
}
export function expectedSnapshots(source) {
  if (!record(source) || source.format !== 'dynasty-migration-snapshot' || source.schemaVersion !== 1 || !record(source.documents) || !Object.hasOwn(source.documents, 'userdata') || !Object.hasOwn(source.documents, 'worldworkspaces')) throw new Error('invalid_source');
  const userdata = source.documents.userdata, world = source.documents.worldworkspaces;
  if ((userdata !== null && !record(userdata)) || (world !== null && !record(world))) throw new Error('invalid_source');
  const worldRevision = world && Object.hasOwn(world, 'revision') ? world.revision : 0;
  if (!validRevision(worldRevision)) throw new Error('invalid_source_revision');
  return {
    userdata: userSnapshot(userdata),
    world: { revision: worldRevision, workspace: world?.workspace ?? null },
    unexposedWorldEnvelopeFields: world ? Object.keys(world).filter(key => !['_id', 'revision', 'workspace'].includes(key)).length : 0,
  };
}
async function responseText(response) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, source = '';
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength; if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('response_too_large'); }
      source += decoder.decode(next.value, { stream: true });
    }
    return source + decoder.decode();
  } finally { reader.releaseLock(); }
}
export function verifySse(source) {
  let output = '', model = null, complete = false, failed = false;
  for (const block of source.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    if (complete) { failed = true; continue; }
    if (data === '[DONE]') { complete = true; continue; }
    let value; try { value = JSON.parse(data); } catch { failed = true; continue; }
    if (!record(value) || Object.hasOwn(value, 'error')) { failed = true; continue; }
    if (Object.hasOwn(value, 'model')) { if (typeof value.model !== 'string') failed = true; else model = value.model; }
    if (Object.hasOwn(value, 'text')) { if (typeof value.text !== 'string') failed = true; else output += value.text; }
    if (!Object.hasOwn(value, 'model') && !Object.hasOwn(value, 'text')) failed = true;
  }
  return { passed: complete && !failed && Boolean(output.trim()) && output.length <= 256 && typeof model === 'string', complete, model, output };
}

export async function verifyLiveApi({ origin, secret, source, checkWrites = false, checkAi = false, fetcher = fetch, timestamp = () => new Date().toISOString() }) {
  const target = new URL(origin);
  if (target.username || target.password || target.search || target.hash || target.pathname !== '/' || !['https:', ...(target.hostname === 'localhost' || target.hostname === '127.0.0.1' ? ['http:'] : [])].includes(target.protocol) || typeof secret !== 'string' || !secret) throw new Error('invalid_inputs');
  const expected = expectedSnapshots(source);
  const report = {
    format: 'dynasty-live-api-verification', schemaVersion: 1, verifiedAt: timestamp(),
    readOnly: !checkWrites, paidAiRequestsAuthorized: Boolean(checkAi), passed: false, checks: {},
    original: { userdataSha256: hash(expected.userdata), worldSha256: hash(expected.world), userdataCounts: counts(expected.userdata), userdataRevision: expected.userdata.revision, worldRevision: expected.world.revision, worldSessions: expected.world.workspace?.sessions?.length ?? 0, unexposedWorldEnvelopeFields: expected.unexposedWorldEnvelopeFields },
  };
  let token;
  const privateStrings = [secret];
  async function request(path, { method = 'GET', body, auth = true, stream = false } = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
    try {
      const headers = { Accept: stream ? 'text/event-stream' : 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth && token) headers['x-app-token'] = token;
      const response = await fetcher(`${target.origin}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error' });
      const text = await responseText(response);
      if (stream) return { status: response.status, text, contentType: response.headers.get('content-type') || '' };
      let value; try { value = JSON.parse(text); } catch { return { status: response.status, body: null, malformed: true }; }
      return { status: response.status, body: value };
    } catch { return { status: null, body: null, transportFailed: true }; }
    finally { clearTimeout(timer); }
  }
  const check = (name, response, passed, extra = {}) => { report.checks[name] = { status: response.status, passed: Boolean(passed), ...extra }; };

  const health = await request('/api/health', { auth: false });
  check('health', health, health.status === 200 && health.body?.status === 'ok' && health.body?.storageReady === true && health.body?.runtime === 'cloudflare-workers');
  for (const [name, path] of [['userdataUnauthenticated', '/api/userdata'], ['worldUnauthenticated', '/api/world-workspace']]) {
    const response = await request(path, { auth: false }); check(name, response, [401, 403].includes(response.status));
  }
  const wrongPassword = `invalid-verification-${crypto.randomUUID()}`;
  const denied = await request('/api/auth', { method: 'POST', auth: false, body: { password: wrongPassword === secret ? `${wrongPassword}-wrong` : wrongPassword } });
  check('wrongPasswordRejected', denied, denied.status === 401);
  const login = await request('/api/auth', { method: 'POST', auth: false, body: { password: secret } });
  const authenticated = login.status === 200 && typeof login.body?.token === 'string' && login.body.token.length > 0;
  check('authenticated', login, authenticated);
  if (!authenticated) return finish();
  token = login.body.token; privateStrings.push(token);

  const userdata = await request('/api/userdata'), world = await request('/api/world-workspace');
  const userMatches = userdata.status === 200 && isDeepStrictEqual(userdata.body, expected.userdata);
  const worldMatches = world.status === 200 && isDeepStrictEqual(world.body, expected.world);
  check('userdataOriginal', userdata, userMatches, { ...(userdata.status === 200 && record(userdata.body) ? { sha256: hash(userdata.body), counts: counts(userdata.body) } : {}) });
  check('worldOriginal', world, worldMatches, { ...(world.status === 200 && record(world.body) ? { sha256: hash(world.body), sessions: world.body.workspace?.sessions?.length ?? 0 } : {}) });

  if (checkWrites) {
    report.writes = { requested: true, attempted: false, revisions: { userdataBefore: expected.userdata.revision, worldBefore: expected.world.revision } };
    if (!userMatches || !worldMatches) report.checks.writePreconditions = { status: 'skipped_source_mismatch', passed: false };
    else {
      report.writes.attempted = true;
      // Prefer a field present in the raw source, avoiding adding a default to
      // a legacy record. Use its full existing value, never an empty substitute.
      const originalDocument = source.documents.userdata;
      const fields = USER_FIELDS.filter(field => originalDocument && Object.hasOwn(originalDocument, field));
      const field = fields.sort((one, two) => canonicalJson(userdata.body[one]).length - canonicalJson(userdata.body[two]).length)[0] || 'scenes';
      const userBody = { revision: userdata.body.revision, [field]: userdata.body[field] };
      const userWrite = await request('/api/userdata', { method: 'POST', body: userBody });
      const userWritten = userWrite.status === 200 && userWrite.body?.status === 'ok' && userWrite.body?.revision === userBody.revision + 1;
      check('userdataSameValueWrite', userWrite, userWritten, { field, documentCreated: originalDocument === null });
      if (userWritten) {
        report.writes.revisions.userdataAfter = userWrite.body.revision;
        const stale = await request('/api/userdata', { method: 'POST', body: userBody }); check('userdataStaleRejected', stale, stale.status === 409);
        const after = await request('/api/userdata');
        check('userdataContentPreserved', after, after.status === 200 && isDeepStrictEqual(after.body, { ...userdata.body, revision: userWrite.body.revision }), { ...(after.status === 200 && record(after.body) ? { sha256: hash(after.body) } : {}) });
      }
      let worldWritable = true; try { validateWorkspace(world.body.workspace); } catch { worldWritable = false; }
      if (source.documents.worldworkspaces === null) {
        // An absent world collection has nothing to round-trip. Creating a
        // null workspace merely to test persistence would alter the original
        // envelope; local workerd tests already exercise its write/CAS path.
        report.checks.worldSameValueWrite = { status: 'skipped_missing_document', passed: worldMatches, documentCreated: false };
      } else if (!userWritten || !worldWritable) report.checks.worldSameValueWrite = { status: !userWritten ? 'skipped_previous_write_failure' : 'skipped_unsupported_world', passed: false };
      else {
        const worldBody = { revision: world.body.revision, workspace: world.body.workspace };
        const worldWrite = await request('/api/world-workspace', { method: 'POST', body: worldBody });
        const worldWritten = worldWrite.status === 200 && worldWrite.body?.status === 'ok' && worldWrite.body?.revision === worldBody.revision + 1;
        check('worldSameValueWrite', worldWrite, worldWritten, { documentCreated: source.documents.worldworkspaces === null });
        if (worldWritten) {
          report.writes.revisions.worldAfter = worldWrite.body.revision;
          const stale = await request('/api/world-workspace', { method: 'POST', body: worldBody }); check('worldStaleRejected', stale, stale.status === 409);
          const after = await request('/api/world-workspace');
          check('worldContentPreserved', after, after.status === 200 && isDeepStrictEqual(after.body, { ...world.body, revision: worldWrite.body.revision }), { ...(after.status === 200 && record(after.body) ? { sha256: hash(after.body) } : {}) });
        }
      }
    }
  }
  if (checkAi) {
    report.ai = { requested: true, requestsAttempted: 0 };
    if (!userMatches || !worldMatches || !report.checks.health.passed) report.checks.aiPreconditions = { status: 'skipped_source_or_health_mismatch', passed: false };
    else {
      const tiny = prompt => ({ contents: [{ role: 'user', parts: [{ text: prompt }] }], is_json: false });
      report.ai.requestsAttempted++;
      const normal = await request('/api/gemini', { method: 'POST', body: tiny('只回答 OK，不加其他文字。') });
      const normalPassed = normal.status === 200 && typeof normal.body?.result === 'string' && Boolean(normal.body.result.trim()) && normal.body.result.length <= 256 && typeof normal.body?.model === 'string';
      check('aiNormal', normal, normalPassed, { model: safeModel(normal.body?.model, privateStrings), ...(normalPassed ? { characters: normal.body.result.length, sha256: sha256(normal.body.result) } : {}) });
      report.ai.requestsAttempted++;
      const json = await request('/api/gemini', { method: 'POST', body: { ...tiny('只輸出 JSON 物件 {"ok":true}，不加其他文字。'), is_json: true } });
      let object; try { object = JSON.parse(json.body?.result); } catch { /* Only fixed status is reported. */ }
      const jsonPassed = json.status === 200 && record(object) && object.ok === true && typeof json.body?.model === 'string';
      check('aiJson', json, jsonPassed, { model: safeModel(json.body?.model, privateStrings), ...(jsonPassed ? { sha256: hash(object) } : {}) });
      report.ai.requestsAttempted++;
      const stream = await request('/api/gemini/stream', { method: 'POST', body: tiny('只回答 OK，不加其他文字。'), stream: true });
      const parsed = verifySse(stream.text || '');
      check('aiSse', stream, stream.status === 200 && /^text\/event-stream(?:;|$)/i.test(stream.contentType || '') && parsed.passed, { model: safeModel(parsed.model, privateStrings), complete: parsed.complete, ...(parsed.passed ? { characters: parsed.output.length, sha256: sha256(parsed.output) } : {}) });
    }
  }
  return finish();

  function finish() { report.passed = Object.values(report.checks).every(value => value.passed); return report; }
}

export function parseArguments(values) {
  const result = { checkWrites: false, checkAi: false };
  const fields = { '--origin': 'origin', '--secret-file': 'secretFile', '--source': 'sourceFile', '--output': 'outputFile' };
  for (let index = 0; index < values.length; index++) {
    const argument = values[index];
    if (argument === '--check-writes') result.checkWrites = true;
    else if (argument === '--check-ai') result.checkAi = true;
    else if (fields[argument] && values[index + 1] && !values[index + 1].startsWith('--') && !result[fields[argument]]) result[fields[argument]] = values[++index];
    else throw new Error('invalid_arguments');
  }
  if (Object.values(fields).some(field => !result[field])) throw new Error('missing_arguments');
  return result;
}
export async function main(values = process.argv.slice(2)) {
  try {
    const arguments_ = parseArguments(values);
    const output = resolve(arguments_.outputFile);
    // Fail before any live request if the report name is already in use.
    try { await stat(output); throw new Error('output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dirname(output), { recursive: true });
    const secretInput = JSON.parse(await readFile(resolve(arguments_.secretFile), 'utf8'));
    const source = JSON.parse(await readFile(resolve(arguments_.sourceFile), 'utf8'));
    const report = await verifyLiveApi({ ...arguments_, secret: secretInput.APP_SECRET, source });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.passed ? 'passed' : 'failed', checks: Object.keys(report.checks).length, readOnly: report.readOnly, aiRequestsAttempted: report.ai?.requestsAttempted ?? 0 }));
    return report.passed ? 0 : 1;
  } catch {
    console.error('API verification could not complete; no credentials or original data were printed.');
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
