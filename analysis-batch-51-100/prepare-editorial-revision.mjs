// Creates explicit, bounded publication copies, never rewrites Claude captures.
import {readFile, writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {contentHash} from '../cloudflare/scripts/analysis-pilot-import.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const read=async slug=>JSON.parse(await readFile(resolve(root,`results.${slug}-${slug}.v1.json`),'utf8'));
const a=await read('04'),b=await read('47');
const policy={format:'dynasty-explicit-editorial-revision',schemaVersion:1,date:'2026-10-11',editor:'Codex (OpenAI)',
  reviewedClaudeCommit:'0f6103e1',originalCapturesPreserved:true,scoresChanged:false,
  sources:[
    {url:'https://history.state.gov/historicaldocuments/frus1939v03/d238',access:'web_page_read',scope:'full_document',supported:'1939-09-22電報的last June指1939年六月，並明確提到孫科領導的赴蘇使團。信貸金額為電報所報消息，不作獨立帳目核算。'},
    {url:'https://history.ey.gov.tw/Items/%E5%AD%AB%E7%A7%91/',access:'web_page_read',supported:'行政院記孫科1964年至臺；修正靈魂內核的1965年返臺。'},
    {url:'https://www.ey.gov.tw/Page/4ED2F231892187F9/73e92b3d-a0ef-4061-a6cf-17e42ff54601',access:'web_page_read',supported:'第一次行政院長履歷跨民國20–21年；不將有不同任命／就職口徑的任期壓成僅1932年的確數。'},
    {access:'fixed_revision_archive_fulltext',supported:'楚威王的年代異說沿用Claude已逐字比對的史記、後漢書與通鑑，在政治理由補同樣限制，不新增史實。'}],records:[]};
policy.records.push({slug:'04',id:a.records[0].id,originalBatchSha256:contentHash(a),patches:[{
  field:'statsAnalysis',before:'他在位期間楚國版圖東至浙江、西南及滇池',after:'《史記》把東南及滇池的擴張記在他名下，但如統率項所述，相關戰事的系年有異說，不能直接當作他在位期間已確證的疆域'}]});
const patches=[];
const add=(field,before,after)=>patches.push({field,before,after});
add('analysis','同年美國駐蘇大使的電報指出，蘇聯對華援助主要以長期低利信貸提供，一九三八年六月又授予近兩億美元，累計約五億美元','一九三九年九月二十二日，美國駐蘇大使電報轉述其消息來源：蘇聯對華援助主要以長期低利信貸提供，該年六月又授予近兩億美元，累計約五億美元；這是當時情報報告的數字，並非已逐筆核算的信貸帳目');
add('analysis','電報未直接記他的角色，信貸成果不能全歸於他一人[推斷]；但在國民政府最孤立的兩年，他是對蘇管道上最高層的談判者之一[推斷]。','電報明確提到物資採購透過赴莫斯科的中國使團安排，尤其包括由孫科率領的使團[史載]。這支持他參與對蘇採購談判，但信貸成果不能全歸於他一人[推斷]；他是當時對蘇管道上的重要談判者之一[推斷]。');
add('analysis','一九三二年一月一日就任，同月底即由汪精衛接替','任期跨一九三一年年底與一九三二年一月，翌年一月底由汪精衛接替');
add('analysis','一九三二年那次不到一個月','一九三一年底至一九三二年一月那次約一個月');
add('statsAnalysis','一次不到一個月、一次約三個月','一次約一個月、一次約三個月');
add('soulEssence','他早在一九三二年一月就當過行政院長，任期只有一月一日到一月底，由汪精衛接任','他早在一九三一年底至一九三二年一月就當過行政院長，約一個月後由汪精衛接任');
add('soulEssence','一九三二年他第一次出任行政院長，不到一個月就由汪精衛接手','一九三一年底至一九三二年一月，他首次任行政院長，約一個月後由汪精衛接手');
const soul=b.records[0].fields.soulEssence;
const before=soul.slice(soul.indexOf('據英文條目，一九四九年後'),soul.indexOf('國父之子在海外漂泊'));
if(!before)throw Error('soul_return_anchor_missing');
add('soulEssence',before,'一九四九年後他離開中國大陸，曾旅居歐美；行政院的介紹記他於一九六四年返臺，其後任考試院院長與總統府資政（[行政院孫科介紹](https://history.ey.gov.tw/Items/%E5%AD%AB%E7%A7%91/)）[史載]。');
policy.records.push({slug:'47',id:b.records[0].id,originalBatchSha256:contentHash(b),patches});
const hash=contentHash(policy);
await writeFile(resolve(root,'editorial-revision.20261011.json'),JSON.stringify(policy,null,2)+'\n',{flag:'wx'});
const modulePath=resolve(root,'editorial-revision.mjs');
const module=await readFile(modulePath,'utf8');
if(!module.includes('POLICY_HASH_PENDING'))throw Error('policy_already_bound');
await writeFile(modulePath,module.replace('POLICY_HASH_PENDING',hash));
const {applyEditorialRevision}=await import('./editorial-revision.mjs');
for(const [slug,original]of[['04',a],['47',b]])await writeFile(resolve(root,`results.${slug}-${slug}.editorial.v1.json`),JSON.stringify(applyEditorialRevision(original,policy,slug),null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({editorialPeople:2,policySha256:hash,originalCapturesPreserved:true}));
