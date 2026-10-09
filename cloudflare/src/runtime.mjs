import { DurableObject } from 'cloudflare:workers';
import { createWorker } from './worker.mjs';
import { LARGE_JSON_PATHS, acceptsGzip, clientAcceptEncoding, serveLargeJson } from './static-assets.mjs';

// A Free Worker has a small CPU allowance. Keep multi-MiB document parsing,
// schema validation, chunking and signed auth inside a SQLite Durable Object,
// whose request CPU allowance is sufficient for these established contracts.
// D1 remains the authoritative persistent store; this object keeps no user data
// in memory across requests and does not change the storage/CAS semantics.
export class DynastyApi extends DurableObject {
  constructor(context, env) {
    super(context, env);
    this.environment = env;
    this.context = context;
    // Only identity archive requests are routed here. Enforce identity again
    // inside the object even if its subrequest no longer carries the client's
    // original cf.clientAcceptEncoding metadata.
    this.handler = createWorker({ staticHandler: async (request, bindings) => await serveLargeJson(request, bindings, { forceIdentity: true }) || new Response('Not found', { status: 404 }) });
  }
  fetch(request) { return this.handler.fetch(request, this.environment, this.context); }
}
const staticHandler = createWorker();
export default {
  async fetch(request, env, context) {
    const path = new URL(request.url).pathname;
    const identityArchive = LARGE_JSON_PATHS.has(path) && ['GET', 'HEAD'].includes(request.method) && !acceptsGzip(clientAcceptEncoding(request));
    if (path.startsWith('/api/') || identityArchive) {
      if (!env.DYNASTY_API) return new Response(JSON.stringify({ detail: 'API 服務尚未完成設定' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
      return env.DYNASTY_API.get(env.DYNASTY_API.idFromName('dynasty-api-v1')).fetch(request);
    }
    if (path === '/private-library.json') return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return staticHandler.fetch(request, env, context);
  },
};
