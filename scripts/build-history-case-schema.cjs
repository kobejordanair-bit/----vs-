'use strict';
// Portable authoring schema. Semantic references and answer sets are also checked by validateCases.
const fs = require('node:fs');
const path = require('node:path');
const text = { type: 'string', minLength: 1, maxLength: 10000 };
const id = prefix => ({ type: 'string', pattern: '^' + prefix + ':[a-z0-9][a-z0-9-]*$', maxLength: 200 });
const ref = name => ({ $ref: '#/$defs/' + name });
const list = (items, minItems = 0, maxItems = 500) => ({ type: 'array', items, minItems, maxItems });
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const choiceId = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 80 };
const claims = list(id('claim'), 1);
const task = {
  id: id('task'), chapterId: id('chapter'), prompt: text,
  choices: list(ref('Choice'), 2, 20), explanation: text, claimIds: claims, hint: text
};
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://dynasty.local/schemas/history-casebook-v1.json',
  title: '王侯將相史論案卷契約 v1',
  ...object({
    format: { const: 'dynasty-history-casebook', type: 'string' }, schemaVersion: { const: 1, type: 'integer' },
    id: id('casebook'), version: { ...text, maxLength: 80 }, title: text, introduction: text,
    packageId: id('history'), packageVersion: { ...text, maxLength: 80 }, cases: list(ref('Case'), 1, 50)
  }),
  $defs: {
    Choice: object({ id: choiceId, label: { ...text, maxLength: 2000 }, feedback: text, claimIds: claims }),
    Task: { anyOf: [
      object({ ...task, type: { const: 'single-choice', type: 'string' }, expectedChoiceIds: list(choiceId, 1, 1) }),
      object({ ...task, type: { const: 'multi-choice', type: 'string' }, expectedChoiceIds: list(choiceId, 1, 20) }),
      object({ ...task, type: { const: 'sequence', type: 'string' }, acceptableOrders: list(list(choiceId, 2, 20), 1, 30) })
    ] },
    Chapter: object({ id: id('chapter'), title: { ...text, maxLength: 1000 }, intro: text, claimIds: list(id('claim')), taskIds: list(id('task'), 1, 50) }),
    Perspective: object({ personId: id('person'), framing: text, claimIds: claims, analysisPrompt: text }),
    Finale: object({ prompt: text, reflectionPrompts: list({ ...text, maxLength: 2000 }, 0, 20), closingNote: text,
      minimumClaimMaterials: integer(0, 50), minimumOriginalMaterials: integer(0, 50),
      minimumThesisLength: integer(0, 10000), minimumCounterargumentLength: integer(0, 10000), minimumUncertaintyLength: integer(0, 10000) }),
    Case: object({ id: id('case'), order: integer(1, 10000), title: text, subtitle: text, theme: text,
      difficulty: { type: 'string', enum: ['入門', '進階'] }, estimatedMinutes: integer(1, 240), premise: text, inquiry: text,
      eventIds: list(id('event'), 1), personIds: list(id('person'), 1), claimIds: claims,
      chapters: list(ref('Chapter'), 1, 20), tasks: list(ref('Task'), 1, 50), perspectives: list(ref('Perspective'), 0, 30), finale: ref('Finale') })
  }
};
const destination = path.join(__dirname, '../schemas/history-casebook.schema.json');
fs.writeFileSync(destination, JSON.stringify(schema, null, 2) + '\n', 'utf8');
console.log('Saved ' + path.relative(process.cwd(), destination));
