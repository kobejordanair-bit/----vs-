import { HttpError, record } from './contracts.mjs';
export const PRIMARY_MODEL = 'gemini-2.5-pro';
export const FALLBACK_MODEL = 'gemini-3-flash-preview';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
export function chatContents(body) {
  if (!record(body) || !Array.isArray(body.contents) || (Object.hasOwn(body, 'is_json') && typeof body.is_json !== 'boolean')) throw new HttpError(422, '需要有效 contents 與 is_json');
  const contents = [];
  for (const message of body.contents) {
    if (!record(message)) throw new HttpError(422, '對話內容格式不正確');
    const first = message.parts?.[0];
    if (!record(first) || !first.text) continue;
    if (typeof first.text !== 'string' || !Object.hasOwn(message, 'role')) throw new HttpError(422, '對話內容格式不正確');
    contents.push({ role: message.role === 'user' ? 'user' : 'model', parts: [{ text: first.text }] });
  }
  if (!contents.length) throw new HttpError(400, '對話內容不能為空');
  return contents;
}
class ProviderError extends HttpError {
  constructor(status) { super(status === 429 ? 429 : 502, status === 429 ? 'AI 服務繁忙，請稍後重試' : 'AI 服務暫時無法使用，請稍後重試'); this.providerStatus = status; }
}
function requestPayload(contents, json) {
  return { contents, ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}) };
}
async function providerRequest(fetcher, key, model, payload, stream, signal) {
  let response;
  try {
    response = await fetcher(`${BASE_URL}${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload), signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ProviderError(502);
  }
  if (!response.ok) { await response.body?.cancel(); throw new ProviderError(response.status); }
  return response;
}
async function openProvider(env, body, stream, fetcher, signal) {
  if (!env.GOOGLE_API_KEY) throw new HttpError(503, 'AI 服務尚未完成設定');
  const contents = chatContents(body);
  const payload = requestPayload(contents, Boolean(body.is_json));
  const primary = env.GEMINI_PRIMARY_MODEL || PRIMARY_MODEL, fallback = env.GEMINI_FALLBACK_MODEL || FALLBACK_MODEL;
  try { return { response: await providerRequest(fetcher, env.GOOGLE_API_KEY, primary, payload, stream, signal), model: primary }; }
  catch (error) {
    if (![429, 503].includes(error.providerStatus)) throw error;
    return { response: await providerRequest(fetcher, env.GOOGLE_API_KEY, fallback, payload, stream, signal), model: fallback };
  }
}
function visibleText(value) {
  return (value.candidates?.[0]?.content?.parts || []).filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('');
}
function checkResult(value) {
  if (!record(value)) throw new ProviderError(502);
  if (value.error) throw new ProviderError(Number(value.error.code) || 502);
  if (value.promptFeedback?.blockReason) throw new HttpError(422, 'AI 無法回應這段內容，請調整提問後重試');
  const finish = value.candidates?.[0]?.finishReason;
  if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(finish)) throw new HttpError(422, 'AI 無法完成這段內容，請調整提問後重試');
}
function requireComplete(reason) {
  if (reason === 'STOP') return;
  throw new HttpError(502, reason === 'MAX_TOKENS' ? 'AI 回覆達到長度上限，內容尚未完成；請保留已產生文字並縮短要求後重試' : 'AI 回覆尚未完整結束，請保留已產生內容後重試');
}
export async function generateGemini(env, body, fetcher = fetch, signal) {
  const opened = await openProvider(env, body, false, fetcher, signal);
  let result; try { result = await opened.response.json(); } catch { throw new ProviderError(502); }
  checkResult(result);
  requireComplete(result.candidates?.[0]?.finishReason);
  const text = visibleText(result);
  if (!text) throw new HttpError(502, 'AI 沒有產生可顯示的內容，請稍後重試');
  return { result: text, model: opened.model };
}
async function* upstreamEvents(response) {
  if (!response.body) throw new ProviderError(502);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', lines = [];
  const event = () => {
    if (!lines.length) return null;
    const payload = lines.join('\n'); lines = [];
    if (payload === '[DONE]') return null;
    try { return JSON.parse(payload); } catch { throw new ProviderError(502); }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, boundary).replace(/\r$/, ''); buffer = buffer.slice(boundary + 1);
        if (line === '') { const parsed = event(); if (parsed) yield parsed; }
        else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
      }
      if (buffer.length > 2 * 1024 * 1024) throw new ProviderError(502);
      if (done) break;
    }
    if (buffer.startsWith('data:')) lines.push(buffer.slice(5).replace(/^ /, ''));
    const parsed = event(); if (parsed) yield parsed;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function streamGemini(env, body, fetcher = fetch, signal) {
  // Open first so authentication, quotas, and unavailable models return normal
  // HTTP errors before a successful SSE response is committed.
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  let opened;
  try { opened = await openProvider(env, body, true, fetcher, controller.signal); }
  catch (error) { signal?.removeEventListener('abort', abort); throw error; }
  const encoder = new TextEncoder();
  const events = upstreamEvents(opened.response)[Symbol.asyncIterator]();
  let initial = true, produced = false, finished = false, finishReason;
  const source = new ReadableStream({
    async pull(stream) {
      if (finished) return;
      const send = value => stream.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      if (initial) { initial = false; send({ model: opened.model }); return; }
      try {
        for (;;) {
          const next = await events.next();
          if (next.done) {
            if (!produced) throw new HttpError(502, 'AI 沒有產生可顯示的內容，請稍後重試');
            requireComplete(finishReason);
            finished = true; stream.enqueue(encoder.encode('data: [DONE]\n\n')); stream.close(); signal?.removeEventListener('abort', abort); return;
          }
          checkResult(next.value);
          if (next.value.candidates?.[0]?.finishReason) finishReason = next.value.candidates[0].finishReason;
          const text = visibleText(next.value);
          if (text) { produced = true; send({ text }); return; }
        }
      } catch (error) {
        finished = true;
        send({ error: error instanceof HttpError ? error.detail : 'AI 串流中斷，請保留已產生內容後重試' });
        stream.close(); controller.abort(); await events.return?.(); signal?.removeEventListener('abort', abort);
      }
    },
    async cancel() { finished = true; controller.abort(); await events.return?.(); signal?.removeEventListener('abort', abort); },
  });
  return new Response(source, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no' } });
}
