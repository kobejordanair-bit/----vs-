(function (global) {
    'use strict';
    const paths = {
        search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
        close: '<path d="m6 6 12 12M18 6 6 18"/>',
        back: '<path d="m14 5-7 7 7 7"/>',
        send: '<path d="m3 3 18 9-18 9 4-9-4-9Z M7 12h14"/>',
        book: '<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2V4Z"/>',
        clear: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7M14 10v7"/>'
    };
    const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
    const DIMENSIONS = ['統率', '武力', '智謀', '政治', '魅力'];
    // Five-dimension scores and reasons as role context. Links and headings are dropped to keep each request short.
    function selfAssessment(stats, reasons) {
        const valid = Array.isArray(stats) && stats.length === 5 && stats.every(value => Number.isInteger(value) && value >= 0 && value <= 100);
        const text = typeof reasons === 'string' ? reasons
            .replace(/[（(]\s*\[[^\]]*\]\([^)]*\)(?:\s*[、，,；;]\s*\[[^\]]*\]\([^)]*\))*\s*[)）]/g, '')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/^#{1,6}\s*\**\s*\d+\.\s*【五維能力數值】\s*\**\s*$/gm, '')
            .replace(/^#{1,6}\s*/gm, '').replace(/\*\*/g, '')
            .replace(/\n{3,}/g, '\n\n').trim() : '';
        if (!valid && !text) return '';
        const scores = valid ? DIMENSIONS.map((name, index) => `${name}${stats[index]}`).join('、') : '';
        return [scores && `評分：${scores}（0–100）`, text].filter(Boolean).join('\n');
    }
    function create(context) {
        const el = id => document.getElementById(id);
        const state = () => context.getState();
        const figures = () => context.getLegends();
        const figure = id => figures().find(item => item.id === id);
        const pending = new Map(), errors = new Map(), drafts = new Map();
        let currentId = null, showAll = false, focusBefore = null;
        const node = (tag, className, text) => {
            const item = document.createElement(tag);
            if (className) item.className = className;
            if (text !== undefined) item.textContent = text;
            return item;
        };
        const history = id => Array.isArray(state().chatHistories[id]) ? state().chatHistories[id] : [];
        const visible = id => currentId === id && state().chatMode.targetId === id
            && !el('chatContainer').classList.contains('hidden') && !el('aiModal')?.classList.contains('hidden');
        const validDate = value => value && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
        const clock = value => validDate(value)?.toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false }) || '';
        const day = value => validDate(value)?.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric' }) || '既有對話';
        const avatar = legend => {
            const item = node('span', 'messenger-avatar', Array.from(legend?.name || '史')[0]);
            item.dataset.type = ['emperor','general','minister'].includes(legend?.type) ? legend.type : 'general';
            item.setAttribute('aria-hidden', 'true');
            return item;
        };
        const meta = legend => [legend?.dynasty, legend?.title, legend?.tag].filter(Boolean).join(' · ');
        const resize = () => {
            const input = el('chatInput'); input.style.height = 'auto';
            input.style.height = Math.min(Math.max(input.scrollHeight, 25), 130) + 'px';
        };
        function updateComposer() {
            const busy = pending.has(currentId), hasText = Boolean(el('chatInput').value.trim());
            el('messengerSend').disabled = busy || !hasText;
            el('messengerSend').setAttribute('aria-label', busy ? '等待人物回覆' : '傳送訊息');
            el('messengerStatus').textContent = busy ? '正在回信…' : '對話會保留在此人物的紀錄中';
            el('chatHistory').setAttribute('aria-busy', busy ? 'true' : 'false');
        }
        function renderContacts() {
            const query = el('messengerSearch').value.trim().toLocaleLowerCase();
            const all = figures(), recentIds = new Set(Object.keys(state().chatHistories).filter(id => history(id).length));
            if (currentId) recentIds.add(currentId);
            const suggestedNames = ['漢光武帝','唐太宗','韓信','諸葛亮','秦始皇'];
            let rows = query || showAll ? all : all.filter(item => recentIds.has(item.id));
            if (!query && !showAll && rows.length < 5) rows = all.filter(item => recentIds.has(item.id) || suggestedNames.includes(item.name));
            if (query) rows = rows.filter(item => [item.name,item.title,item.dynasty,item.tag].some(value => String(value || '').toLocaleLowerCase().includes(query)));
            if (!query && !showAll) rows = [...rows].sort((a,b) => {
                const aLast = history(a.id).at(-1), bLast = history(b.id).at(-1);
                return (Date.parse(bLast?.createdAt) || 0) - (Date.parse(aLast?.createdAt) || 0);
            });
            const area = el('messengerContacts'); area.replaceChildren();
            rows.slice(0, 80).forEach(legend => {
                const button = node('button', 'messenger-contact'); button.type = 'button'; button.dataset.targetId = legend.id;
                button.setAttribute('aria-current', legend.id === currentId ? 'true' : 'false');
                button.setAttribute('aria-label', `與${legend.name}對話`);
                button.appendChild(avatar(legend));
                const copy = node('span', 'messenger-contact-copy'), top = node('span', 'messenger-contact-top');
                top.append(node('span','messenger-contact-name',legend.name),node('span','messenger-contact-time',clock(history(legend.id).at(-1)?.createdAt)));
                copy.append(top,node('span','messenger-contact-sub',meta(legend)));
                const last = history(legend.id).at(-1);
                const preview = pending.has(legend.id) ? '正在回信…' : last ? `${last.role === 'user' ? '你：' : ''}${String(last.content).replace(/[#*_>\n]/g,' ').slice(0,65)}` : '初次見面 · 點此開始';
                copy.appendChild(node('span','messenger-contact-preview',preview)); button.appendChild(copy);
                button.addEventListener('click', () => open(legend.id)); area.appendChild(button);
            });
            if (!rows.length) area.appendChild(node('p','messenger-notice','沒有找到人物，試試姓名、稱號或朝代。'));
            if (rows.length > 80) area.appendChild(node('p','messenger-notice',`另有 ${rows.length - 80} 位人物，輸入姓名可快速尋找。`));
            el('messengerNotice').textContent = `${all.length} 位人物`;
            el('messengerAllContacts').setAttribute('aria-selected', String(showAll));
            el('messengerRecentContacts').setAttribute('aria-selected', String(!showAll));
        }
        function bubble(message, legend, options = {}) {
            const isUser = message.role === 'user', row = node('div',`messenger-message ${isUser ? 'user' : 'model'}`);
            if (!isUser) row.appendChild(avatar(legend));
            const body = node('div','messenger-message-body');
            if (!isUser) body.appendChild(node('span','messenger-sender',legend.name));
            const content = node('div','messenger-bubble' + (options.error ? ' messenger-error' : ''));
            if (options.typing) {
                const dots = node('span','messenger-typing'); dots.innerHTML='<i></i><i></i><i></i>';
                dots.setAttribute('aria-label','人物正在回覆'); content.appendChild(dots);
            } else if (isUser || options.error) content.textContent = message.content;
            else content.innerHTML = context.markdown(String(message.content || ''));
            if (options.error) {
                const retry = node('button','', '重新傳送這則訊息'); retry.type='button';
                retry.addEventListener('click', () => send({retry:true})); content.appendChild(retry);
            }
            body.appendChild(content);
            const time = clock(message.createdAt);
            if (time) body.appendChild(node('span','messenger-message-meta',time));
            row.appendChild(body); return row;
        }
        function renderThread(scroll = true) {
            const legend = figure(currentId); if (!legend) return;
            el('messengerThreadName').textContent = legend.name;
            el('messengerThreadMeta').textContent = meta(legend);
            el('messengerAvatar').replaceChildren(avatar(legend));
            const area = el('chatHistory'), oldScroll = area.scrollTop; area.replaceChildren();
            const title = node('div','messenger-conversation-title');
            title.append(node('strong','',`${legend.dynasty || '史海'} · ${legend.name}`),node('span','','隔著歲月，也能好好說話。'));
            area.appendChild(title);
            let previousDay = '';
            history(currentId).forEach(message => {
                const label = day(message.createdAt);
                if (label !== previousDay) { area.appendChild(node('div','messenger-date',label)); previousDay=label; }
                area.appendChild(bubble(message,legend));
            });
            if (pending.has(currentId)) area.appendChild(bubble({role:'model'},legend,{typing:true}));
            if (errors.has(currentId)) area.appendChild(bubble({role:'model',content:'這封回信暫時沒能送達。你的訊息還在，可以重新傳送。'},legend,{error:true}));
            renderSuggestions(legend); updateComposer();
            area.scrollTop = scroll ? area.scrollHeight : oldScroll;
        }
        function renderSuggestions(legend) {
            const area = el('messengerSuggestions'); area.replaceChildren();
            if (history(legend.id).some(item=>item.role==='user')) return;
            const personal = legend.tag ? `你如何看待「${legend.tag}」？` : '你一生最重要的選擇是什麼？';
            [personal,'若能重來，你會改變哪一步？','你最希望後世理解什麼？'].forEach(text => {
                const button = node('button','',text); button.type='button';
                button.addEventListener('click',()=>{el('chatInput').value=text;resize();updateComposer();el('chatInput').focus();});
                area.appendChild(button);
            });
        }
        function saveDraft() { if(currentId) drafts.set(currentId,el('chatInput').value); }
        function open(id) {
            const legend=figure(id); if(!legend) return;
            const wasVisible=currentId && visible(currentId);
            saveDraft(); if(!wasVisible) focusBefore=document.activeElement;
            currentId=id; state().chatMode.targetId=id;
            context.openModal(`與 ${legend.name} 對話`,'chat');
            el('chatContainer').classList.remove('messenger-list-view'); el('messengerBio').hidden=true;
            if(!history(id).length) {
                const title=legend.title && legend.title!==legend.name ? `${legend.title}，` : '';
                state().chatHistories[id]=[{role:'model',content:`吾乃${title}${legend.name}。後世之人，有何指教？`,createdAt:new Date().toISOString()}];
                context.persist();
            }
            el('chatInput').value=drafts.get(id)||''; resize();renderContacts();renderThread();
            // Avoid opening the on-screen keyboard before the user asks to type.
            el('messengerProfile').focus({preventScroll:true});
        }
        function promptContents(legend,id) {
            const saved=state().modifiedLegends[id] || {};
            const soul=saved.soulEssence || legend.soulEssence || '';
            const assessment=selfAssessment(saved.stats || legend.stats, saved.statsAnalysis || legend.statsAnalysis);
            const prompt=`你現在是${legend.name}（${legend.title || ''}）。\n生平簡介：${legend.desc || ''}。\n性格標籤：${legend.tag || ''}。${assessment ? `\n\n【後世對你的五維評估——這是後人的評價與依據，你可以認同、辯解或不服，但不要照念分數或條列】\n${assessment}` : ''}${soul ? `\n\n【靈魂內核——以下是你作為「活生生的人」的內在運作方式，請用它來塑造你的說話邏輯、壓力反應與情感表達，但絕不要在對話中直接引用這些標籤文字】\n${soul}` : ''}\n請完全沉浸在這個歷史人物的角色中，用符合其時代和性格的語氣（可以使用半文半白，但要讓現代人聽得懂）回答使用者的問題。\n你不知道你死後很久才發生的現代科技（除非你是穿越者），保持歷史沉浸感。嚴禁使用制式化AI開場白。`;
            return [{role:'user',parts:[{text:prompt+'\n\n(系統指示：請直接以上述人物身份開始對話)'}]},
                {role:'model',parts:[{text:'吾乃'+legend.name+'，已知悉。'}]},
                ...history(id).slice(-20).map(item=>({role:item.role==='user'?'user':'model',parts:[{text:String(item.content)}]}))];
        }
        async function send(options = {}) {
            const id=currentId, legend=figure(id); if(!id || !legend || !visible(id) || pending.has(id)) return;
            const retry=options.retry===true, previousError=errors.get(id);
            const text=retry ? previousError?.text : context.sanitize(el('chatInput').value.trim());
            if(!text) return;
            const originalHistory=state().chatHistories[id];
            if(!Array.isArray(originalHistory)) return;
            if(!retry) {
                originalHistory.push({role:'user',content:text,createdAt:new Date().toISOString()});
                el('chatInput').value='';drafts.delete(id);resize();context.persist();
            }
            errors.delete(id);
            const token={history:originalHistory,text};pending.set(id,token);renderThread();renderContacts();
            const contents=promptContents(legend,id);
            try {
                const response=await context.generate(contents);
                if(pending.get(id)!==token || state().chatHistories[id]!==originalHistory) return;
                if(typeof response!=='string' || !response.trim()) throw Error('empty_reply');
                originalHistory.push({role:'model',content:response,createdAt:new Date().toISOString()});context.persist();
            } catch(error) {
                if(pending.get(id)===token && state().chatHistories[id]===originalHistory) errors.set(id,{text});
            } finally {
                if(pending.get(id)===token) pending.delete(id);
                if(visible(id)) {
                    const area=el('chatHistory'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<150;
                    renderThread(nearBottom);
                }
                renderContacts();
            }
        }
        function clear() {
            const id=currentId; if(!id) return;
            context.confirm('確定要清除與此人物的對話記憶嗎？',()=>{
                pending.delete(id);errors.delete(id);drafts.delete(id);delete state().chatHistories[id];
                context.persist();
                if(visible(id)) open(id); else renderContacts();
            });
        }
        function closed() {
            saveDraft(); currentId=null;
            el('messengerBio').hidden=true;
            if(focusBefore?.isConnected) focusBefore.focus({preventScroll:true});
            focusBefore=null;
        }
        function showBio() {
            const legend=figure(currentId),area=el('messengerBio'); if(!legend)return;
            if(!area.hidden){area.hidden=true;return;}
            area.replaceChildren(node('h4','',legend.name),node('p','',legend.desc || '人物小傳尚未補齊。'));
            if(legend.poem)area.appendChild(node('blockquote','',legend.poem));
            if(context.showProfile){const button=node('button','','閱讀人物賞析');button.type='button';button.addEventListener('click',()=>context.showProfile(legend.id));area.appendChild(button);}
            area.hidden=false;
        }
        el('messengerSend').innerHTML=icon('send'); el('messengerBack').innerHTML=icon('back');
        el('messengerClose').innerHTML=icon('close'); el('messengerClear').innerHTML=icon('clear');el('messengerProfile').innerHTML=icon('book');
        el('messengerSidebarClose').innerHTML=icon('close');el('messengerSearchIcon').innerHTML=icon('search');
        el('messengerSend').addEventListener('click',()=>send());
        el('messengerClose').addEventListener('click',()=>context.closeModal());
        el('messengerSidebarClose').addEventListener('click',()=>context.closeModal());
        el('messengerBack').addEventListener('click',()=>{saveDraft();el('chatContainer').classList.add('messenger-list-view');el('messengerSearch').focus();});
        el('messengerClear').addEventListener('click',clear); el('messengerProfile').addEventListener('click',showBio);
        el('messengerSearch').addEventListener('input',renderContacts);
        el('messengerAllContacts').addEventListener('click',()=>{showAll=true;renderContacts();});
        el('messengerRecentContacts').addEventListener('click',()=>{showAll=false;renderContacts();});
        el('chatInput').addEventListener('input',()=>{resize();updateComposer();});
        el('chatInput').addEventListener('keydown',event=>{
            if(event.key==='Enter' && !event.shiftKey && !event.isComposing && event.keyCode!==229){event.preventDefault();send();}
        });
        el('chatContainer').addEventListener('keydown',event=>{
            if(event.key==='Escape'){event.preventDefault();if(!el('messengerBio').hidden)el('messengerBio').hidden=true;else context.closeModal();}
            if(event.key==='Tab'){
                const shell=el('chatContainer'),items=[...shell.querySelectorAll('button,input,textarea,a[href]')].filter(item=>!item.disabled && !item.closest('[hidden]') && item.getClientRects().length);
                const first=items[0],last=items.at(-1);
                if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
                else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
            }
        });
        return {open,send,clear,closed,renderContacts};
    }
    global.DynastyMessenger=Object.freeze({create,selfAssessment});
})(window);
