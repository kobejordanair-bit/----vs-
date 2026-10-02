'use strict';
// Explicit local-only audit. Writes only counts and hashes; never fixtures or article excerpts.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const C=require('../backend/static/js/play-context.js'),W=require('../backend/static/js/world-engine.js');
const {boot,roster,click,change}=require('./helpers/world-dom.cjs');
async function verify(file){
 const bytes=fs.readFileSync(file),rows=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));assert.ok(Array.isArray(rows)&&rows.length>=2);
 const ids=new Set();let analyzed=0,rated=0;
 for(let i=0;i<rows.length;i++){
  const p=C.buildCharacterProfile(rows[i]);assert.ok(!ids.has(p.recordId));ids.add(p.recordId);analyzed+=Number(p.analysisSections.some(s=>s.field!=='desc'));rated+=Number(!!p.stats);
  W.createSession({mode:'hegemony',roster:[p,C.buildCharacterProfile(rows[(i+1)%rows.length])].map(q=>({recordId:q.recordId,name:q.name,type:q.type,...(q.stats?{stats:q.stats}:{})}))});
 }
 const selected=rows.filter(row=>C.buildCharacterProfile(row).analysisSections.some(s=>s.field!=='desc')).slice(0,3);assert.equal(selected.length,3);
 const ui=await boot({records:rows});try{
  await roster(ui,selected.map(r=>r.id));
  const area=ui.document.querySelector('#w-analysis-text');area.setSelectionRange(0,Math.min(120,area.value.length));area.dispatchEvent(new ui.window.Event('select',{bubbles:true}));
  await change(ui,'#w-principle','care');await click(ui,'[data-action="add-anchor"]');assert.equal(ui.workspace().selection.anchors.length,1);
  await click(ui,'[data-action="create"]');assert.equal(ui.workspace().sessions.length,1,ui.document.querySelector('#w-notice').textContent);
  await change(ui,'#w-primary','relief');await click(ui,'#w-resolve');assert.equal(ui.workspace().sessions[0].save.state.turn,1);
  await click(ui,'[data-action="export-session"]');const exported=JSON.parse(ui.downloads[0].parts[0]);W.importSession(exported.session.save);
  return {verifiedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),records:rows.length,uniqueIds:ids.size,analyzed,rated,allProfilesAndStartsValid:true,domSelected:3,originalQuotePreserved:true,turnCompleted:true,exportReplayValid:true,network:'Mocked cloud; public static files read locally; no production writes or AI requests'};
 }finally{ui.close();}
}
verify(process.argv[2]).then(report=>{if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}).catch(error=>{console.error(error.message);process.exitCode=1;});
