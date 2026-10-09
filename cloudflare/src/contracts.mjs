// The persisted contract mirrors backend/userdata_schema.py and world_workspace.py.
export const MAX_WORLD_BYTES = 8 * 1024 * 1024;
export const MAX_REVISION = Number.MAX_SAFE_INTEGER - 1;
export class HttpError extends Error {
  constructor(status, detail) { super(typeof detail === 'string' ? detail : 'Invalid request'); this.status = status; this.detail = detail; }
}
const fail = message => { throw new HttpError(422, message); };
const numericKinds = new WeakMap();
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const storedRevision = document => document && own(document, 'revision') ? document.revision : 0;
export const strictInteger = (value, key) => Number.isSafeInteger(value?.[key]) && !numericKinds.get(value)?.has(key);
export const validRevision = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_REVISION;
const stringWithin = (value, maximum) => value.length <= maximum || (value.length <= maximum * 2 && [...value].length <= maximum);
const text = (value, maximum, empty = false) => typeof value === 'string' && stringWithin(value, maximum) && (empty || Boolean(value.trim()));
const hasOnly = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const hasExactly = (value, allowed) => hasOnly(value, allowed) && allowed.every(key => own(value, key));

// JSON.parse silently accepts duplicate keys and loses the distinction between
// 0 and 0.0. The original Python validation rejects both duplicate world keys
// and floating-point revision literals, so preserve that information here.
export function strictJsonParse(source) {
  let position = 0;
  const bad = () => { throw new HttpError(422, '資料不是有效 JSON'); };
  const whitespace = () => { while (/[\t\n\r ]/.test(source[position] || '\u0000')) position++; };
  function quoted() {
    const start = position++;
    while (position < source.length) {
      const closing = source.indexOf('"', position);
      if (closing === -1) bad();
      let escapes = 0;
      for (let before = closing - 1; before >= start && source[before] === '\\'; before--) escapes++;
      position = closing + 1;
      if (escapes % 2 === 0) {
        try { return JSON.parse(source.slice(start, position)); } catch { bad(); }
      }
    }
    bad();
  }
  function value(depth = 0) {
    if (depth > 100) bad();
    whitespace();
    const char = source[position];
    if (char === '"') return { value: quoted() };
    if (char === '{' || char === '[') {
      const object = char === '{';
      const result = object ? {} : [];
      const numberKeys = new Set();
      const seen = new Set();
      const closing = object ? '}' : ']';
      position++; whitespace();
      if (source[position] === closing) { position++; return { value: result }; }
      while (position < source.length) {
        let key = result.length;
        if (object) {
          whitespace(); if (source[position] !== '"') bad();
          key = quoted(); if (seen.has(key)) bad(); seen.add(key);
          whitespace(); if (source[position++] !== ':') bad();
        }
        const child = value(depth + 1);
        if (object) Object.defineProperty(result, key, { value: child.value, enumerable: true, configurable: true, writable: true });
        else result.push(child.value);
        if (child.floating) numberKeys.add(String(key));
        whitespace();
        const separator = source[position++];
        if (separator === closing) { numericKinds.set(result, numberKeys); return { value: result }; }
        if (separator !== ',') bad();
      }
      bad();
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, position)) { position += literal.length; return { value: result }; }
    }
    const number = source.slice(position).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) bad();
    position += number[0].length;
    const result = Number(number[0]);
    const floating = /[.eE]/.test(number[0]);
    if (!Number.isFinite(result) || (!floating && !Number.isSafeInteger(result))) bad();
    return { value: result, floating };
  }
  const parsed = value(); whitespace(); if (position !== source.length) bad();
  return parsed.value;
}

export async function readJson(request, maximum, message = '資料超出大小上限') {
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximum) throw new HttpError(413, message);
  const reader = request.body?.getReader();
  if (!reader) fail('資料不是有效 JSON');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, source = '';
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new HttpError(413, message); }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail('資料不是有效 JSON');
  } finally { reader.releaseLock(); }
  return strictJsonParse(source);
}

