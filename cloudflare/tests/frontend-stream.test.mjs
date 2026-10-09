import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../backend/index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('async function _callGeminiStream('), html.indexOf('async function callGemini(', html.indexOf('async function _callGeminiStream(')));
function setup(events, chunks = [events]) {
  const emitted = [];
  const context = vm.createContext({
    BACKEND_URL: 'https://example.test', APP_TOKEN: 'test', TextDecoder,
    cloneState: value => structuredClone(value), prepareWorldRequestContents: async value => value,
    fetch: async () => ({ ok: true, body: new ReadableStream({ start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    } }) }),
  });
  vm.runInContext(source, context);
  return { run: () => context._callGeminiStream('test', text => emitted.push(text)), emitted };
}

test('UTF-8 streaming output and terminal marker survive split events', async () => {
  const fixture = setup('', ['data: {"model":"gemini-2.5-pro"}\n\ndata: {"te', 'xt":"王侯"}\n\ndata:{"text":"將相"}\n\ndata: [DONE]']);
  assert.equal(await fixture.run(), '王侯將相');
  assert.deepEqual(fixture.emitted, ['王侯', '王侯將相']);
});

test('upstream error rejects and keeps partial output', async () => {
  const fixture = setup('data: {"text":"已收到"}\n\ndata: {"error":"AI 服務暫時中斷"}\n\n');
  await assert.rejects(fixture.run(), /AI 服務暫時中斷/);
  assert.deepEqual(fixture.emitted, ['已收到']);
});

test('truncated connection cannot be reported as complete', async () => {
  await assert.rejects(setup('data: {"text":"部分回覆"}\n\n').run(), /回覆尚未完成/);
});

test('malformed event cannot silently produce undefined text', async () => {
  await assert.rejects(setup('data: {broken}\n\ndata: [DONE]\n\n').run(), /回覆格式損壞/);
});
