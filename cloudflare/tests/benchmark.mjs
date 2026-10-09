// Synthetic data only. This is a local CPU comparison, not proof of a cloud
// account's CPU quota or deployment latency. Run: node --expose-gc tests/benchmark.mjs
import { performance } from 'node:perf_hooks';
import { strictJsonParse, userSnapshot } from '../src/contracts.mjs';
import { splitUtf8 } from '../src/d1-store.mjs';
const document = { revision: 42, modifiedLegends: Object.fromEntries(Array.from({ length: 403 }, (_, index) => [`record-${index}`, { deepAnalysis: '歷史人物的原始深度分析😀'.repeat(350), soulEssence: '完整人物解讀' }])), soulSession: { chapters: [{ content: '持續保存原文' }] } };
const source = JSON.stringify(document);
const phases = {
  strictIncomingJson: () => strictJsonParse(source),
  trustedStoredJson: () => JSON.parse(source),
  storedParseAndSnapshot: () => userSnapshot(JSON.parse(source)),
  stringifyAndByteChunk: () => splitUtf8(JSON.stringify(document)),
};
const results = {};
for (const [name, operation] of Object.entries(phases)) {
  for (let warmup = 0; warmup < 3; warmup++) operation();
  const measurements = [];
  for (let run = 0; run < 12; run++) {
    globalThis.gc?.(); const started = performance.now(), cpu = process.cpuUsage(); operation();
    const spent = process.cpuUsage(cpu); measurements.push({ wallMs: performance.now() - started, cpuMs: (spent.user + spent.system) / 1000 });
  }
  const sorted = field => measurements.map(item => item[field]).sort((one, two) => one - two);
  results[name] = { wallP50Ms: Number(sorted('wallMs')[6].toFixed(2)), cpuP50Ms: Number(sorted('cpuMs')[6].toFixed(2)), cpuP95Ms: Number(sorted('cpuMs')[11].toFixed(2)) };
}
console.log(JSON.stringify({ synthetic: true, modifiedCharacters: 403, bytes: new TextEncoder().encode(source).length, chunkCount: splitUtf8(source).length, measurements: results, limitation: 'Local Node CPU measurements cannot guarantee the Workers Free 10 ms CPU limit; API processing runs in the SQLite Durable Object.' }, null, 2));