export const USER_DEFAULTS = Object.freeze({
  customLegends: [], modifiedLegends: {}, chatHistories: {}, simulationHistory: [],
  discussionHistories: {}, soulSaves: [], hegemonySavedSim: null, scenes: [], sceneEdits: {}, soulSession: null,
});
export const USER_FIELDS = Object.keys(USER_DEFAULTS);
const listFields = ['customLegends', 'simulationHistory', 'soulSaves', 'scenes'];
const nullableFields = ['hegemonySavedSim', 'soulSession'];
export function validateUserFields(value) {
  for (const key of USER_FIELDS) {
    if (!own(value, key)) continue;
    const entry = value[key];
    if (listFields.includes(key)) {
      if (!Array.isArray(entry) || !entry.every(record)) fail(`${key} 必須是物件陣列`);
    } else if (!(nullableFields.includes(key) && entry === null) && !record(entry)) fail(`${key} 必須是物件`);
  }
}
export function validateUserPatch(body) {
  if (!record(body)) fail('需要有效資料欄位與 revision');
  if (!own(body, 'revision')) throw new HttpError(422, [{ type: 'missing', loc: ['body', 'revision'], msg: 'Field required' }]);
  if (!strictInteger(body, 'revision') || !validRevision(body.revision)) fail('revision 必須是有效非負整數');
  if (!hasOnly(body, [...USER_FIELDS, 'revision'])) fail('包含未支援的資料欄位');
  if (!USER_FIELDS.some(key => own(body, key))) fail('至少提供一個資料欄位；revision 本身不能作為儲存內容');
  validateUserFields(body);
  return Object.fromEntries(USER_FIELDS.filter(key => own(body, key)).map(key => [key, body[key]]));
}
export function userSnapshot(document) {
  const stored = document || {};
  validateUserFields(stored);
  const revision = storedRevision(stored);
  if (!validRevision(revision)) throw new HttpError(409, '雲端版本號無法辨識，請先保留原資料');
  const { _id, ...visible } = stored;
  return { ...structuredClone(USER_DEFAULTS), ...visible, revision };
}

export function jsonSafe(value, depth = 0) {
  if (depth > 80) fail('世界資料層次過深');
  if (typeof value === 'string') {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) fail('世界資料含無效 Unicode 字元');
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('世界資料含非有限數值'); return; }
  if (Array.isArray(value)) { for (const entry of value) jsonSafe(entry, depth + 1); return; }
  if (record(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || key.includes('\0') || key.startsWith('$') || key.includes('.')) fail('世界資料含不支援的欄位名稱');
      jsonSafe(key, depth + 1); jsonSafe(entry, depth + 1);
    }
    return;
  }
  fail('世界資料不是有效 JSON');
}
const date = value => {
  if (!text(value, 80)) return false;
  const parts = value.match(/^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(?:Z|([+-])(\d\d):(\d\d))?)?$/);
  if (!parts) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    Number(parts[4] || 0) <= 23 && Number(parts[5] || 0) <= 59 && Number(parts[6] || 0) <= 59 &&
    Number(parts[8] || 0) <= 23 && Number(parts[9] || 0) <= 59;
};
const ids = (items, maximum) => Array.isArray(items) && items.length <= maximum && items.every(item => text(item, 180)) && new Set(items).size === items.length;
export function validateNarratives(value) {
  if (!Array.isArray(value) || value.length > 500) fail('敘事紀錄超出上限');
  const seen = new Set();
  for (const item of value) {
    if (!record(item) || !hasOnly(item, ['id', 'turn', 'text', 'createdAt', 'kind', 'contextVersion'])) fail('敘事紀錄包含未支援欄位');
    if (!text(item.id, 180) || seen.has(item.id) || !strictInteger(item, 'turn') || item.turn < 0 || item.turn > 100000 || !text(item.text, 500000, true) || !date(item.createdAt) || !['ai', 'local'].includes(item.kind)) fail('敘事紀錄格式不正確');
    if (own(item, 'contextVersion') && !text(item.contextVersion, 100)) fail('敘事背景版本不正確');
    seen.add(item.id);
  }
}
export function validateSelection(value) {
  if (!record(value) || typeof value.enabled !== 'boolean' || !ids(value.recordIds, 12) || !text(value.notes, 500000, true) || !record(value.setting) || !Array.isArray(value.anchors) || value.anchors.length > 40) fail('共用人物背景欄位不完整或超出上限');
  const setting = value.setting;
  if (!['free', 'historical', 'counterfactual'].includes(setting.kind) || !own(setting, 'eventId') || (setting.eventId !== null && !text(setting.eventId, 180, true)) || !ids(setting.placeIds, 40) || !ids(setting.factionIds, 40)) fail('共用時地勢力設定格式不正確');
  for (const anchor of value.anchors) {
    if (!record(anchor) || !['analysis', 'claim'].includes(anchor.kind)) fail('解讀錨點格式不正確');
    if ((own(anchor, 'interpretation') && !text(anchor.interpretation, 20000, true)) || (own(anchor, 'quote') && !text(anchor.quote, 2400, true)) || (own(anchor, 'principle') && !['none', 'care', 'order', 'bold', 'diplomacy', 'learning'].includes(anchor.principle))) fail('解讀文字或玩家原則格式不正確');
    if (anchor.kind === 'claim') { if (!text(anchor.claimId, 180)) fail('史料錨點缺少主張 ID'); }
    else if (!text(anchor.recordId, 180) || !value.recordIds.includes(anchor.recordId) || !['deepAnalysis', 'analysis', 'soulEssence', 'desc'].includes(anchor.field) || !strictInteger(anchor, 'start') || !strictInteger(anchor, 'end') || anchor.start < 0 || anchor.end <= anchor.start || anchor.end > 10000000 || anchor.end - anchor.start > 2400) fail('人物原文錨點或字元範圍不正確');
  }
}
export function validateWorkspace(value) {
  if (value === null) return null;
  jsonSafe(value);
  if (!record(value) || !hasOnly(value, ['format', 'schemaVersion', 'sessions', 'activeSessionId', 'selection', 'notes', 'narratives']) || value.format !== 'dynasty-world-workspace' || !strictInteger(value, 'schemaVersion') || value.schemaVersion !== 1) fail('不支援的世界資料版本；原始資料仍保留');
  if (!Array.isArray(value.sessions) || value.sessions.length > 12 || !record(value.selection)) fail('世界存檔最多 12 份，且必須包含共用背景');
  validateSelection(value.selection);
  const seen = new Set();
  for (const session of value.sessions) {
    if (!record(session) || !hasExactly(session, ['id', 'title', 'updatedAt', 'save', 'narratives'])) fail('世界存檔欄位不完整或含未支援欄位');
    if (!text(session.id, 180) || seen.has(session.id) || !text(session.title, 300) || !date(session.updatedAt) || !record(session.save)) fail('世界存檔格式不正確');
    const save = session.save;
    if (!hasExactly(save, ['format', 'version', 'state']) || save.format !== 'dynasty-world-save' || !strictInteger(save, 'version') || save.version !== 1 || !record(save.state)) fail('不支援的世界引擎存檔版本');
    validateNarratives(session.narratives); seen.add(session.id);
  }
  if (!own(value, 'activeSessionId') || (value.activeSessionId !== null && (typeof value.activeSessionId !== 'string' || !seen.has(value.activeSessionId)))) fail('目前世界存檔不存在');
  if (own(value, 'notes') && !text(value.notes, 500000, true)) fail('世界筆記格式不正確');
  if (own(value, 'narratives')) validateNarratives(value.narratives);
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_WORLD_BYTES - 100) throw new HttpError(413, '世界資料超出 8 MiB，請先匯出部分存檔');
  return value;
}

