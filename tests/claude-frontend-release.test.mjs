import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedFile, checkEntries, verifyLiveAsset} from '../scripts/claude-frontend-release.mjs';
test('frontend pages and regular UI assets are allowed', () => {
  for (const file of ['backend/index.html','backend/static/css/chat-messenger.css','backend/static/js/chat-messenger.js','backend/static/art/new/portrait.webp']) assert.ok(allowedFile(file));
});
test('data, tools, workflow, credentials and traversal are blocked', () => {
  for (const file of ['backend/static/data/legends.json','backend/static/prompts/prompt.md','cloudflare/src/runtime.mjs','.github/workflows/evil.yml','package.json','backend/static/js/../data/a.js','backend/static/js/a\\b.js','backend/.env']) assert.equal(allowedFile(file), false, file);
});
test('symlinks, executable files, rename records and oversize assets are blocked', () => {
  for (const overrides of [{mode:'120000'},{mode:'100755'},{status:'R100'},{size:26*1024*1024}]) assert.throws(() => checkEntries([{path:'backend/index.html',status:'M',mode:'100644',size:1,...overrides}]));
});
test('whole diff must satisfy scope and volume checks', () => {
  assert.throws(() => checkEntries([{path:'backend/index.html',status:'M',mode:'100644',size:1},{path:'cloudflare/wrangler.jsonc',status:'M',mode:'100644',size:1}]));
  assert.throws(() => checkEntries(Array.from({length:201},(_,i)=>({path:`backend/static/js/${i}.js`,status:'A',mode:'100644',size:1}))));
  assert.equal(checkEntries([{path:'backend/static/js/old.js',status:'D',size:0}]).length,1);
});
test('propagation verification waits for actual new bytes', async () => {
  const responses = ['old edge asset', 'new asset'];
  let waits = 0;
  await verifyLiveAsset('backend/static/css/test.css', Buffer.from('new asset'), {
    fetchAsset: async () => new Response(responses.shift()), pause: async () => { waits++; }, attempts: 2,
  });
  assert.equal(waits, 1);
  assert.equal(responses.length, 0);
});
test('persistent wrong bytes fail instead of merging', async () => {
  let calls = 0;
  await assert.rejects(verifyLiveAsset('backend/index.html', Buffer.from('new'), {
    fetchAsset: async () => { calls++; return new Response('old'); }, pause: async () => {}, attempts: 3,
  }), /bounded propagation retries/);
  assert.equal(calls, 3);
});
