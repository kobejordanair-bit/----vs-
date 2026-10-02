(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DynastyHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TABLES = ['sources', 'persons', 'places', 'factions', 'events', 'claims', 'relations', 'routes', 'economy', 'disputes'];
  const PREFIXES = { sources: 'source', persons: 'person', places: 'place', factions: 'faction', events: 'event', claims: 'claim', relations: 'relation', routes: 'route', economy: 'economy', disputes: 'dispute' };
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const clone = value => JSON.parse(JSON.stringify(value));
  const sameValue = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && sameValue(a[key], b[key]));
  };
  function yearOrdinal(value) {
    if (!value || !['BCE', 'CE'].includes(value.era) || !Number.isInteger(value.year) || value.year < 1 || value.year > 9999) throw new Error('INVALID_YEAR');
    return value.era === 'BCE' ? 1 - value.year : value.year;
  }
  function timeBounds(time) {
    if (!time || time.precision === 'unknown' || !time.earliest || !time.latest) return null;
    return { start: yearOrdinal(time.earliest), end: yearOrdinal(time.latest) };
  }
  function formatYear(value) { return value ? (value.era === 'BCE' ? '公元前' : '公元') + value.year + '年' : '尚未換算'; }
  function formatTime(time) {
    if (time.precision === 'unknown') return '年代未定｜' + time.original;
    const label = formatYear(time.earliest) + (yearOrdinal(time.earliest) === yearOrdinal(time.latest) ? '' : '至' + formatYear(time.latest));
    return label + (time.review === 'source-checked' && time.normalization === 'modern-year' ? '' : '（換算範圍／待核）');
  }
  function timeMatch(time, year) {
    const ordinal = yearOrdinal(year);
    if (!time || time.precision === 'unknown') return 'unknown';
    if (ordinal < yearOrdinal(time.earliest) || ordinal > yearOrdinal(time.latest)) return 'outside';
    return time.precision === 'year' && time.review === 'source-checked' && time.normalization === 'modern-year' ? 'confirmed' : 'possible';
  }
  // This implements the exact keyword vocabulary used by our checked-in schema,
  // not arbitrary JSON Schema supplied by a user. References never use a network.
  function contractErrors(value, schema) {
    if (!schema || !schema.$defs) return ['缺少共用schema'];
    const errors = [];
    const metadata = new Set(['$schema', '$id', '$defs', 'title', 'description']);
    const supported = new Set(['$ref', 'anyOf', 'type', 'const', 'enum', 'required', 'additionalProperties', 'properties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum']);
    function walk(node, rule, at, sink, depth) {
      if (depth > 80) { sink.push(at + ': 結構過深'); return; }
      for (const key of Object.keys(rule)) if (!metadata.has(key) && !supported.has(key)) sink.push(at + ': 不支援schema關鍵字 ' + key);
      if (rule.$ref) {
        const name = rule.$ref.startsWith('#/$defs/') ? rule.$ref.slice(8) : '';
        if (!own(schema.$defs, name)) sink.push(at + ': schema參照錯誤');
        else walk(node, schema.$defs[name], at, sink, depth + 1);
        return;
      }
      if (rule.anyOf) {
        if (!rule.anyOf.some(option => { const attempt = []; walk(node, option, at, attempt, depth + 1); return attempt.length === 0; })) sink.push(at + ': 不符合允許的結構');
        return;
      }
      const type = Array.isArray(node) ? 'array' : node === null ? 'null' : typeof node;
      const matches = rule.type === 'integer' ? typeof node === 'number' && Number.isInteger(node) : !rule.type || type === rule.type;
      if (!matches) { sink.push(at + ': 應為 ' + rule.type); return; }
      if (own(rule, 'const') && node !== rule.const) sink.push(at + ': 版本／固定值錯誤');
      if (rule.enum && !rule.enum.includes(node)) sink.push(at + ': 不支援的值');
      if (typeof node === 'string') {
        const length = [...node].length;
        if (rule.minLength && length < rule.minLength) sink.push(at + ': 字串太短');
        if (rule.maxLength && length > rule.maxLength) sink.push(at + ': 字串太長');
        if (rule.pattern && !new RegExp(rule.pattern).test(node)) sink.push(at + ': 格式錯誤');
      }
      if (typeof node === 'number') {
        if (!Number.isFinite(node)) sink.push(at + ': 非有限數值');
        if (own(rule, 'minimum') && node < rule.minimum) sink.push(at + ': 低於下限');
        if (own(rule, 'maximum') && node > rule.maximum) sink.push(at + ': 超過上限');
      }
      if (Array.isArray(node)) {
        if (own(rule, 'minItems') && node.length < rule.minItems) sink.push(at + ': 項目不足');
        if (own(rule, 'maxItems') && node.length > rule.maxItems) sink.push(at + ': 項目過多');
        if (rule.items) node.forEach((item, i) => walk(item, rule.items, at + '[' + i + ']', sink, depth + 1));
      } else if (node && typeof node === 'object') {
        for (const key of rule.required || []) if (!own(node, key)) sink.push(at + ': 缺少 ' + key);
        for (const key of Object.keys(node)) {
          if (own(rule.properties || {}, key)) walk(node[key], rule.properties[key], at + '.' + key, sink, depth + 1);
          else if (rule.additionalProperties === false) sink.push(at + ': 未知欄位 ' + key);
        }
      }
    }
    walk(value, schema, '$', errors, 0);
    return errors;
  }
  function validatePackage(pkg, schema) {
    const errors = contractErrors(pkg, schema), warnings = [];
    if (errors.length) return { valid: false, errors, warnings, counts: {} };
    const all = new Map(), category = new Map(), counts = {};
    for (const table of TABLES) {
      counts[table] = pkg[table].length;
      for (const record of pkg[table]) {
        if (all.has(record.id)) errors.push('重複ID ' + record.id);
        if (!record.id.startsWith(PREFIXES[table] + ':')) errors.push('命名空間錯誤 ' + record.id);
        all.set(record.id, record); category.set(record.id, table);
      }
    }
    const typed = (id, types, at) => {
      if (!all.has(id)) errors.push(at + ': 懸空引用 ' + id);
      else if (types && !types.includes(category.get(id))) errors.push(at + ': 引用類型錯誤 ' + id);
    };
    function checkTime(time, at) {
      if (time.precision === 'unknown') {
        if (time.earliest !== null || time.latest !== null || time.normalization !== 'not-normalized') errors.push(at + ': 未知時間須保持null且未換算');
      } else if (!time.earliest || !time.latest) errors.push(at + ': 日期區間不完整');
      else {
        const start = yearOrdinal(time.earliest), end = yearOrdinal(time.latest);
        if (start > end) errors.push(at + ': 日期倒置');
        if (time.precision === 'year' && start !== end) errors.push(at + ': year精度卻跨年');
      }
    }
    if (yearOrdinal(pkg.coverage.window.start) > yearOrdinal(pkg.coverage.window.end)) errors.push('覆蓋區間倒置');
    for (const table of TABLES) for (const record of pkg[table]) {
      if (record.time) checkTime(record.time, record.id);
      if (record.claimIds) for (const claimId of record.claimIds) typed(claimId, ['claims'], record.id);
    }
    const entityTypes = ['persons', 'places', 'factions', 'events', 'relations', 'routes', 'economy'];
    for (const claim of pkg.claims) {
      typed(claim.subjectId, entityTypes, claim.id);
      claim.objectIds.forEach(id => typed(id, entityTypes, claim.id));
      for (const evidence of claim.evidence) typed(evidence.sourceId, ['sources'], claim.id);
      const evidenceLocations = new Set(claim.evidence.map(e => e.sourceId + '\u0000' + e.locator.trim().replace(/\s+/g, ' ')));
      if (claim.review === 'cross-checked' && evidenceLocations.size < 2) errors.push(claim.id + ': cross-checked缺少第二處不同位置的證據');
      if (claim.review === 'disputed' && claim.alternatives.length === 0) errors.push(claim.id + ': disputed缺少異說');
    }
    const touch = (claimId, entityId, at) => {
      const claim = all.get(claimId);
      if (category.get(claimId) === 'claims' && claim.subjectId !== entityId && !claim.objectIds.includes(entityId)) errors.push(at + ': 證據未連到 ' + entityId);
    };
    const libraryIds = new Set();
    for (const person of pkg.persons) {
      checkTime(person.life.birth, person.id + '.life.birth');
      checkTime(person.life.death, person.id + '.life.death');
      const birth = timeBounds(person.life.birth), death = timeBounds(person.life.death);
      if (birth && death && birth.start > death.end) errors.push(person.id + ': 生卒年倒置');
      if ((person.libraryRefs.length > 0) !== (person.coverage === 'linked-library')) errors.push(person.id + ': 原庫連結狀態不一致');
      for (const link of person.libraryRefs) {
        if (libraryIds.has(link.recordId)) errors.push('原庫ID被多個人物使用 ' + link.recordId);
        libraryIds.add(link.recordId);
      }
      person.claimIds.forEach(claimId => touch(claimId, person.id, person.id));
    }
    for (const place of pkg.places) {
      if (place.coordinates && ['unlocated', 'regional'].includes(place.locationPrecision)) errors.push(place.id + ': 座標與精度不一致');
      if (place.locationPrecision === 'documented-point' && !place.coordinates) errors.push(place.id + ': 精確定位缺座標');
      if (place.coordinates && !place.claimIds.some(id => all.get(id)?.epistemic === 'modern-identification')) errors.push(place.id + ': 座標缺現代定位依據');
      place.claimIds.forEach(claimId => touch(claimId, place.id, place.id));
    }
    for (const faction of pkg.factions) {
      faction.leaderIds.forEach(id => typed(id, ['persons'], faction.id));
      faction.claimIds.forEach(id => touch(id, faction.id, faction.id));
    }
    for (const event of pkg.events) {
      event.placeIds.forEach(id => typed(id, ['places'], event.id));
      event.claimIds.forEach(id => touch(id, event.id, event.id));
      event.orderAfter.forEach(id => typed(id, ['events'], event.id));
      const eventBounds = timeBounds(event.time);
      if (eventBounds && (eventBounds.start < yearOrdinal(pkg.coverage.window.start) || eventBounds.end > yearOrdinal(pkg.coverage.window.end))) errors.push(event.id + ': 事件超出宣告範圍');
      const participants = new Set();
      for (const context of event.contexts) {
        typed(context.personId, ['persons'], event.id);
        if (context.factionId) typed(context.factionId, ['factions'], event.id);
        if (participants.has(context.personId)) errors.push(event.id + ': 人物context重複');
        participants.add(context.personId);
        const person = category.get(context.personId) === 'persons' ? all.get(context.personId) : null;
        if (person && eventBounds && ['present', 'reported-action'].includes(context.participation)) {
          const birth = timeBounds(person.life.birth), death = timeBounds(person.life.death);
          if (birth && eventBounds.end < birth.start) errors.push(event.id + ': 實際行動早於該人物記錄的出生區間');
          if (death && eventBounds.start > death.end) errors.push(event.id + ': 實際行動晚於該人物記錄的死亡區間');
        }
        for (const id of context.claimIds) { typed(id, ['claims'], event.id); touch(id, context.personId, event.id); }
        const requiredIds = [context.personId, event.id, ...(context.factionId ? [context.factionId] : [])];
        if (!context.claimIds.some(id => {
          const claim = all.get(id);
          return category.get(id) === 'claims' && ['event-role', 'role-at-event'].includes(claim.predicate) && requiredIds.every(entityId => claim.subjectId === entityId || claim.objectIds.includes(entityId));
        })) errors.push(event.id + ': 角色證據須連到本人、當前事件與所列勢力');
      }
    }
    // Kahn's algorithm keeps long valid chains independent of input array order
    // and avoids a recursion stack limit when importing larger historical slices.
    const predecessors = new Map(pkg.events.map(event => [event.id, 0]));
    const successors = new Map(pkg.events.map(event => [event.id, []]));
    for (const event of pkg.events) for (const id of event.orderAfter) {
      if (category.get(id) !== 'events') continue;
      const currentBounds = timeBounds(event.time), previousBounds = timeBounds(all.get(id).time);
      if (currentBounds && previousBounds && previousBounds.start > currentBounds.end) errors.push(event.id + ': 先後與日期完全衝突');
      predecessors.set(event.id, predecessors.get(event.id) + 1);
      successors.get(id).push(event.id);
    }
    const ready = pkg.events.filter(event => predecessors.get(event.id) === 0).map(event => event.id);
    for (let i = 0; i < ready.length; i++) for (const id of successors.get(ready[i])) {
      predecessors.set(id, predecessors.get(id) - 1);
      if (predecessors.get(id) === 0) ready.push(id);
    }
    if (ready.length !== pkg.events.length) errors.push('事件先後形成環');
    for (const relation of pkg.relations) {
      typed(relation.fromId, ['persons', 'places', 'factions'], relation.id);
      typed(relation.toId, ['persons', 'places', 'factions'], relation.id);
      if (relation.scope === 'event') {
        if (!relation.eventId) errors.push(relation.id + ': 事件關係缺事件');
        else {
          typed(relation.eventId, ['events'], relation.id);
          const event = all.get(relation.eventId);
          if (category.get(relation.eventId) === 'events' && !sameValue(event.time, relation.time)) errors.push(relation.id + ': 事件關係時間與事件不一致');
        }
      } else if (relation.eventId !== null) errors.push(relation.id + ': 區間關係不應借事件ID代替時間證據');
      for (const id of relation.claimIds) { touch(id, relation.fromId, relation.id); touch(id, relation.toId, relation.id); }
    }
    for (const route of pkg.routes) {
      typed(route.fromPlaceId, ['places'], route.id); typed(route.toPlaceId, ['places'], route.id);
      if (route.fromPlaceId === route.toPlaceId) errors.push(route.id + ': 路線端點相同');
      if (route.eventId) typed(route.eventId, ['events'], route.id);
      for (const id of route.claimIds) { touch(id, route.fromPlaceId, route.id); touch(id, route.toPlaceId, route.id); }
    }
    for (const item of pkg.economy) {
      item.placeIds.forEach(id => typed(id, ['places'], item.id));
      item.personIds.forEach(id => typed(id, ['persons'], item.id));
      item.claimIds.forEach(id => touch(id, item.id, item.id));
      for (const quantity of item.quantities) quantity.claimIds.forEach(id => { typed(id, ['claims'], item.id); touch(id, item.id, item.id); });
    }
    for (const dispute of pkg.disputes) if (!dispute.claimIds.some(id => ['disputed', 'provisional'].includes(all.get(id)?.review))) errors.push(dispute.id + ': 未指向爭議或待核主張');
    const unclear = pkg.events.filter(e => e.time.review !== 'source-checked' || e.time.precision !== 'year').length;
    if (unclear) warnings.push(unclear + '件事件的現代年份為保守區間／待核，不能當精確公曆');
    if (pkg.places.some(p => !p.coordinates)) warnings.push('地點未完成精確現代定位；示意排列不能計算距離');
    warnings.push('本包是選定事件切片，缺少記錄不能證明歷史上不存在。');
    return { valid: errors.length === 0, errors, warnings, counts };
  }
  function createIndex(pkg, schema) {
    const validation = validatePackage(pkg, schema);
    if (!validation.valid) { const error = new Error('INVALID_HISTORY_PACKAGE: ' + validation.errors.slice(0, 5).join('；')); error.details = validation; throw error; }
    const data = clone(pkg), byId = new Map();
    for (const table of TABLES) data[table].forEach(record => byId.set(record.id, record));
    const copy = value => value === undefined ? null : clone(value);
    return {
      validation: copy(validation), package: copy(data),
      get: id => copy(byId.get(id)),
      eventsAt(year, filters = {}) {
        yearOrdinal(year);
        return data.events.filter(event => {
          const match = timeMatch(event.time, year);
          if (match === 'outside' || (match === 'unknown' && !filters.includeUnknown)) return false;
          if (filters.personId && !event.contexts.some(c => c.personId === filters.personId)) return false;
          if (filters.placeId && !event.placeIds.includes(filters.placeId)) return false;
          if (filters.factionId && !event.contexts.some(c => c.factionId === filters.factionId)) return false;
          return true;
        }).map(event => ({ ...copy(event), yearMatch: timeMatch(event.time, year) }));
      },
      evidence(claimIds) {
        return claimIds.map(id => byId.get(id)).filter(c => c && c.id.startsWith('claim:')).map(claim => ({ ...copy(claim), sources: claim.evidence.map(e => ({ ...copy(e), source: copy(byId.get(e.sourceId)) })) }));
      },
      assessCast(eventId, personIds) {
        const event = byId.get(eventId);
        if (!event || !eventId.startsWith('event:')) throw new Error('INVALID_EVENT');
        if (!Array.isArray(personIds) || new Set(personIds).size !== personIds.length) throw new Error('INVALID_CAST');
        return personIds.map(id => {
          const person = byId.get(id);
          if (!person || !id.startsWith('person:')) throw new Error('INVALID_PERSON');
          const context = event.contexts.find(c => c.personId === id);
          const eventBounds = timeBounds(event.time), birth = timeBounds(person.life.birth), death = timeBounds(person.life.death);
          const outsideLife = eventBounds && ((birth && eventBounds.end < birth.start) || (death && eventBounds.start > death.end));
          return { person: copy(person), context: copy(context),
            status: context?.participation === 'mentioned' ? 'mentioned-only' : outsideLife ? 'outside-recorded-lifespan' : !context ? 'not-documented' : context.participation === 'unknown' ? 'uncertain' : 'documented-participation',
            message: context?.participation === 'mentioned' ? '原文在此事件提及此人；不表示本人在場。' : outsideLife ? '事件年代與本包已記錄的生卒區間不相容；自由編排須另標架空。' : !context ? '本事件未列此人；不能據此判定不可能參與。' : context.participation === 'unknown' ? '本事件的參與方式尚待確認；不能判為已在場。' : '本事件有參與／行動記述；不等於所有人物同處一室。' };
        });
      },
      originalRecords(personId, library) {
        const person = byId.get(personId);
        if (!person || !personId.startsWith('person:')) throw new Error('INVALID_PERSON');
        if (!Array.isArray(library)) throw new Error('INVALID_LIBRARY');
        return person.libraryRefs.map(link => {
          const matches = library.filter(record => record.id === link.recordId && record.name === link.name && record.type === link.type);
          return { link: copy(link), status: matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : 'missing', record: matches.length === 1 ? copy(matches[0]) : null };
        });
      }
    };
  }
  const LIBRARY_FIELDS = ['id', 'name', 'type', 'rank', 'title', 'tag', 'desc', 'poem', 'dynasty', 'analysis', 'deepAnalysis', 'soulEssence', 'stats'];
  function generateLegacyId(type, name) { let h = 0; for (const c of type + '_' + name) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0; return type + '_' + name + '_' + Math.abs(h); }
  function parseLibrary(input, baseRecords = []) {
    if (typeof input !== 'string' || input.length > 30_000_000) throw new Error('INVALID_LIBRARY_SIZE');
    let parsed; try { parsed = JSON.parse(input.replace(/^\uFEFF/, '')); } catch { throw new Error('INVALID_LIBRARY_JSON'); }
    let records;
    if (Array.isArray(parsed)) records = parsed;
    else if (parsed && Array.isArray(parsed.customLegends) && parsed.modifiedLegends && typeof parsed.modifiedLegends === 'object' && !Array.isArray(parsed.modifiedLegends)) {
      records = [...baseRecords, ...parsed.customLegends].map(record => {
        const id = record.id || generateLegacyId(record.type, record.name);
        const mod = own(parsed.modifiedLegends, id) ? parsed.modifiedLegends[id] : null;
        return { ...record, id, ...(mod && typeof mod === 'object' && !Array.isArray(mod) ? mod : {}), id };
      });
    } else if (parsed && Array.isArray(parsed.characters)) records = parsed.characters;
    else throw new Error('UNSUPPORTED_LIBRARY_FORMAT');
    if (records.length > 20000) throw new Error('INVALID_LIBRARY_SIZE');
    const seen = new Set();
    return records.map(record => {
      if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id || typeof record.name !== 'string' || !record.name || !['emperor', 'general', 'minister'].includes(record.type)) throw new Error('INVALID_LIBRARY_RECORD');
      if (seen.has(record.id)) throw new Error('DUPLICATE_LIBRARY_ID');
      seen.add(record.id);
      const clean = {};
      for (const field of LIBRARY_FIELDS) {
        if (!own(record, field)) continue;
        if (field === 'stats') {
          if (Array.isArray(record.stats) && record.stats.length === 5 && record.stats.every(v => Number.isFinite(v) && v >= 0 && v <= 100)) clean.stats = record.stats.slice();
        } else if (typeof record[field] === 'string' && record[field].length <= 100000) clean[field] = record[field];
      }
      return clean;
    });
  }
  return { validatePackage, contractErrors, createIndex, yearOrdinal, formatYear, formatTime, timeMatch, parseLibrary };
});
