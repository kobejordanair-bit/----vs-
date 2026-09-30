'use strict';
// The contract deliberately uses a small, portable JSON Schema vocabulary.
const fs = require('node:fs');
const path = require('node:path');
const text = { type: 'string', minLength: 1, maxLength: 6000 };
const nullableText = { anyOf: [text, { type: 'null' }] };
const ref = name => ({ $ref: '#/$defs/' + name });
const list = item => ({ type: 'array', items: item, maxItems: 20000 });
const choice = values => ({ type: 'string', enum: values });
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const id = { type: 'string', pattern: '^[a-z][a-z-]*:[a-z0-9][a-z0-9-]*$', maxLength: 160 };
const ids = list(id);
const defs = {
  Year: object({ era: choice(['BCE', 'CE']), year: { type: 'integer', minimum: 1, maximum: 9999 } }),
  Time: object({
    earliest: { anyOf: [ref('Year'), { type: 'null' }] }, latest: { anyOf: [ref('Year'), { type: 'null' }] },
    precision: choice(['year', 'range', 'unknown']), original: text,
    normalization: choice(['modern-year', 'regnal-year-band', 'not-normalized']),
    review: choice(['source-checked', 'provisional', 'disputed']), note: text
  }),
  Source: object({ id, work: text, section: text, author: text,
    kind: choice(['primary-text', 'research', 'institutional-reference']),
    url: { type: 'string', pattern: '^https?://', maxLength: 2000 }, versionUrl: nullableText,
    accessedOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    verification: choice(['opened-and-read']), editionNote: text, reuseNote: text, limitations: text }),
  Evidence: object({ sourceId: id, locator: text, excerpt: nullableText,
    use: choice(['direct-statement', 'cross-check', 'chronology-context']) }),
  Claim: object({ id, subjectId: id, predicate: { type: 'string', pattern: '^[a-z][a-z0-9-]*$', maxLength: 80 }, objectIds: ids,
    statement: text, time: ref('Time'), epistemic: choice(['source-report', 'editorial-synthesis', 'modern-identification']),
    evidence: { ...list(ref('Evidence')), minItems: 1 },
    review: choice(['source-checked', 'cross-checked', 'disputed', 'provisional']),
    caveat: text, alternatives: list(text) }),
  LibraryRef: object({ recordId: { type: 'string', minLength: 1, maxLength: 200 },
    name: text, type: choice(['emperor', 'general', 'minister']),
    match: choice(['manual-identity-match']), note: text }),
  Person: object({ id, name: text, aliases: list(text), libraryRefs: list(ref('LibraryRef')),
    life: object({ birth: ref('Time'), death: ref('Time') }),
    coverage: choice(['linked-library', 'context-only']), claimIds: { ...ids, minItems: 1 },
    note: text }),
  Coordinates: object({ longitude: { type: 'number', minimum: -180, maximum: 180 },
    latitude: { type: 'number', minimum: -90, maximum: 90 } }),
  Place: object({ id, name: text, aliases: list(text),
    kind: choice(['region', 'city', 'pass', 'site', 'battle-area', 'river', 'route-area']),
    coordinates: { anyOf: [ref('Coordinates'), { type: 'null' }] },
    locationPrecision: choice(['unlocated', 'regional', 'approximate', 'documented-point']),
    modernIdentification: nullableText, claimIds: { ...ids, minItems: 1 }, note: text }),
  Faction: object({ id, name: text, aliases: list(text),
    kind: choice(['kingdom', 'coalition', 'imperial-government', 'regional-regime']),
    time: ref('Time'), leaderIds: ids, claimIds: { ...ids, minItems: 1 }, note: text }),
  Context: object({ personId: id, factionId: { anyOf: [id, { type: 'null' }] },
    role: text, participation: choice(['present', 'reported-action', 'mentioned', 'unknown']),
    claimIds: { ...ids, minItems: 1 }, note: text }),
  Event: object({ id, title: text, summary: text, time: ref('Time'),
    placeIds: { ...ids, minItems: 1 }, contexts: { ...list(ref('Context')), minItems: 1 },
    claimIds: { ...ids, minItems: 1 }, orderAfter: ids, orderingNote: text, note: text }),
  Relation: object({ id, fromId: id, toId: id,
    type: choice(['serves', 'cooperates', 'opposes', 'controls', 'advises', 'recommends', 'kinship', 'negotiates']),
    scope: choice(['event', 'interval']), eventId: { anyOf: [id, { type: 'null' }] },
    time: ref('Time'), claimIds: { ...ids, minItems: 1 }, note: text }),
  Route: object({ id, fromPlaceId: id, toPlaceId: id,
    kind: choice(['reported-movement', 'reported-supply']), eventId: { anyOf: [id, { type: 'null' }] },
    time: ref('Time'), distanceKm: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
    claimIds: { ...ids, minItems: 1 }, note: text }),
  Quantity: object({ value: { type: 'number' }, unit: text,
    status: choice(['source-reported', 'research-estimate']), claimIds: { ...ids, minItems: 1 }, note: text }),
  Economy: object({ id, title: text, kind: choice(['supply', 'administration', 'transport', 'distribution']),
    placeIds: { ...ids, minItems: 1 }, personIds: ids, time: ref('Time'), mechanism: text,
    quantities: list(ref('Quantity')), claimIds: { ...ids, minItems: 1 }, note: text }),
  Dispute: object({ id, title: text, claimIds: { ...ids, minItems: 1 },
    treatment: choice(['retain-alternatives', 'range-only', 'not-normalized', 'outside-scope']), note: text }),
  Coverage: object({ target: text, window: object({ start: ref('Year'), end: ref('Year') }),
    completeness: choice(['curated-slice']), selection: list(text), excluded: list(text),
    missing: list(text), datePolicy: text, geographyPolicy: text, economyPolicy: text }),
  Snapshot: object({ date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    totalRecords: { type: 'integer', minimum: 0 }, roleIdentityPolicy: text,
    privateTextPolicy: text })
};
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://dynasty.local/schemas/history-package-v1.json',
  title: '王侯將相共用歷史資料包 v1',
  ...object({ format: choice(['dynasty-history-package']), schemaVersion: { type: 'integer', const: 1 },
    packageId: id, packageVersion: text, title: text, locale: choice(['zh-Hant']),
    createdOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    coverage: ref('Coverage'), librarySnapshot: ref('Snapshot'),
    sources: { ...list(ref('Source')), minItems: 1 }, persons: { ...list(ref('Person')), minItems: 1 },
    places: { ...list(ref('Place')), minItems: 1 }, factions: { ...list(ref('Faction')), minItems: 1 },
    events: { ...list(ref('Event')), minItems: 1 }, claims: { ...list(ref('Claim')), minItems: 1 },
    relations: list(ref('Relation')), routes: list(ref('Route')), economy: list(ref('Economy')),
    disputes: list(ref('Dispute')) }),
  $defs: defs
};
const destination = path.join(__dirname, '../schemas/history-package.schema.json');
fs.writeFileSync(destination, JSON.stringify(schema, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(__dirname, '../backend/static/data/history/schema.v1.json'), JSON.stringify(schema, null, 2) + '\n', 'utf8');
console.log('Saved ' + path.relative(process.cwd(), destination));
