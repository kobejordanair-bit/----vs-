'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM,root,until}=require('./helpers/world-dom.cjs');
test('actual full index loads old userdata and /play opens new workspace without writing either collection',{skip:!JSDOM&&'Set JSDOM_MODULE'},async()=>{
 const html=fs.readFileSync(path.join(root,'backend/index.html'),'utf8');
 const dom=new JSDOM(html,{url:'http://qa.test/play',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,d=w.document,requests=[];
 try{
  const realm=v=>w.JSON.parse(JSON.stringify(v));w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
  const downloads=[];w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:qa';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};w.marked={parse:s=>s};w.DOMPurify={sanitize:s=>s};w.Chart=class{destroy(){}update(){}};
  w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const data={customLegends:[],modifiedLegends:{},chatHistories:{},simulationHistory:[],discussionHistories:{},soulSession:null,soulSaves:[],hegemonySavedSim:null,sceneEdits:{},scenes:[]};
  w.fetch=async(url,options={})=>{requests.push({url,method:options.method||'GET'});if(String(url).endsWith('/api/userdata'))return{ok:true,json:async()=>realm({...data,revision:0})};if(String(url).endsWith('/api/world-workspace'))return{ok:true,json:async()=>realm({revision:0,workspace:null})};throw Error('Unexpected request '+url);};
  for(const script of d.querySelectorAll('script')){if(script.src){const u=new URL(script.src);if(u.origin==='http://qa.test'){vm.runInContext(fs.readFileSync(path.join(root,'backend',u.pathname),'utf8'),dom.getInternalVMContext(),{filename:u.pathname});}}else{vm.runInContext(script.textContent,dom.getInternalVMContext());}}
  w.eval("APP_TOKEN='qa.123';");await w.eval('init()');await until(()=>d.querySelector('#world-workbench')&&!d.querySelector('#world-workbench').hidden);
  assert.equal(w.eval('legendsData.length'),w.eval('staticLegendsData.length'));assert.ok(w.eval('legendsData.length')>0);assert.match(d.querySelector('#w-content').textContent,/原有功能全部保留/);
  assert.equal(w.eval('cloudStore.getState().ready'),true);assert.ok(requests.every(r=>r.method==='GET'));assert.equal(requests.filter(r=>r.url.endsWith('/api/userdata')).length,1);
  w.DynastyWorldUI.close();assert.equal(d.querySelector('#world-workbench').hidden,true);assert.ok([...d.body.children].filter(n=>n.id!=='world-workbench').every(n=>n.inert!==true));
  await w.DynastyWorldUI.open('backup');d.querySelector('[data-action="export-all"]').click();await until(()=>!d.querySelector('#world-workbench').hasAttribute('aria-busy'));
  assert.equal(downloads.length,1,d.querySelector('#w-notice').textContent);
  assert.ok(requests.every(r=>r.method==='GET'));
 }finally{w.close();}
});
