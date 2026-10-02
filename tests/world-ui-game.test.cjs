'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {JSDOM,boot,click,change,roster,synthetic}=require('./helpers/world-dom.cjs');
const run=(name,fn)=>test(name,{skip:!JSDOM&&'Set JSDOM_MODULE for DOM tests'},fn);
run('full library selection creates deterministic world; compound turn predicts exact complete result without AI',async()=>{
  const ui=await boot();try{
    await roster(ui); await click(ui,'[data-action="create"]');
    assert.ok(ui.document.querySelector('#w-primary'),ui.document.querySelector('#w-notice').textContent);
    const before=ui.workspace().sessions[0]; const state=ui.window.DynastyWorld.importSession(ui.realm(before.save));
    assert.equal(state.config.roster.length,3);assert.deepEqual(Array.from(state.config.roster,r=>r.recordId),synthetic.map(r=>r.id));
    await change(ui,'#w-primary','relief');await change(ui,'#w-secondary','ledger');
    assert.equal(ui.document.querySelector('#w-support').value,'synthetic-beta');
    assert.equal(ui.document.querySelector('#w-resolve').disabled,false);
    await click(ui,'#w-resolve');
    const after=ui.window.DynastyWorld.importSession(ui.realm(ui.workspace().sessions[0].save));
    assert.equal(after.turn,1);assert.equal(after.orders[0].secondary,'ledger');assert.equal(after.log[0].opponents.length,3);assert.equal(ui.narratives.length,0);
    assert.ok(!ui.requests.some(r=>r.url.includes('gemini')));
    await click(ui,'[data-action="narrate"]');
    assert.equal(ui.workspace().sessions[0].narratives.length,1,ui.document.querySelector('#w-notice').textContent);
    assert.deepEqual(ui.workspace().sessions[0].save,before.save.format&&JSON.parse(JSON.stringify(ui.window.DynastyWorld.exportSession(after))));
  }finally{ui.close();}
});
run('soul roster shares body; original soul cannot act independently and stale support cannot double-book',async()=>{
 const ui=await boot();try{await roster(ui);await change(ui,'#w-mode','soul');await change(ui,'#w-host','synthetic-alpha');await click(ui,'[data-action="create"]');
 assert.ok(ui.document.querySelector('#w-primary'),ui.document.querySelector('#w-notice').textContent);
 assert.deepEqual([...ui.document.querySelector('#w-actor').options].map(o=>o.value),['synthetic-alpha','synthetic-gamma']);
 await change(ui,'#w-primary','study');await change(ui,'#w-approach','blend');await change(ui,'#w-secondary','bond');
 assert.equal(ui.document.querySelector('#w-support').value,'synthetic-gamma');await click(ui,'#w-resolve');
 const state=ui.window.DynastyWorld.importSession(ui.realm(ui.workspace().sessions[0].save));assert.equal(state.turn,1);assert.ok(state.soul.adaptation>25);assert.equal(state.orders[0].approach,'blend');
 }finally{ui.close();}
});
run('real historical event carries exact event/place/faction/source IDs into the saved game',async()=>{
 const ui=await boot();try{await roster(ui);await click(ui,'[data-action="load-context"]');await change(ui,'#w-event','event:julu-chu-breaks-qin');await click(ui,'[data-action="create"]');
 assert.ok(ui.document.querySelector('#w-primary'),ui.document.querySelector('#w-notice').textContent);
 const state=ui.window.DynastyWorld.importSession(ui.realm(ui.workspace().sessions[0].save));assert.equal(state.config.setting.eventId,'event:julu-chu-breaks-qin');assert.ok(state.config.setting.placeIds.includes('place:julu'));assert.ok(state.config.setting.factionIds.includes('faction:qin'));assert.ok(state.config.setting.sourceRefs.length>0);assert.match(ui.document.body.textContent,/遊戲/);
 }finally{ui.close();}
});
run('full deterministic game can be completed in UI and exported then resumed',async()=>{
 const ui=await boot();try{await roster(ui);await change(ui,'#w-turns','8');await click(ui,'[data-action="create"]');
 for(let turn=0;turn<8;turn++){if(!ui.document.querySelector('#w-primary'))break;await change(ui,'#w-primary',turn%2?'trade':'harvest');await click(ui,'#w-resolve');}
 const state=ui.window.DynastyWorld.importSession(ui.realm(ui.workspace().sessions[0].save));assert.ok(state.ending);assert.equal(ui.document.querySelector('#w-resolve'),null);await click(ui,'[data-action="export-session"]');assert.equal(ui.downloads.length,1);const bundle=JSON.parse(ui.downloads[0].parts[0]);assert.equal(bundle.session.save.state.turn,state.turn);await click(ui,'[data-view="saves"]');await click(ui,'[data-action="resume"]');assert.match(ui.document.body.textContent,new RegExp(state.ending.title));
 }finally{ui.close();}
});
run('another tab changing local workspace can be recovered through visible controls',async()=>{
 const ui=await boot();try{await roster(ui);await click(ui,'[data-action="create"]');
 const external=ui.workspace();external.selection.notes='另一個視窗的新筆記';ui.window.localStorage.setItem('dynasty-world-workspace.v1',JSON.stringify(external));
 await click(ui,'[data-view="setup"]');await change(ui,'#w-notes','這個視窗的修改');
 assert.ok(ui.document.querySelector('[data-action="sync-refresh"]'));await click(ui,'[data-action="sync-refresh"]');
 assert.equal(ui.document.querySelector('#w-notes').value,'另一個視窗的新筆記');assert.equal(ui.workspace().sessions.length,1);
 await click(ui,'[data-action="sync-local"]');assert.ok(!ui.document.querySelector('[data-action="sync-refresh"]'));
 }finally{ui.close();}
});
