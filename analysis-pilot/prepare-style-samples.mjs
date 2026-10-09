import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { sourceUserdata, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { loadBaseLibrary } from '../cloudflare/scripts/audit-counts.mjs';
const source = sourceUserdata(JSON.parse(await readFile(new URL('../cloudflare/private/pilot-preflight-live.private.json', import.meta.url), 'utf8')));
const { base } = await loadBaseLibrary();
const figures = [...base, ...source.customLegends].map(item => ({ ...item, ...source.modifiedLegends[item.id], id: item.id }));
const ranking = figures.map(({id,name,type,rank})=>({id,name,type,rank}));
await writeFile(new URL('./ranking-reference.v1.json',import.meta.url),JSON.stringify({total:ranking.length,figures:ranking},null,2)+'\n',{flag:'wx'});
const targets = new Set(['emperor_北魏孝文帝_33257620','general_王翦_306401394','minister_姚崇_2003901767']);
const names = ['唐太宗','秦始皇','漢武帝','韓信','白起','岳飛','諸葛亮','管仲','張居正'];
const dir = new URL('./style-samples/', import.meta.url); await mkdir(dir,{recursive:true});
const index = [];
for (const field of ['deepAnalysis','analysis','soulEssence']) for (const type of ['emperor','general','minister']) {
  const candidates = figures.filter(f=>f.type===type && !targets.has(f.id) && typeof f[field]==='string' && f[field].trim().length>300);
  candidates.sort((a,b)=>(names.includes(a.name)?names.indexOf(a.name):1000)-(names.includes(b.name)?names.indexOf(b.name):1000));
  const f=candidates[0]; if(!f)continue;
  const file=`${type}.${field}.md`;
  const text=`# 網站既有文章範例：${f.name}｜${field}\n\n${f[field]}\n`;
  await writeFile(new URL(file,dir),text,{flag:'wx'});
  index.push({id:f.id,name:f.name,type,field,path:`analysis-pilot/style-samples/${file}`,characters:text.length,sha256:sha256(text),usage:'Original completed website prose: style reference only; factual content requires independent checking.'});
}
await writeFile(new URL('./style-samples.v1.json',import.meta.url),JSON.stringify({format:'dynasty-existing-style-samples',schemaVersion:1,privateFieldsIncluded:false,samples:index},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(index.map(({name,type,field,characters})=>({name,type,field,characters}))));
