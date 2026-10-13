// Local UI preview only: public built-in figures, synthetic messages, no credentials or real AI.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadBaseLibrary} from '../cloudflare/scripts/audit-counts.mjs';
const folder=dirname(fileURLToPath(import.meta.url)),repo=resolve(folder,'..');
const {base}=await loadBaseLibrary();
const sampleNames=['漢光武帝','韓信','唐太宗','諸葛亮','秦始皇','范仲淹'];
const selected=base.filter(item=>sampleNames.includes(item.name));
const leader=selected.find(item=>item.name==='漢光武帝');
const now=Date.now();
const messages=[
  {role:'model',content:'吾乃劉秀。亂世已遠，後世之人，有何指教？',createdAt:new Date(now-3600000).toISOString()},
  {role:'user',content:'你怎麼知道，什麼時候該進，什麼時候該退？',createdAt:new Date(now-3500000).toISOString()},
  {role:'model',content:'世人愛說我在昆陽如何以少勝多，可真要問我，贏一仗與贏天下，並不是同一回事。\n\n**兵可以一時用險，人心卻不能反覆消耗。**\n\n若一場勝利得靠把所有人都押上去，我便要再想一想：這是非做不可，還是只為了讓旁人知道我敢做？\n\n你問進退。我倒想先問你：你急著向前，是為了事情，還是為了證明自己？',createdAt:new Date(now-3490000).toISOString()},
  {role:'user',content:'那如果部下不理解你的退讓呢？',createdAt:new Date(now-3350000).toISOString()},
  {role:'model',content:'退讓可以，讓人不知道你在守什麼，就不行。\n\n我會把要保住的東西講清楚，讓他們知道：今日少爭一步，不是沒有志氣，而是要讓明日還有人與我同行。',createdAt:new Date(now-3340000).toISOString()}
];
const sampleHistories={[leader.id]:messages};
for(const name of ['韓信','唐太宗','諸葛亮']){
  const p=selected.find(item=>item.name===name);if(p)sampleHistories[p.id]=[{role:'model',content: name==='韓信'?'戰場上的勝負，你想從哪一局說起？':name==='唐太宗'?'想問治國，還是問那些我也曾做錯的選擇？':'今日有何疑難？不妨慢慢說。',createdAt:new Date(now-7200000).toISOString()}];
}
const initial=JSON.stringify({figures:base,history:sampleHistories,leader:leader.id}).replace(/</g,'\\u003c');
function page(source){
  const start=source.indexOf('            <div id="chatContainer"'),end=source.indexOf('            <div id="contentContainer"',start);
  if(start<0||end<start)throw Error('preview_markup_missing');
  return `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>時空私訊 · 本機預覽</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
  <link href="/static/css/chat-messenger.css" rel="stylesheet"><style>*{box-sizing:border-box}body{margin:0;background:#dfdfd3;font-family:'Noto Sans TC',sans-serif}button,input,textarea{font:inherit}button{cursor:pointer;border:0;background:transparent}p{margin:0}.hidden,[hidden]{display:none!important}#aiModal{position:fixed;inset:0;background:radial-gradient(ellipse at 15% 10%,#ebecd9,#d3dacc)}.messenger-modal-shell{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);overflow:hidden;display:flex;flex-direction:column}.preview-label{position:fixed;bottom:8px;left:50%;transform:translateX(-50%);font-size:10px;letter-spacing:.15em;color:#77806a;white-space:nowrap;z-index:2}#chatContainer{min-height:0}.preview-closed{padding:45px;max-width:550px;margin:100px auto;background:#fffdf7;border-radius:20px;color:#354735}.preview-closed button{background:#476b4b;color:white;padding:10px 20px;border-radius:10px;margin-top:20px}@media(max-width:767px){.preview-label{display:none}}</style></head><body>
  <div id="aiModal" class="messenger-active"><div class="messenger-modal-shell">${source.slice(start,end)}</div></div>
  <div class="preview-label">介面預覽 · 對話為示例 · 不使用正式資料與 AI 額度</div><div class="preview-closed" hidden id="previewClosed">時空私訊預覽已關閉。<br><button id="reopen">重新開啟</button></div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script><script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.5/dist/purify.min.js"></script><script src="/static/js/chat-messenger.js"></script><script>
  const fixture=${initial};const appState={chatMode:{targetId:null},chatHistories:fixture.history,modifiedLegends:{}};let messenger;
  const safe=text=>window.marked&&window.DOMPurify?DOMPurify.sanitize(marked.parse(text)):String(text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])).replace(/\\n/g,'<br>');
  messenger=DynastyMessenger.create({getState:()=>appState,getLegends:()=>fixture.figures,persist:()=>{},sanitize:text=>text,markdown:safe,
    openModal:()=>{document.getElementById('aiModal').classList.remove('hidden');document.getElementById('chatContainer').classList.remove('hidden');document.getElementById('previewClosed').hidden=true;},
    closeModal:()=>{document.getElementById('aiModal').classList.add('hidden');messenger.closed();appState.chatMode.targetId=null;document.getElementById('previewClosed').hidden=false;},confirm:(text,done)=>{if(confirm(text))done();},
    generate:async contents=>{await new Promise(r=>setTimeout(r,1800));return '這是介面示例回覆。\\n\\n你方才的問題已留在這位人物的對話裡；即使等待時切換人物，回信也會送到原來的對話。\\n\\n正式網站會沿用人物原有的 AI 與靈魂內核設定。';}
  });document.getElementById('reopen').onclick=()=>messenger.open(fixture.leader);messenger.open(fixture.leader);
  </script></body></html>`;
}
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:8890');
    if(url.pathname==='/'||url.pathname==='/chat-preview'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(page(await readFile(resolve(repo,'backend/index.html'),'utf8')));return;
    }
    const allowed={'/static/css/chat-messenger.css':['backend/static/css/chat-messenger.css','text/css'],'/static/js/chat-messenger.js':['backend/static/js/chat-messenger.js','application/javascript']};
    if(allowed[url.pathname]){const[file,type]=allowed[url.pathname];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(resolve(repo,file)));return;}
    res.writeHead(404);res.end('Not found');
  }catch{res.writeHead(500);res.end('Preview failed');}
});
server.listen(8890,'127.0.0.1',()=>console.log('Local synthetic preview: http://127.0.0.1:8890/chat-preview'));
