import { HttpError, MAX_WORLD_BYTES, readJson, loadUserdata, saveUserdata, loadWorld, saveWorld } from './contracts.mjs';
import { D1DocumentStore, MAX_DOCUMENT_BYTES } from './d1-store.mjs';
import { createToken, verifyToken, secureEqual, rateKey } from './auth.mjs';
import { generateGemini, streamGemini } from './gemini.mjs';
import { serveLargeJson } from './static-assets.mjs';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
function cors(request, response, env) {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS || 'https://dynasty.piamamba.com,https://dynasty-ydov.onrender.com').split(',').map(value => value.trim());
  if (!origin || (!allowed.includes(origin) && origin !== new URL(request.url).origin)) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Allow-Credentials', 'true'); headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); headers.set('Access-Control-Allow-Headers', 'Content-Type, x-app-token'); headers.append('Vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export function createWorker({ store: injectedStore, fetcher = fetch, now = Date.now, staticHandler } = {}) {
  return {
    async fetch(request, env, context) {
      const path = new URL(request.url).pathname;
      let response;
      try {
        if (!path.startsWith('/api/')) {
          response = staticHandler ? await staticHandler(request, env, context) : await serveLargeJson(request, env) || (env.ASSETS ? await env.ASSETS.fetch(request) : new Response('Not found', { status: 404 }));
          return response;
        }
        if (request.method === 'OPTIONS') return cors(request, new Response(null, { status: 204 }), env);
        const known = ['/api/auth', '/api/userdata', '/api/world-workspace', '/api/gemini', '/api/gemini/stream', '/api/health'];
        if (!known.includes(path)) throw new HttpError(404, '找不到此 API');
        const methods = path === '/api/userdata' || path === '/api/world-workspace' ? ['GET', 'POST'] : path === '/api/health' ? ['GET'] : ['POST'];
        if (!methods.includes(request.method)) throw new HttpError(405, '不支援的請求方法');
        const getStore = () => injectedStore || new D1DocumentStore(env.DYNASTY_DB);
        if (path === '/api/health') {
          if (env.DYNASTY_DB) await env.DYNASTY_DB.prepare('SELECT 1 AS ready').first();
          response = json({ status: (injectedStore || env.DYNASTY_DB) && env.DATA_READY !== 'false' ? 'ok' : 'pending', version: '16.0', runtime: 'cloudflare-workers', storageReady: Boolean(injectedStore || env.DYNASTY_DB) && env.DATA_READY !== 'false' }, (injectedStore || env.DYNASTY_DB) && env.DATA_READY !== 'false' ? 200 : 503);
        } else if (path === '/api/auth') {
          await limit(request, 'auth', 5, env, getStore, now());
          const body = await readJson(request, 4096);
          if (!env.APP_SECRET) throw new HttpError(503, '登入服務尚未完成設定');
          if (!await secureEqual(body?.password, env.APP_SECRET)) throw new HttpError(401, '密碼錯誤');
          response = json({ token: await createToken(env.APP_SECRET, now()) });
        } else {
          await verifyToken(request.headers.get('x-app-token'), env.APP_SECRET, now());
          if (['/api/userdata', '/api/world-workspace'].includes(path) && env.DATA_READY === 'false') throw new HttpError(503, '資料搬遷尚未完成，請稍後重試');
          if (path === '/api/userdata') {
            const store = getStore();
            response = json(request.method === 'GET' ? await loadUserdata(store) : await saveUserdata(store, await readJson(request, MAX_DOCUMENT_BYTES)));
          } else if (path === '/api/world-workspace') {
            const store = getStore();
            response = json(request.method === 'GET' ? await loadWorld(store) : await saveWorld(store, await readJson(request, MAX_WORLD_BYTES, '世界資料超出 8 MiB，請先匯出部分存檔')));
          } else {
            await limit(request, path.endsWith('/stream') ? 'gemini-stream' : 'gemini', 20, env, getStore, now());
            const body = await readJson(request, MAX_WORLD_BYTES);
            response = path.endsWith('/stream') ? await streamGemini(env, body, fetcher, request.signal) : json(await generateGemini(env, body, fetcher, request.signal));
          }
        }
      } catch (error) {
        response = json({ detail: error instanceof HttpError ? error.detail : '服務暫時無法完成請求，請稍後重試' }, error instanceof HttpError ? error.status : 503);
      }
      return cors(request, response, env);
    },
  };
}
async function limit(request, scope, count, env, getStore, timestamp) {
  const key = await rateKey(request, scope, env.APP_SECRET);
  const binding = scope === 'auth' ? env.AUTH_RATE_LIMITER : env.AI_RATE_LIMITER;
  const allowed = binding ? (await binding.limit({ key })).success : await getStore().rateLimit(key, count, timestamp);
  if (!allowed) throw new HttpError(429, '操作過於頻繁，請稍候一分鐘再試');
}
export default createWorker();
