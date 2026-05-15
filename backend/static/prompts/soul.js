(function() {
    // 純同步字串組裝。所有依賴必須由呼叫方傳入，不得讀取 appState / legendsData 等全域變數。

    function formatSoulYear(y) { return y > 0 ? `西元${y}年` : `${Math.abs(y)}年前`; }
    function soulTensionTitle(t) { return typeof t === 'string' ? t : t.title; }

    window.buildSoulGoalPrompt = function({ chNum, suggestedType, globalSummary, pendingTensions, figureStates, keyEvents }) {
        const tensionsStr = (pendingTensions || []).length > 0
            ? (pendingTensions || []).map((t, i) => `${i + 1}. ${soulTensionTitle(t)}`).join('\n')
            : '（目前無積累張力）';
        const figsStr = (figureStates || []).length > 0
            ? figureStates.map(f => `${f.name}(${f.attitude})${f.summary ? `：${f.summary}` : ''}${f.tension ? `｜矛盾：${f.tension}` : ''}`).join('\n')
            : '（無登場人物）';
        const recentEvts = (keyEvents || []).slice(-5).join('\n') || '（無）';
        const typeHint = suggestedType ? `本章章型為「${suggestedType}」。` : '';
        return `這是一個歷史穿越小說，目前是第${chNum + 1}章。${typeHint}

【全局主線摘要】
${globalSummary || '故事剛開始。'}

【積累未解決的張力】
${tensionsStr}

【關鍵人物當前狀態】
${figsStr}

【最近不可逆事件】
${recentEvts}

根據以上故事現狀，用一句話（30字以內）說出本章最應當推進的核心戲劇任務——必須具體到這個故事的人物和局勢，不要泛泛描述。只輸出這一句話，不要任何說明或前綴。`;
    };

    window.buildSoulCompatibilityPrompt = function({ host, soul, soulSession, hostMod, soulMod }) {
        const traitsEngine = soulSession.soulTraits
            ? (typeof soulSession.soulTraits === 'string' ? soulSession.soulTraits : (soulSession.soulTraits.engine || soulSession.soulTraits.display))
            : '';
        const hostSummary = (hostMod.deepAnalysis || hostMod.analysis || '').slice(0, 600);
        const soulEssence = soul ? (soulMod.soulEssence || '').slice(0, 600) : '';
        return `請分析以下歷史穿越的相性，生成一份「魂穿相性報告」。

【宿主】${host?.name}（${host?.rank}，${host?.title||''}，${host?.dynasty||''}）
穿越時刻：${soulSession.moment?.title}——${soulSession.moment?.desc}
${hostSummary ? `宿主背景：${hostSummary}` : ''}

【穿越靈魂】${soul ? `${soul.name}（${soul.rank}，${soul.dynasty||''}）\n靈魂時刻：${soulSession.soulMoment?.title||''}（${soulSession.soulMoment?.isPostDeath?'死後':'在世'}）` : '宿主自身意識覺醒（無外來靈魂）'}
${traitsEngine ? `靈魂特質：${traitsEngine}` : ''}
${soulEssence ? `靈魂內核摘要：${soulEssence}` : ''}

【敘事導演基調】${soulSession.narrativeMode === 'heroic' ? '改命爽文' : soulSession.narrativeMode === 'tragedy' ? '悲劇史詩' : '權謀正劇'}

請生成結構化報告（500-600字），格式如下：

【相性總評】一句話定調（含數字評分如 7.5/10）

【靈魂與宿主的核心張力】
分析穿越靈魂的思維方式與宿主身份/處境之間最根本的衝突或契合點——這個碰撞將如何成為故事的核心動力？

【歷史局勢適配度】
這個靈魂帶入的能力、視野與弱點，與「${soulSession.moment?.title}」這個歷史節點的具體挑戰是否匹配？最大的優勢是什麼？最致命的短板是什麼？

【最可能的故事走向】
根據以上分析，推測這個穿越最可能演化的敘事弧線——主角大概率會犯什麼錯、遭遇什麼困境、在哪個關鍵節點面臨最大考驗？

【作者給讀者的一句話】
用一句有衝擊感的話，預示這段穿越最值得期待、也最可能令人心碎的核心矛盾。`;
    };

    window.buildSoulChapterPrompt = function({ soulSession, chNum, label, host, soul, hostMod, soulMod, hostChat, narrativeGoal, suggestedType, recentTitles, isAftermath }) {
        // 純同步字串組裝。所有依賴必須由呼叫方傳入，不得讀取 appState / legendsData 等全域變數。

        const older = soulSession.chapters.filter(c => !c.isSummary && !c.isCompat).slice(0,-1);
        const recent = soulSession.chapters.filter(c => !c.isSummary && !c.isCompat).slice(-1);
        let ctx = '';
        if (soulSession.globalSummary) ctx += `【全局主線摘要】\n${soulSession.globalSummary}\n\n`;
        if (recent.length) ctx += recent.map(c=>`【${c.label}「${c.title}」完整內容】\n${c.content}`).join('\n\n') + '\n\n';
        const figCtx = soulSession.figureStates.length ? `【已登場人物（主角均已接觸過，不得重新介紹）】\n${soulSession.figureStates.map(f=>`${f.name}(${f.rank})${f.summary ? `｜累積關係：${f.summary}` : ''}｜本章動態：${f.change||'待定'}`).join('\n')}\n\n` : '';
        const yStr = (y) => formatSoulYear(y);

        if (isAftermath) {
            const deathCh = soulSession.chapters[soulSession.deathChapter];
            return `你是一位嚴肅的歷史小說作家兼史學者，以史書體裁（但沉浸生動）寫作。

【背景】
宿主${host?.name}（${host?.rank}，${host?.title||''}，${host?.dynasty||''}）已於「${deathCh?.title||'前章'}」中殞落。
穿越時刻：${soulSession.moment?.title}（${yStr(soulSession.moment?.year||0)}）

${ctx}${figCtx}請寫出${label}（2000-3000字）：

本章為宿主身後的世界記錄。請從當前人物動態中，選擇一位「因宿主死亡而命運最受衝擊、或最能決定後續走向」的在世人物作為本章固定主視角，以其主觀視角展開敘述。

寫作要求：
- 固定本章一個主視角人物，不要在人物間跳躍，深入其內心與處境
- 展現宿主生前的決定（尤其與原歷史不同之處）如何在其死後持續發酵，包括意料之外的連鎖反應
- 【蝴蝶效應】宿主種下的因在其死後才真正收穫果——被改變的時間線不會因宿主死亡而自動回到原軌，繼續沿著已偏離的軌跡演化
- 【歷史慣性】各方人物仍有自己的利益邏輯，宿主的死可能對某人是解脫，對另一人是噩夢的開始

正文結束後換行輸出（系統解析用，勿計入正文）：
[FIGURES][{"name":"人名","rank":"評級","change":"本章動態20字內","attitude":"ally/enemy/neutral/suspicious"},...][/FIGURES]
[CHAPTERTITLE]4-8字章節標題[/CHAPTERTITLE]`;
        } else {
            const traitsEngine = soulSession.soulTraits
                ? (typeof soulSession.soulTraits === 'string' ? soulSession.soulTraits : (soulSession.soulTraits.engine || soulSession.soulTraits.display))
                : '';
            const traitsBlock = (soul && traitsEngine) ? `\n靈魂特質：\n${traitsEngine}` : '';
            const soulEssenceForChapter = soul ? (soulMod.soulEssence || '') : '';
            const soulEssenceCtx = soulEssenceForChapter ? `【靈魂內核——作者寫作參考，絕不能讓標籤文字出現在正文中】\n標注說明：[史載]為確定事實須忠實體現；[推斷]為模式可靈活演繹；[詮釋]為詮釋框架可在情節中留白或保持張力。\n${soulEssenceForChapter}\n\n` : '';
            const compatCtx = soulSession.compatibilityReport
                ? `【相性報告摘要——本故事的核心矛盾預設，作者寫作時的隱性框架】\n${soulSession.compatibilityReport.slice(0, 400)}\n\n`
                : '';
            const soulMomentIsPostDeath = soulSession.soulMoment?.isPostDeath ?? true;
            const soulMomentDesc = soulSession.soulMoment
                ? `靈魂時刻：${soulSession.soulMoment.title}（${soulMomentIsPostDeath ? '死後' : '在世'}）——${soulSession.soulMoment.desc}\n`
                : '';
            const soulLine = soul
                ? `穿越靈魂：${soul.name}（${soul.rank}，${soul.title||''}，${soul.dynasty||''}）${traitsBlock}\n${soulMomentDesc}${soulMomentIsPostDeath
                    ? `死後視角：此靈魂已活過並死去一次。死亡帶來的是沉重的自我意識，性格的根底不因死亡而消失。`
                    : `在世視角：此靈魂是「${soulSession.soulMoment?.title||'某個時刻'}」的意識被傳送過來——他尚未經歷死亡，帶著那個時刻的執念、野心或恐懼，沒有死後的沉澱，更衝動也更受當下利益驅動。`
                }\n知識邊界（嚴格遵守）：此靈魂可調用的知識僅限於兩個來源——①在「${soulSession.soulMoment?.title||'穿越時刻'}」之前親身經歷、學習、接觸過的知識（${soulMomentIsPostDeath ? '其一生所學' : `僅限${soulSession.soulMoment?.title||'該時刻'}以前，之後才發生的事他一概不知`}），必須從其具體生平軌跡推斷，不得以身份類別替代；②宿主腦海中的記憶，同樣只包含宿主本人生命中真實接觸過的事，而非「這個身份理應知道的一切」。「那個時代存在的知識」≠「這個人實際知道的知識」——凡超出這兩人具體人生經歷範圍的事，他一無所知，不得以任何形式展現或暗示。若靈魂帶有超前知識，必須面對當世人無法理解、甚至視為異端的現實阻力。`
                : `穿越靈魂：無（宿主自身意識覺醒）\n覺醒特質：宿主以某種難以言喻的直覺感知到歷史的走向，但仍完全受制於其原有的性格底色、認知框架與時代局限——覺醒帶來的是選擇的可能性，而非能力的提升`;
            // 宿主評鑑素材（序章用，讓 AI 深度理解宿主）
            const hostDeep = hostMod.deepAnalysis ? hostMod.deepAnalysis.slice(0, 2000) : '';
            const hostAnalysis = (!hostDeep && hostMod.analysis) ? hostMod.analysis.slice(0, 800) : '';
            let hostCtx = '';
            if (hostDeep) hostCtx += `【宿主深度評鑑】\n${hostDeep}\n\n`;
            else if (hostAnalysis) hostCtx += `【宿主賞析】\n${hostAnalysis}\n\n`;
            if (hostChat) hostCtx += `【宿主賞析對話摘錄】\n${hostChat}\n\n`;
            const recentGrowth = (soulSession.soulGrowth || []).slice(-3);
            const growthCtx = recentGrowth.length ? `【靈魂近況變化】\n${recentGrowth.map((g,i)=>`第${i+1}次：${g}`).join('\n')}\n\n` : '';
            const learningCtx = soul && chNum > 0 ? `【學習進度・第${chNum+1}章】靈魂對宿主時代的認識應與在此生活的時間相符：${chNum <= 3 ? '仍有大量盲點，許多事需靠親眼觀察、詢問或閱讀文書才能理解，行動常受制於對這個時代的陌生感。' : chNum <= 10 ? '已通過具體經歷逐步建立基本認識，但較深的領域（典章制度細節、人際派系脈絡、地方實情）仍有觸及不到之處。' : '對這個時代已有相當掌握，但仍保有原生時代的思維底色，遇到真正陌生的情境仍會暴露盲點。'}每個認知突破必須有具體觸發點（一次對話、一份文書、一個親身目睹的事件），不得憑空獲得。學習速度應符合靈魂的思維底色。\n\n` : '';
            const hostStateCtx = soulSession.hostState
                ? `【宿主當前心理狀態】${soulSession.hostState}\n本章必須從這個心理狀態出發；若發生轉變，必須有具體觸發事件作為依據。\n\n`
                : '';
            const tensionsCtx = (soulSession.pendingTensions || []).length > 0
                ? `【積累的未解決張力】本章必須至少觸及其中一條（不必解決，但必須讓讀者感受到它的存在）：\n${soulSession.pendingTensions.map((t,i)=>{
                    const obj = typeof t === 'string' ? {title:t, intensity:1, age:0} : t;
                    const iLabel = obj.intensity >= 4 ? '高強度' : obj.intensity >= 2 ? '中強度' : '初現';
                    const aLabel = obj.age > 0 ? `・已${obj.age}章未解` : '・本章新生';
                    return `${i+1}. [${iLabel}${aLabel}] ${obj.title}`;
                }).join('\n')}\n\n`
                : '';
            const shockedCtx = (soulSession.shockedFigures || []).length > 0
                ? `【已習慣主角行為的人物】${soulSession.shockedFigures.join('、')}——這些人曾對主角的意外效果感到震驚，現已習慣其行為模式。本章若有類似場景，這些人應以「習慣後的複雜態度」（警惕、無奈、依賴、厭倦等）回應，而非重新震驚。\n\n`
                : '';
            const figWithTension = soulSession.figureStates.filter(f => f.tension);
            const figTensionCtx = figWithTension.length > 0
                ? `【人物內在矛盾】\n${figWithTension.map(f=>`${f.name}：${f.tension}`).join('；')}\n\n`
                : '';
            const hostPhysiqueCtx = soulSession.hostPhysique
                ? `【宿主肉體慣性】\n生理限制：${soulSession.hostPhysique.physical}\n情感觸發點：${soulSession.hostPhysique.emotional}\n\n`
                : '';
            const suspectedFigures = (soulSession.shockedFigures || []).filter(name => {
                const fs = soulSession.figureStates.find(f => f.name === name);
                return fs && (fs.attitude === 'suspicious' || fs.attitude === 'enemy');
            });
            const suspectedCtx = suspectedFigures.length > 0
                ? `【已起疑心的人物】${suspectedFigures.join('、')}——這些人已察覺宿主異常，正暗中戒備。本章必須在對話或側寫中體現其試探或防範意圖，而非繼續震驚。\n\n`
                : '';
            const chapterTypeLabel = suggestedType || '行動章';
            const chapterTypeDesc = suggestedType === '靜章'
                ? '放緩節奏，不引入新的外部衝突；聚焦於人物關係細節、宿主內心狀態或環境氛圍的深度呈現'
                : suggestedType === '代價章'
                ? '主角的某個行為或決策必須帶來具體損失或新矛盾；「歪打正著」不得在本章出現；本章結束時問題必須仍然存在，不得被主角化解'
                : suggestedType === '人物章'
                ? '以某位配角的視角與困境為主體，主角居次要位置；深入挖掘該配角的處境、內在矛盾或命運轉折'
                : '帶入明確的外部衝突與決策，推動情節向前';
            const narrativeModeCtx = soulSession.narrativeMode === 'heroic'
                ? `【故事導演基調：改命爽文】歷史慣性存在但可以被突破——主角的決策在本故事中有較高成效，局勢演化允許逆轉，關鍵代價必須存在但整體走向允許主角較多的主動性和成就感；配角阻力真實但不至於無解。【爽文節奏限制】主角可以高效破局，但參考前章，不得連續兩章使用同類破局方式；公開威嚇、軍法壓制、肉身賭命、當眾逼迫、反向甩鍋視為同一類高壓破局。若前章已使用高壓破局，本章核心危機應改用情報佈局、談判交換、制度操作、外交借力、配角主動行動、事後補救，或讓危機暫時留下尾巴。每次勝利應帶來新的麻煩，如配角動機改變、第三方得益、資源被鎖、身份被懷疑或輿論反噬。\n\n`
                : soulSession.narrativeMode === 'tragedy'
                ? `【故事導演基調：悲劇史詩】歷史慣性極強——每個勝利背後都應有沉重的不可逆代價；配角有自己獨立的悲劇弧線；即使主角再努力，結局也走向悲壯而非大團圓；局勢的結構性困境比個人意志更大。同一類破局方式使用第二次時效果必須明顯遞減；使用第三次時必然帶來反效果。歷史慣性的壓力應體現在「嘗試本身就有代價」而非「失敗後可以補救」。\n\n`
                : `【故事導演基調：權謀正劇】慢節奏布局，多方派系博弈——短期成功常換來長期新問題；局勢複雜而難以完全掌控；人心難測，聯盟脆弱；主角的勝利應伴隨新的複雜性而非純粹的成就感。當危機涉及組織架構、軍政程序、財政帳目、交通通訊、技術流程、外交承認、輿論名聲等制度性阻力時，個人威壓無法直接繞過，必須以迂迴手段、妥協交換或真實代價換解；短期勝利的後遺症應在3章內具體浮現。\n\n`;
            const tensionForceCtx = (soulSession.tensionStaleChapters || 0) >= 5
                ? `【張力爆發強制要求】距上次張力解決或爆發已超過五章，本章必須明確觸發或解決 pendingTensions 中的某一條張力——可以是衝突爆發、計謀敗露、或局面發生不可逆的轉變。\n\n`
                : '';
            const keyEventsCtx = (soulSession.keyEvents || []).length > 0
                ? `【已發生事件（不得重演）】\n${soulSession.keyEvents.map((e,i)=>`${i+1}. ${e}`).join('\n')}\n\n`
                : '';
            const currentDateCtx = soulSession.currentDate
                ? `【當前時間】${soulSession.currentDate}\n\n`
                : '';
            const costStale = soulSession.lastCostChapter < 0 ? chNum : chNum - soulSession.lastCostChapter;
            const costForceCtx = chNum > 2 && costStale >= 4
                ? `【強制代價要求】主角已連續${costStale}章算計成功卻無真實代價。本章必須有一個主角主動做出的決策，在達成目標的同時帶來他沒有預料到的具體損失——某人因此死亡、某個盟友永久離去、或某張底牌被迫暴露，不得以「小挫折」或「口舌之輸」代替。\n\n`
                : '';
            const growthCooldownNote = chNum === 0
                ? `【系統限制】序章為靈魂適應期，本章嚴禁填寫 SOULGROWTH。`
                : (soulSession.lastGrowthChapter >= 0 && chNum - soulSession.lastGrowthChapter <= 1)
                ? `【系統強制限制】距離上次靈魂轉變過短，本章嚴禁產生任何靈魂層面的成長或大徹大悟，只能專注於處理當下危機。SOULGROWTH 必須留空。`
                : '';
            const firstChapterTags = chNum === 0 ? `\n[HOSTPHYSIQUE]生理限制：{20字以內描述宿主身體對靈魂的生理阻力}｜情感觸發點：{30字以內描述宿主見到特定人物或情境時的本能反應}[/HOSTPHYSIQUE]` : '';
            const isFirst = chNum === 0;
            const firstExtra = isFirst
                ? `\n本章為序章，請充分展開：\n1. 詳述穿越時刻的歷史背景、局勢全貌與暗流\n2. 深入描述宿主當前的處境、可用資源、潛在危機與機遇（請參考上方宿主評鑑資料中對其性格、能力、處境的分析）\n3. 引入4-6位關鍵周遭人物，各有清晰的性格與利益立場\n4. 以一個具體場景或對話開場，帶入沉浸感`
                : `\n承接前章，選擇下一個最有張力的情節節點，充分展開衝突、對話、心理與環境細節。${recentTitles ? `近兩章（${recentTitles}）若已圍繞同一核心議題，本章必須將重心轉移至新維度（新衝突面向、新人物關係、新地點環境或新挑戰），拓展故事的廣度而非繼續深挖同一個圈子。` : ''}`;
            return `你是頂尖歷史穿越小說作家兼嚴謹史學者，以史書體裁（但沉浸生動）寫作。

【魂穿設定】
宿主：${host?.name}（${host?.rank}，${host?.title||''}，${host?.dynasty||''}）
${soulLine}
穿越時刻：${soulSession.moment?.title}（${yStr(soulSession.moment?.year||0)}）
時刻背景：${soulSession.moment?.desc}${soulSession.moment?.strategicProfile ? `\n\n【時刻戰略全覽】\n${soulSession.moment.strategicProfile}` : ''}
${hostCtx ? `\n${hostCtx}` : ''}

${ctx}${currentDateCtx}${hostStateCtx}${tensionsCtx}${figCtx}${figTensionCtx}${suspectedCtx}${shockedCtx}${keyEventsCtx}${compatCtx}${soulEssenceCtx}${hostPhysiqueCtx}${growthCtx}${learningCtx}${tensionForceCtx}${costForceCtx}

請寫出${label}（2000-3000字）：${firstExtra}

${narrativeModeCtx}【A·絕對禁令】優先級最高，任何情況不得違反：
1. 【已識之人】上方「已登場人物」中所有人物，主角已與之有過真實互動。他們出場時，對話語氣、稱謂方式、信任或警戒程度必須體現累積關係的重量；禁止以「謹慎打量」「小心試探」等初見語氣描寫已有多次互動的人物；主角也不必重新評估這些人的基本立場，除非本章發生了改變立場的具體事件
2. 【計謀解說禁令】任何計謀或決策的成效，禁止在事後以主角內心獨白或旁白直接說明邏輯——不得出現「他成功地讓對方相信了……」「某人突然意識到……的用意」之類的解說句。若必須揭示計謀，只能透過對方的行為變化、沉默、或結果反推讓讀者自行感知，不得由敘事者直接宣告
3. 【知識邊界】知識來自具體的人生經歷，不來自時代，也不來自身份類別。每個人實際知道什麼，必須從其具體的生平、教育背景、真實人際圈、親身經歷過的事件去推斷——而非套用「帝王應知」「武將應懂」之類的刻板印象。「那個時代存在的知識」≠「他個人知道的知識」。若靈魂帶有超前知識，必須面對當世人無法理解、甚至視為異端的現實阻力
4. 【特質標籤禁止入文】靈魂特質標籤（「死後清明」「性格缺陷」等後設描述）絕不能出現在正文中，只能透過行為與心理自然呈現，讓讀者自行感知
5. 【後設文字禁令】正文不得輸出「本章將」「本章視角」「相性報告摘要」「作者寫作參考」「以下為」等後設說明或框架性文字；正文應直接開始敘事

【B·本章任務】
章節類型：${chapterTypeLabel}——${chapterTypeDesc}
本章敘事目標：${narrativeGoal}
${growthCooldownNote}
【C·敘事偏好】根據本章情境，自然選用2-3條體現即可，不必全部塞入：
- 第三人稱史書體裁，沉浸感強，具體人名、事件、多人對白、環境描寫，充分展開場景與人物心理
- 【文風時代感】人物對話須帶有所處時代的語言質感與節奏，避免現代白話語氣；心理描寫應以當時人的概念框架、意象與比喻為基礎
- 【蝴蝶效應】穿越者的每個重大決定都會產生連鎖改變，請根據穿越者實際做出的選擇推演邏輯後果，而非讓原有歷史事件按序發生
- 【歷史慣性】周遭人物有自己的利益邏輯、偏見與情感，不會輕易被說服；穿越者的計劃可能因沒預料到的因素而偏轉，不保證意志能改變現實
- 【靈魂特質】穿越靈魂的思維底色具體體現在本章的決策、對話與內心獨白中，展現其與宿主原有性格的根本差異
- 【言行氣質】靈魂的外顯個性落實在對話語氣與日常舉止上：直接或迂迴、強勢或克制；他面對不同身分的人時態度如何變化
- 【宿主肉體雙向性】宿主肉體記憶有時干擾靈魂判斷，有時意外提供幫助——雙向互動應隨章節演化，從排斥逐漸轉向謹慎利用；出現時必須是具體的身體行為
- 【參照系節制】每章至多呈現一次靈魂以原生時代框架理解眼前局勢，且絕不由主角在內心獨白中明確說出「此人如同某某」；遭遇真正陌生事物時必須有認知震撼
- 【配角主動時刻】每3章內，至少有一個場景讓某位配角採取了主角完全沒有預料到的主動行動，迫使主角轉為被動回應
- 【靈魂視角】${soulMomentIsPostDeath ? '靈魂的死後自我意識可以整章完全不出現；若出現，只能是身體層面的本能反應，絕不讓清明轉化為迴避缺點的能力' : '此靈魂更衝動、更在乎當下利益、更容易被情緒驅動；他對自己命運走向完全無知'}
- 【靈魂成長】成長若發生，必須有具體代價或新的矛盾隨之而來；舊缺陷可能只是換個形式重現，不接受無摩擦的正向轉變
- 【時間流動】透過至少一個具體的時間錨點自然融入敘事（某年某月、距上次事件的天數、季節細節），以及人物疲態積累或日夜交替，而非直接在開頭列出日期
- 宿主的歷史命運並非注定。若宿主在本章中死亡，文末加：【宿主殞落：一句話原因】

正文結束後換行輸出（系統解析用，勿計入正文）：
[FIGURES][{"name":"人名","rank":"評級","summary":"與主角的累積關係摘要（首次見面至今，15字以內；若本章為初次登場則寫「本章初登場：一句話描述初次互動」）","change":"本章動態20字內","attitude":"ally/enemy/neutral/suspicious","tension":"此人當前內在矛盾（選填，一句話；無則省略此欄）"},...][/FIGURES]
[CHAPTERTITLE]4-8字章節標題[/CHAPTERTITLE]
[SOULGROWTH]若本章靈魂有任何內在轉變，一句話描述；無明顯轉變或系統限制則留空[/SOULGROWTH]
[CHAPTERTYPE]行動章/靜章/代價章/人物章（填寫本章實際類型）[/CHAPTERTYPE]
[HOSTSTATE]一句話描述宿主或穿越靈魂此刻的心理狀態（10-20字）[/HOSTSTATE]
[TENSIONS_ADD]本章新產生的未解決張力（用｜分隔，最多2條；若無則留空）[/TENSIONS_ADD]
[TENSIONS_OUTCOME]若本章解決或引爆了某條積累張力，填寫：resolved:張力關鍵詞 或 exploded:張力關鍵詞（引爆時必須同時在TENSIONS_ADD填入後續張力）；若無則留空[/TENSIONS_OUTCOME]
[COST_PAID]若本章主角的某個決策在成功的同時帶來了真實的不可逆代價（人員死亡、盟友離去、底牌暴露），一句話描述這個代價；若無則留空[/COST_PAID]
[EVENTS_ADD]本章發生的不可逆關鍵事件（最多2條，每條15字以內，格式：「時間：事件」；若無新的不可逆事件則留空）[/EVENTS_ADD]
[CHAPTERDATE]本章結束時的時間點（格式如「1936年12月13日深夜」或「建安五年三月初」；盡量精確到日）[/CHAPTERDATE]
[SHOCKED]本章首次因主角行為感到意外效果震驚的人物（用｜分隔；若無或已在已習慣名單中則留空）[/SHOCKED]
[GLOBALSUMMARY]更新全局主線摘要（400字以內）：專注記錄①不可逆的歷史事件與局勢轉變②主角已暴露的底牌與行動後果③配角生死與陣營轉換④所有pendingTensions的當前狀態。人際關係由FIGURES的summary欄位負責，此處不重複。忽略過場細節與日常互動。[/GLOBALSUMMARY]${firstChapterTags}`;
        }
    };
})();
