import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { TOKEN_TTL_SECONDS } from '../src/auth.mjs';

test('frontend retains current signed and legacy sessions, rejecting expired and future dates', async () => {
  const html = await readFile(new URL('../../backend/index.html', import.meta.url), 'utf8');
  const fn = html.match(/function isTokenValid\(token\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(fn);
  const now = 1791648000;
  const valid = vm.runInNewContext(`${fn}; isTokenValid`, {
    Date: { now: () => now * 1000 }, TOKEN_TTL_MS: TOKEN_TTL_SECONDS * 1000,
  });
  const signed = issued => `v1.${issued}.${'A'.repeat(43)}`;
  assert.equal(valid(signed(now)), true);
  assert.equal(valid(`legacy.${now}`), true);
  assert.equal(valid(`legacy.with.dot.${now}`), true);
  assert.equal(valid(signed(now - TOKEN_TTL_SECONDS)), true);
  assert.equal(valid(signed(now - TOKEN_TTL_SECONDS - 1)), false);
  assert.equal(valid(signed(now + 1)), false);
  assert.equal(valid(`v1.${now}.${'A'.repeat(42)}`), false);
  assert.equal(valid(`v2.${now}.${'A'.repeat(43)}`), false);
  assert.equal(valid(null), false);
  assert.equal(valid({}), false);
});
