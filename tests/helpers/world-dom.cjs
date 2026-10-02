'use strict';
const fs = require('node:fs'), path = require('node:path');
let JSDOM; try { ({JSDOM} = require(process.env.JSDOM_MODULE || 'jsdom')); } catch (_) {}
const root = path.resolve(__dirname,'../..');
const tick = () => new Promise(resolve => setTimeout(resolve,5));
async function until(check) { const end = Date.now() + 7000; while (Date.now() < end) { if (check()) return; await tick(); } throw Error('DOM condition timed out'); }
const synthetic = [
  {id:'synthetic-alpha',name:'測試甲',type:'emperor',dynasty:'測試',stats:[80,35,70,88,60],deepAnalysis:'此為測試文章，不是真實人物材料。\n角色將糧食與人民放在首位，願意延後征伐以修復民生。'},
  {id:'synthetic-beta',name:'測試乙',type:'general',dynasty:'測試',stats:[91,95,60,33,65],analysis:{strategy:'此為測試文章。偏好強攻，仍願聽取情報。'}},
  {id:'synthetic-gamma',name:'測試丙',type:'minister',dynasty:'測試',stats:[50,20,90,90,85],soulEssence:'此為測試文章。用制度與協商連結地方。'}
];
async function boot({records=synthetic,cloud=null,local=null,fetchHook,adapters={}} = {}) {
  if (!JSDOM) throw Error('JSDOM_MODULE required');
  const dom = new JSDOM('<!doctype html><html><body><button id="outside">原入口</button></body></html>',{url:'http://qa.test/play',runScripts:'outside-only',pretendToBeVisual:true});
  const window = dom.window, document = window.document, downloads = [], requests = [], legacy = [], narratives = [];
  window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
  window.Blob = class { constructor(parts,options) { this.parts = parts; this.type = options?.type; } };
  window.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:world-qa'; }; window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {};
  const realm = value => window.JSON.parse(JSON.stringify(value));
  let server = cloud, revision = cloud ? 3 : 0;
  window.fetch = async (url,options={}) => {
    requests.push({url,options});
    if (fetchHook) { const response = await fetchHook(url,options,window); if (response) return response; }
    if (url === '/api/world-workspace') {
      if (options.method === 'POST') { const body = JSON.parse(options.body); if (body.revision !== revision) return {ok:false,status:409,json:async () => realm({detail:{code:'WORLD_REVISION_CONFLICT',revision,workspace:server}})}; server = body.workspace; revision++; return {ok:true,status:200,json:async () => realm({status:'ok',revision})}; }
      return {ok:true,status:200,json:async () => realm({revision,workspace:server})};
    }
    if (url.startsWith('/static/')) { const file = path.join(root,'backend',url); if (fs.existsSync(file)) return {ok:true,status:200,json:async () => realm(JSON.parse(fs.readFileSync(file,'utf8')))}; }
    throw Error('Unexpected request ' + url);
  };
  for (const file of ['backup','court-engine','court-council','court-campaign','play-context','world-engine','workspace-vault','world-storage','world-ui']) window.eval(fs.readFileSync(path.join(root,'backend/static/js',file+'.js'),'utf8'));
  if (local) window.localStorage.setItem('dynasty-world-workspace.v1',JSON.stringify(local));
  const emptyData = {customLegends:[],modifiedLegends:{},chatHistories:{},simulationHistory:[],discussionHistories:{},soulSession:null,soulSaves:[],hegemonySavedSim:null,sceneEdits:{},scenes:[]};
  let rows = realm(records);
  window.DynastyWorldUI.configure({getRecords:() => rows,getModifications:() => realm({}),getToken:() => 'qa-only',getCurrentData:() => realm(emptyData),getMainBackup:() => window.DynastyBackup.createBackup(realm(emptyData),realm({appVersion:'16.0'})),isReady:() => true,canBackup:() => true,launchLegacy:(action,ids) => {legacy.push({action,ids});},restoreMain:backup => {legacy.push({action:'restore',backup});return {pending:true};},narrate:async (prompt,callback) => {narratives.push(prompt);callback('測試敘事');return '測試敘事';},...adapters});
  await window.DynastyWorldUI.open();
  return {dom,window,document,requests,downloads,legacy,narratives,realm,setRecords(value){rows=realm(value);},workspace:() => JSON.parse(window.localStorage.getItem('dynasty-world-workspace.v1')),close:() => window.close()};
}
async function click(ui,selector) { const el=ui.document.querySelector(selector); if (!el) throw Error('Missing '+selector); el.click(); await until(() => !ui.document.querySelector('#world-workbench').hasAttribute('aria-busy')); }
async function change(ui,selector,value) { const el=ui.document.querySelector(selector); if (!el) throw Error('Missing '+selector); if (el.type === 'checkbox') el.checked = value; else el.value=value; el.dispatchEvent(new ui.window.Event('change',{bubbles:true})); await until(() => !ui.document.querySelector('#world-workbench').hasAttribute('aria-busy')); }
async function roster(ui,ids=synthetic.map(r=>r.id)) { await click(ui,'[data-view="setup"]'); for (const id of ids) await change(ui,'[data-person="'+id+'"]',true); }
module.exports={JSDOM,root,boot,tick,until,click,change,roster,synthetic};