export async function loadUserdata(store) { return userSnapshot((await store.read('userdata')).document); }
export async function saveUserdata(store, body) {
  const patch = validateUserPatch(body);
  const observed = await store.read('userdata');
  const revision = storedRevision(observed.document);
  if ((!observed.document && body.revision !== 0) || revision !== body.revision) throw new HttpError(409, '雲端資料版本已變更，請先備份本機內容並重新載入雲端資料。');
  const next = { ...(observed.document || structuredClone(USER_DEFAULTS)), ...patch, revision: body.revision + 1 };
  if (!await store.compareAndSwap('userdata', observed, next)) throw new HttpError(409, '雲端資料已被其他視窗更新，請先備份本機內容並重新載入雲端資料。');
  return { status: 'ok', revision: body.revision + 1 };
}
export async function loadWorld(store) {
  const { document } = await store.read('worldworkspaces');
  const revision = storedRevision(document);
  if (!validRevision(revision)) throw new HttpError(409, '雲端版本號無法辨識，請先保留原資料');
  return { revision, workspace: document?.workspace ?? null };
}
export async function saveWorld(store, body) {
  if (!record(body) || !hasExactly(body, ['revision', 'workspace']) || !strictInteger(body, 'revision') || !validRevision(body.revision)) fail('需要有效 revision 與完整 workspace');
  const workspace = validateWorkspace(body.workspace);
  const observed = await store.read('worldworkspaces');
  const existing = observed.document;
  if (existing) {
    try { validateWorkspace(existing.workspace ?? null); } catch { throw new HttpError(409, '雲端含較新或無法驗證的世界資料，已保留原件並停止覆寫'); }
    if (!validRevision(storedRevision(existing))) throw new HttpError(409, '雲端版本號無法辨識');
  }
  if ((!existing && body.revision !== 0) || storedRevision(existing) !== body.revision) throw new HttpError(409, '雲端世界版本已更新；本機進度仍保留');
  const next = { ...(existing || {}), workspace, revision: body.revision + 1 };
  if (!await store.compareAndSwap('worldworkspaces', observed, next)) throw new HttpError(409, '雲端世界已由另一個視窗建立或更新；兩份進度需先比較');
  return { status: 'ok', revision: body.revision + 1 };
}
