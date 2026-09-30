'use strict';
// Rebuild from the four checked-in, source-referenced research inputs. This
// builder never reads private articles and never generates historical values.
const fs = require('node:fs');
const path = require('node:path');
const history = require('../backend/static/js/history-data.js');
const ROOT = path.join(__dirname, '..');
const INPUT = path.join(ROOT, 'data/history-research');
const OUTPUT = path.join(ROOT, 'backend/static/data/history/chuhan-foundation.v1.json');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/history-package.schema.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const unique = values => [...new Set(values)];
const slug = id => id.slice(id.indexOf(':') + 1);
const text = (value, fallback = '本包未另外核定。') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const FORBIDDEN = new Set(['analysis', 'deepAnalysis', 'soulEssence', 'fullResult', 'desc', 'poem', 'stats']);
function rejectPrivateFields(value, at = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.has(key)) throw new Error('Private library field in research input: ' + at + '.' + key);
    rejectPrivateFields(child, at + '.' + key);
  }
}
// Manually checked against the original 962-record snapshot, 2026-09-30.
// Only identity metadata is retained. The ID prefix is not a type classifier.
const IDENTITIES = [
  ['emperor_漢高祖_279096455', '漢高祖', 'emperor'],
  ['general_韓信_306677029', '韓信', 'general'],
  ['general_劉邦_306143732', '劉邦', 'general'],
  ['general_項羽_306690831', '項羽', 'general'],
  ['general_章邯_306463878', '章邯', 'general'],
  ['minister_蕭何_2004244066', '蕭何', 'minister'],
  ['minister_張良_2003953844', '張良', 'minister'],
  ['minister_陳平_2004383034', '陳平', 'minister'],
  ['general_彭越_306245236', '彭越', 'general'],
  ['general_英布_306514921', '英布', 'general'],
  ['general_龍且_306737886', '龍且', 'general'],
  ['general_張耳_306240085', '張耳', 'general'],
  ['general_范增_306514098', '范增', 'general'],
  ['general_項伯_306678401', '項伯', 'general'],
  ['general_蒯通_306541570', '蒯通', 'minister'],
  ['general_子嬰_306199703', '子嬰', 'general'],
  ['general_灌嬰_306366235', '灌嬰', 'general'],
  ['minister_酈食其_2005544997', '酈食其', 'minister'],
  ['general_王離_306407278', '王離', 'general'],
  ['general_陳餘_306684860', '陳餘', 'general']
].map(([recordId, name, type]) => ({ recordId, name, type }));
const identityById = new Map(IDENTITIES.map(x => [x.recordId, x]));
const PLACE_ALIASES = { 'place:guan-zhong': 'place:guanzhong' };
const placeId = id => PLACE_ALIASES[id] || id;
const EXTRA_PLACES = {
  'julu': ['鉅鹿', 'city'], 'yin-xu': ['殷虛', 'site'], 'huan-shui': ['洹水', 'river'],
  'wuguan': ['武關', 'pass'], 'lantian': ['藍田', 'city'], 'yao-guan': ['嶢關', 'pass'],
  'zhi-dao': ['軹道旁', 'site'], 'ba-shang': ['霸上', 'region'], 'xin-an': ['新安', 'city'],
  'xi': ['戲', 'site'], 'feiqiu': ['廢丘', 'city'], 'yueyang': ['櫟陽', 'city'],
  'gaonu': ['高奴', 'city'], 'bao-zhong': ['襃中', 'route-area'], 'shi-zhong': ['蝕中', 'route-area'],
  'du-nan': ['杜南', 'route-area'], 'gu-dao': ['故道', 'route-area'], 'chencang': ['陳倉', 'city'],
  'haozhi': ['好畤', 'city'], 'xiayi': ['下邑', 'city'], 'jiujiang': ['九江', 'region'],
  'huainan': ['淮南', 'region'], 'liu': ['六', 'city'], 'zhi-water': ['泜水', 'river'],
  'pingyuan': ['平原', 'city'], 'lixia': ['歷下', 'site'], 'linzi': ['臨菑', 'city'],
  'gaomi': ['高密', 'city'], 'gaomi-west': ['高密西', 'battle-area'], 'chengyang': ['城陽', 'city'],
  'qi-region': ['齊', 'region'], 'guangwu': ['廣武', 'site'], 'honggou': ['鴻溝', 'route-area'],
  'yangxia-south': ['陽夏南', 'region'], 'chen': ['陳', 'city'], 'suiyang': ['睢陽', 'city'],
  'gucheng': ['穀城', 'city'], 'chengfu': ['城父', 'city'], 'dongcheng': ['東城', 'city'],
  'wujiang': ['烏江', 'site'], 'bi-ling': ['碧陵（卷090異文候選）', 'site']
};
const placeByName = new Map(Object.entries(EXTRA_PLACES).map(([id, [name]]) => [name, 'place:' + id]));
placeByName.set('碧陵（卷090用字）', 'place:bi-ling');
placeByName.set('南鄭／漢中', 'place:nanzheng');
const PERSON_NAMES = {
  'person:fan-kuai': '樊噲', 'person:sima-xin': '司馬欣', 'person:dong-yi': '董翳',
  'person:chu-huai-wang-xin': '楚懷王心', 'person:han-cheng': '韓王成',
  'person:sui-he': '隨何', 'person:tian-guang': '田廣', 'person:zhao-xie': '趙歇',
  'person:zhou-yin': '周殷', 'person:liu-jia': '劉賈'
};
function unknownTime(original, note) {
  return { earliest: null, latest: null, precision: 'unknown', original: text(original, '本包未限定紀年'), normalization: 'not-normalized', review: 'provisional', note: text(note, '只保留原文記述，不外推生存起止或完整統治期。') };
}
function eventTime(event) {
  if (event.date) return {
    earliest: clone(event.date.earliest), latest: clone(event.date.latest), precision: event.date.precision,
    original: event.date.original, normalization: 'regnal-year-band', review: 'provisional',
    note: [event.date.calendar, ...(event.date.notes || [])].join('；')
  };
  const date = event.dating, band = date.bceMapping;
  return { earliest: { era: 'BCE', year: band.earliestYearBCE }, latest: { era: 'BCE', year: band.latestYearBCE },
    precision: band.earliestYearBCE === band.latestYearBCE ? 'year' : 'range', original: date.rawLabels.join('；'),
    normalization: 'regnal-year-band', review: 'provisional', note: [band.method, date.uncertainty].filter(Boolean).join('；') };
}
function evidence(input, use = 'direct-statement') {
  return input.map(item => ({ sourceId: item.sourceId, locator: text(item.locator), excerpt: item.excerpt || item.quote || null, use }));
}
function normalizedSource(source) {
  const wasRead = source.verification === 'opened-and-read' || source.webOpened === true || source.accessVerified === true || /已成功開啟全文/.test(source.access || '');
  if (!wasRead) throw new Error('Research source was not opened and read: ' + source.id);
  const chapter = source.id.split('-').pop();
  const ancient = source.id.startsWith('source:shiji-');
  const titles = { '007': '項羽本紀', '008': '高祖本紀', '016': '秦楚之際月表', '053': '蕭相國世家', '055': '留侯世家', '089': '張耳陳餘列傳', '090': '魏豹彭越列傳', '091': '黥布列傳', '092': '淮陰侯列傳' };
  const versionUrl = source.versionUrl || (source.id === 'source:shiji-007' ? 'https://zh.wikisource.org/w/index.php?title=史記/卷007&oldid=5978360' : null);
  return {
    id: source.id, work: source.work || (ancient ? '史記' : source.title), section: source.section || (ancient ? '卷' + chapter + '·' + titles[chapter] : source.title + '（' + source.publishedAt + '）'),
    author: source.author || (ancient ? '司馬遷' : source.pageAuthor || source.publisher), kind: source.kind || (ancient ? 'primary-text' : 'institutional-reference'), url: source.url,
    versionUrl,
    accessedOn: source.accessedOn || source.accessedAt || source.openedOn || '2026-10-01', verification: 'opened-and-read',
    editionNote: text(source.editionNote || source.editionCaution || source.transcriptionNote, ancient ? '維基文庫公開轉錄；已讀正文，未與紙本校勘。' : source.publisher + '公開網頁；' + source.accessMethod + '。不是完整發掘報告或同行評審定論。') + (versionUrl ? '' : ' 未固定電子修訂版本，回查須留意後續網頁更動。'),
    reuseNote: text(source.reuseNote || source.rights?.reuse, ancient ? '保留司馬遷、《史記》卷名與查閱網址；古代原典與現代網頁編輯內容分開。本包僅採短節錄及自行整理。維基文庫版權頁列 CC BY-SA 4.0／GFDL，不移用現代註釋或整頁。' : '現代文字有著作權；未確認整頁再利用授權。只保存自行整理主張與來源連結，不打包全文、照片、地圖。'),
    limitations: text(source.limitations || source.caveat, ancient ? '原典敘事不等同獨立確證；同書篇章交叉核對不是獨立見證。未核考古、人口、兵力或經濟量化。' : '只作該機構或署名作者在刊載日期的主張，不代表學界共識；未裁決現代精確位置。') + (chapter === '016' ? ' 網頁新增公元前年欄不是司馬遷原文，僅採原紀年、月序與記事。' : '')
  };
}
function buildPackage(inputs) {
  Object.values(inputs).forEach(input => rejectPrivateFields(input));
  const { early, later, geo, supply } = inputs;
  const pkg = {
    format: 'dynasty-history-package', schemaVersion: 1, packageId: 'history:chuhan-foundation', packageVersion: '1.0.0',
    title: '楚漢共用歷史資料層：秦亡至垓下的選定事件', locale: 'zh-Hant', createdOn: '2026-10-01',
    coverage: { target: '核心207–202 BCE；以秦亡、分封、楚漢關鍵合作與供給問題作選定事件切片。',
      window: { start: { era: 'BCE', year: 208 }, end: { era: 'BCE', year: 202 } }, completeness: 'curated-slice',
      selection: ['22件來源可回查的關鍵事件', '人物身份、事件角色、原紀年及相對先後', '古地名提及與事件內關係', '有出處的移動方向與定性行政／供給機制'],
      excluded: ['十八王全表與完整戰爭年表', '全部962人的履歷及完整世界', '全疆域、多邊形、古今行政沿革與現代座標', '人口、兵數、傷亡、糧產、庫容、稅率、物價、距離與運輸時間', '人物固定人格、技能、行動成本、遊戲平衡與虛構對白'],
      missing: ['部分歷史人物沒有原人物庫條目，以context-only保存', '出生紀年未補查；死亡敘事仍存事件，但未完整建立人物生命年表，life暫unknown', '公曆朔日、古月與現代月份換算未完成', '名義分封與軍事實控未建立完整時序', '維基文庫電子轉錄未全面核對底本異文'],
      datePolicy: '原紀年優先，年帶均為regnal-year-band/provisional；不以電子月表現代新增公元前年欄作精確轉換；異說和partial order並存。',
      geographyPolicy: '所有coordinates與modernIdentification均null；古名節點不是現代地圖。路線只限記述移動／供給方向，不構成可任意通行的路網。',
      economyPolicy: '僅保存原典中的行政與供給機制。quantities留空，缺統計不補造成稅率、糧產或可公平比較的國力。' },
    librarySnapshot: { date: '2026-09-30', totalRecords: 962, roleIdentityPolicy: '同一歷史人可對應多個原庫角色條目；保留recordId/name/type，不以分類充當當時職位。', privateTextPolicy: '不含原庫analysis/deepAnalysis/soulEssence/desc/poem/stats或史冊全文；只保存手核身份參照。' },
    sources: [], persons: [], places: [], factions: [], events: [], claims: [], relations: [], routes: [], economy: [], disputes: []
  };
  const sourceMap = new Map();
  for (const group of [early, later, geo, supply]) for (const item of group.sources || []) {
    const normalized = normalizedSource(item);
    if (!sourceMap.has(item.id)) sourceMap.set(item.id, normalized);
    else if (item.versionUrl) sourceMap.set(item.id, { ...sourceMap.get(item.id), versionUrl: item.versionUrl });
  }
  pkg.sources = [...sourceMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const persons = new Map(), places = new Map(), factions = new Map(), claims = new Map(), events = new Map();
  function addClaim(id, subjectId, predicate, objectIds, statement, time, proof, options = {}) {
    if (claims.has(id)) throw new Error('Duplicate claim ' + id);
    if (!proof || !proof.length) throw new Error('Missing evidence ' + id);
    const claim = { id, subjectId, predicate, objectIds: unique(objectIds || []), statement: text(statement), time: clone(time),
      epistemic: options.epistemic || 'source-report', evidence: clone(proof), review: options.review || 'source-checked',
      caveat: text(options.caveat, '只表示此來源有此記述，並非獨立確證；時間與角色不外推到事件之外。'), alternatives: options.alternatives || [] };
    claims.set(id, claim); return id;
  }
  function addPerson(id, name, aliases = [], ids = [], note = '') {
    if (persons.has(id)) {
      const item = persons.get(id); item.aliases = unique([...item.aliases, ...aliases]);
      for (const ref of ids) if (!item.libraryRefs.some(x => x.recordId === ref)) item.libraryRefs.push(libraryRef(ref));
      item.coverage = item.libraryRefs.length ? 'linked-library' : 'context-only';
      if (note && !item.note.includes(note)) item.note += ' ' + note;
      return item;
    }
    const item = { id, name: text(name || PERSON_NAMES[id], id), aliases: unique(aliases), libraryRefs: ids.map(libraryRef),
      coverage: ids.length ? 'linked-library' : 'context-only', life: { birth: unknownTime('本切片未補查出生紀年', '不以活動年帶推斷出生。'), death: unknownTime('本切片未完整補查死亡紀年', '事件中的死亡敘事另存主張；此欄尚未完成個人生命年表核對。') },
      claimIds: [], note: text(note, ids.length ? '身份對應已按原962庫姓名、ID、actual type手核；文章仍存原庫。' : '原庫未查到可確定的對應；此為背景人物，不冒充原962條目。') };
    persons.set(id, item); return item;
  }
  function libraryRef(id) {
    const item = identityById.get(id); if (!item) throw new Error('Identity was not manually checked: ' + id);
    return { ...item, match: 'manual-identity-match', note: item.name === '蒯通' ? '原ID前綴general但actual type為minister；保留原分類。' : '只作歷史身份連接；原庫分類與後世稱號不決定此事件職位。' };
  }
  for (const item of early.personLinks) addPerson(item.id, item.historicalName, item.aliases || [], item.libraryIds, item.note);
  for (const item of later.libraryBindings) addPerson(item.personId, item.name, item.aliases || [], item.libraryIds, item.note);
  function addPlace(id, name, kind = 'site', note = '') {
    id = placeId(id);
    if (!places.has(id)) places.set(id, { id, name: text(name), aliases: [], kind, coordinates: null, locationPrecision: 'unlocated', modernIdentification: null, claimIds: [], note: text(note, '僅保存來源中的古名；未做現代位置、行政歸屬或邊界查證。') });
    return places.get(id);
  }
  // Geo records have their own claim provenance, not a universal source flag.
  integrateGeography(geo, pkg, { addClaim, addPerson, addPlace, persons, places, factions, claims });
  for (const place of supply.additionalPlaces || []) {
    const item = addPlace(place.id, place.name, place.kind, place.note);
    const id = addClaim('claim:' + slug(place.id) + '-source-name', item.id, 'source-place-name', [], '原文在指定段落使用「' + item.name + '」這個地名。', unknownTime(place.locator, '古名出現的段落已讀；不從名稱推定現代位置。'), evidence([{ sourceId: place.sourceId, locator: place.locator }]));
    item.claimIds.push(id);
  }
  const rawEvents = [...early.events, ...later.events];
  for (const raw of rawEvents) {
    const time = eventTime(raw);
    const event = { id: raw.id, title: raw.title, summary: '', time, placeIds: [], contexts: [], claimIds: [],
      orderAfter: clone(raw.ordering?.after || raw.relativeChronology?.after || []),
      orderingNote: text(raw.ordering?.note || '只保存來源敘事明示的先後；未列出的兩件事不自動排成全序。') + (raw.relativeChronology?.afterExternal ? ' 外部前界：' + raw.relativeChronology.afterExternal + '（未另建事件）。' : ''),
      note: [...(raw.limitations || []), ...(raw.uncertainties || []), ...(raw.editorInterpretations || [])].join('；') || '本條不添加遊戲規則、現代月份或未核數值。' };
    if (raw.id === 'event:chuhan-han-xin-appointed') event.orderAfter.push('event:liu-bang-enters-hanzhong');
    events.set(event.id, event);
  }
  for (const raw of rawEvents) for (const next of raw.ordering?.before || raw.relativeChronology?.before || []) {
    if (!events.has(next)) throw new Error('Missing ordering target ' + next);
    events.get(next).orderAfter.push(raw.id);
  }
  for (const raw of rawEvents) {
    const event = events.get(raw.id), late = !!raw.dating;
    const baseProof = late ? evidence(raw.dating.sourceRefs, 'chronology-context') : evidence(raw.evidence, 'chronology-context');
    const dateClaim = addClaim('claim:' + slug(event.id) + '-chronology', event.id, 'source-chronology', [], '原紀年與相對時間：' + event.time.original, event.time, baseProof, { epistemic: 'editorial-synthesis', review: 'provisional', caveat: event.time.note });
    event.claimIds.push(dateClaim);
    const factual = late ? raw.claims : raw.claims.map((item, index) => ({ id: 'reported-' + (index + 1), text: item.statement, sourceRefs: raw.evidence }));
    for (const item of factual) {
      // A research scope declaration is metadata, not a historical source claim.
      if (item.text.startsWith('本切片只列')) continue;
      const id = addClaim('claim:' + slug(event.id) + '-' + item.id, event.id, 'event-action', [], item.text, event.time, evidence(item.sourceRefs),
        { epistemic: /不能|不宜|不是|不等於/.test(item.text) ? 'editorial-synthesis' : 'source-report', caveat: text(item.caveat, '同書本紀與列傳比較不算獨立目擊證據；敘事與編輯解釋分開。') });
      event.claimIds.push(id);
      if (!event.summary) event.summary = item.text;
    }
    const rawPlaces = late ? raw.places : raw.placeIds.map(id => ({ placeId: id }));
    for (const ref of rawPlaces) {
      let id = ref.placeId ? placeId(ref.placeId) : placeByName.get(ref.ancientName);
      if (ref.ancientName === '南鄭／漢中') id = 'place:nanzheng';
      if (!id) throw new Error('Ancient place needs explicit identity: ' + ref.ancientName);
      const extra = EXTRA_PLACES[slug(id)];
      const item = places.get(id) || addPlace(id, ref.ancientName || extra?.[0], extra?.[1]);
      event.placeIds.push(id);
      const sourceForPlace = late ? {
        'event:chuhan-han-xin-appointed': '092', 'event:chuhan-return-sanqin': '008', 'event:chuhan-xiayi-plan': '055',
        'event:chuhan-ying-bu-joins': '091', 'event:chuhan-jingxing': '092', 'event:chuhan-attack-qi': '092',
        'event:chuhan-wei-river': '092', 'event:chuhan-han-xin-qi-king': '092', 'event:chuhan-honggou': '007',
        'event:chuhan-guling': '007', 'event:chuhan-gaixia': ['place:chengfu', 'place:jiujiang'].includes(id) ? '008' : '007'
      }[raw.id] : raw.id === 'event:xiang-yu-distributes-kingdoms' ? '007' : raw.evidence[0].sourceId.slice(-3);
      const anchor = late ? raw.claims.flatMap(x => x.sourceRefs).find(x => x.sourceId === 'source:shiji-' + sourceForPlace)?.locator
        || raw.dating.sourceRefs.find(x => x.sourceId === 'source:shiji-' + sourceForPlace)?.locator : raw.evidence.find(x => x.sourceId === 'source:shiji-' + sourceForPlace)?.locator;
      const proof = evidence([{ sourceId: 'source:shiji-' + sourceForPlace, locator: text(anchor) + '；原名「' + (ref.ancientName || item.name) + '」所在的相關前後行軍／策議段' }]);
      const claimId = addClaim('claim:' + slug(event.id) + '-place-' + slug(id), item.id, 'event-location-mention', [event.id],
        '所讀事件段落提及「' + (ref.ancientName || item.name) + '」；此節點只連接古名與敘事，不主張所有參與者都位於此處。', event.time, proof,
        { caveat: '事件可能包括行軍、使者往返或前後階段；沒有現代定位、距離、完整疆界或同場認定。' });
      item.claimIds.push(claimId); event.claimIds.push(claimId);
    }
    let actors = late ? raw.actors.map(x => ({ ...x })) : raw.participants.map(x => ({ personId: x.personId, roleAtEvent: x.role, factionId: x.factionIds[0] || null, note: x.note }));
    if (raw.id === 'event:chuhan-ying-bu-joins') actors.push({ personId: 'person:sui-he', roleAtEvent: '漢方使者，勸說英布並與其歸漢', factionId: 'faction:han', sourceRefs: [{ sourceId: 'source:shiji-091', locator: '隨何說布至閒行與何俱歸漢段' }] });
    if (raw.id === 'event:chuhan-jingxing') actors.push({ personId: 'person:zhao-xie', roleAtEvent: '趙王，原文記其在井陘戰後被擒', factionId: 'faction:zhao', sourceRefs: [{ sourceId: 'source:shiji-092', locator: '斬成安君泜水上、禽趙王歇段' }] });
    if (raw.id === 'event:chuhan-attack-qi') actors.push({ personId: 'person:tian-guang', roleAtEvent: '田氏齊王，殺酈食其並走高密求楚援', factionId: 'faction:qi', sourceRefs: [{ sourceId: 'source:shiji-092', locator: '齊王亨酈生、走高密段' }] });
    if (raw.id === 'event:chuhan-gaixia') actors.push(
      { personId: 'person:zhou-yin', roleAtEvent: '楚大司馬，原文記其叛楚、舉九江兵與諸侯會合', factionId: null, sourceRefs: [{ sourceId: 'source:shiji-008', locator: '劉賈入楚地圍壽春、楚大司馬周殷舉九江兵至大會垓下段' }] },
      { personId: 'person:liu-jia', roleAtEvent: '漢方將軍，原文記其入楚地、圍壽春並誘周殷', factionId: 'faction:han', sourceRefs: [{ sourceId: 'source:shiji-007', locator: '漢遣將軍劉賈入楚地、誘楚大司馬周殷段' }] }
    );
    for (const actor of actors) {
      const person = persons.get(actor.personId) || addPerson(actor.personId);
      let faction = actor.factionId;
      if (!late && faction === 'faction:chu' && raw.id !== 'event:xiang-yu-distributes-kingdoms') faction = 'faction:chu-coalition';
      if (actor.personId === 'person:chu-huai-wang-xin') faction = 'faction:chu-coalition';
      if (['event:zhang-han-surrenders', 'event:xinan-killing-surrendered-qin'].includes(raw.id) && ['person:zhang-han', 'person:sima-xin'].includes(actor.personId)) faction = null;
      if (actor.personId === 'person:zhang-han' && raw.id === 'event:chuhan-return-sanqin') faction = 'faction:yong';
      if (actor.personId === 'person:kuai-tong' || actor.personId === 'person:peng-yue') faction = null;
      if (actor.personId === 'person:ying-bu' && raw.id === 'event:chuhan-xiayi-plan') faction = null;
      if (actor.personId === 'person:zi-ying' && raw.id === 'event:xiang-yu-destroys-qin-court') faction = null;
      const mentioned = raw.id === 'event:chuhan-xiayi-plan' && ['person:han-xin', 'person:ying-bu', 'person:peng-yue'].includes(actor.personId)
        || raw.id === 'event:chuhan-honggou' && actor.personId === 'person:peng-yue';
      const participation = mentioned ? 'mentioned' : 'reported-action';
      let proof = actor.sourceRefs ? evidence(actor.sourceRefs) : evidence(raw.evidence.filter(x => actor.personId === 'person:zhang-liang' ? x.sourceId === 'source:shiji-055' : x.sourceId !== 'source:shiji-016'));
      if (!proof.length) proof = evidence(raw.evidence);
      const note = [actor.note, actor.relationshipToChu, actor.unmodeledFactionName ? '來源勢力名稱：' + actor.unmodeledFactionName : '',
        mentioned ? '在本事件的談話或背景記述中被提及；不據此判定本人在場。' : '原文有相關行動或被任命／受降記述；不等於人物同時同地。',
        faction === null ? '不把合作、勸諫或降軍留置直接變成正式勢力歸屬。' : '勢力連接只限本事件版本，不表示整年或終身任職。'].filter(Boolean).join('；');
      const claimId = addClaim('claim:' + slug(event.id) + '-role-' + slug(person.id), person.id, 'event-role', [event.id, ...(faction ? [faction] : [])],
        '本事件原文角色／行動：' + actor.roleAtEvent + '。' + (mentioned ? '此處為提及，未證本人在場。' : ''), event.time, proof, { caveat: note });
      person.claimIds.push(claimId); event.claimIds.push(claimId);
      event.contexts.push({ personId: person.id, factionId: faction, role: actor.roleAtEvent, participation, claimIds: [claimId], note });
    }
    for (const [index, conflict] of (raw.conflicts || []).entries()) {
      const alternatives = conflict.readings.map(x => x.sourceId + '：' + x.reading);
      const proof = conflict.readings.map(x => ({ sourceId: x.sourceId, locator: raw.evidence.find(e => e.sourceId === x.sourceId)?.locator || conflict.topic, excerpt: null, use: 'cross-check' }));
      const id = addClaim('claim:' + slug(event.id) + '-variant-' + (index + 1), event.id, 'source-variant', [], conflict.topic, event.time, proof, { epistemic: 'editorial-synthesis', review: 'disputed', alternatives, caveat: conflict.resolution });
      event.claimIds.push(id);
      pkg.disputes.push({ id: 'dispute:' + slug(event.id) + '-' + (index + 1), title: event.title + '：' + conflict.topic, claimIds: [id, dateClaim], treatment: 'retain-alternatives', note: conflict.resolution });
    }
    if (late && (/discrepancy/.test(raw.dating.precision) || raw.uncertainties.some(x => /不合|不同|差異|差别/.test(x)))) {
      const alternatives = raw.dating.rawLabels.concat(raw.uncertainties.filter(x => /不合|不同|差異|六年|碧陵/.test(x)));
      const id = addClaim('claim:' + slug(event.id) + '-source-variants', event.id, 'source-variant', [], '來源紀年、事件階段或名稱的差異保留。', event.time,
        evidence(raw.dating.sourceRefs, 'cross-check'), { epistemic: 'editorial-synthesis', review: 'disputed', alternatives, caveat: raw.dating.uncertainty + '；' + raw.uncertainties.join('；') });
      event.claimIds.push(id);
      pkg.disputes.push({ id: 'dispute:' + slug(event.id), title: event.title + '：紀年／階段差異', claimIds: [id, dateClaim], treatment: 'retain-alternatives', note: raw.dating.uncertainty });
    }
    event.placeIds = unique(event.placeIds); event.orderAfter = unique(event.orderAfter);
    if (!event.summary) event.summary = event.title;
  }
  // Remaining integration steps (geographical event relations, economy and
  // witnessed movement) are appended below; they never infer a complete world.
  integrateSupply(pkg, supply, { addClaim, persons, places, events });
  integrateRelations(pkg, rawEvents, { addClaim, persons, events });
  integrateGeoConnections(geo, pkg, { addClaim, persons, places, events, claims });
  pkg.persons = [...persons.values()].filter(x => x.claimIds.length);
  pkg.places = [...places.values()]; pkg.factions = [...factions.values()]; pkg.events = [...events.values()];
  pkg.claims = [...claims.values()];
  for (const table of ['sources', 'persons', 'places', 'factions', 'claims', 'relations', 'routes', 'economy', 'disputes']) pkg[table].sort((a, b) => a.id.localeCompare(b.id));
  for (const table of ['persons', 'places', 'factions']) for (const item of pkg[table]) item.claimIds = unique(item.claimIds);
  traditionalPresentation(pkg);
  const validation = history.validatePackage(pkg, SCHEMA);
  if (!validation.valid) throw new Error('Package validation failed:\n' + validation.errors.join('\n'));
  return pkg;
}
function integrateGeography(geo, pkg, api) {
  for (const item of geo.claims) {
    const modern = /modern|research_status|location_disagreement/.test(item.claimKind);
    const variant = item.conflictGroup || item.certainty === 'source_claim_disputed';
    const peers = geo.claims.filter(x => item.conflictGroup ? x.conflictGroup === item.conflictGroup : x.certainty === 'source_claim_disputed' && x.subjectIds.some(id => item.subjectIds.includes(id)));
    const alternatives = peers.filter(x => x.id !== item.id).map(x => x.statement);
    const proof = evidence(item.citations.map(x => ({ sourceId: x.sourceId, locator: x.locator, excerpt: x.evidenceText })));
    const statement = item.id === 'claim:faction-zhao-succession' ? '原文記漢五年張耳薨、子張敖嗣立；這是趙地後繼王號制度的記述，不表示本包趙歇、陳餘政體延續。' : item.statement;
    const laterRegime = /^claim:faction-zhao-(zhang-er|succession)/.test(item.id) ? ' 後繼趙王的主張只作相關脈絡；不表示本包趙歇、陳餘政體延續。'
      : /^claim:faction-qi-(han-|four-commandaries)/.test(item.id) ? ' 漢方韓信齊王及漢郡是後繼政治安排，不表示本包田氏齊政體繼續存在。' : '';
    api.addClaim(item.id, placeId(item.subjectIds[0]), modern ? 'modern-location' : item.subjectIds[0].startsWith('faction:') ? 'source-faction-identity' : 'source-place-name', item.subjectIds.slice(1).map(placeId), statement,
      unknownTime(item.citations.map(x => x.locator).join('；'), modern ? '這是現代來源的研究／定位主張，不是古代事件的日期；發文日期見source.section。' : '以原文段落保存身份與地名用法；本包未替此跨段主張另換精確公曆。'), proof,
      { epistemic: modern ? 'modern-identification' : item.claimKind === 'classification_from_source_usage' ? 'editorial-synthesis' : 'source-report', review: variant ? 'disputed' : 'source-checked', alternatives,
        caveat: text(item.caveat, modern ? '現代署名或機構主張不等於共識；本包不裁決地望，不配置座標。' : '原文記述、政治名號與地域實控分開；不外推完整沿革。') + laterRegime });
  }
  for (const item of geo.places) {
    const place = api.addPlace(item.id, item.label, item.kind === 'site/encampment' ? 'site' : item.kind === 'battlefield' ? 'battle-area' : item.kind, [item.description, ...(item.cautions || [])].filter(Boolean).join('；'));
    place.aliases = item.aliases || []; place.claimIds.push(...item.claimIds);
  }
  for (const item of [...geo.factions, ...geo.additionalFactions]) {
    const start = item.existenceStart?.normalizedRange?.earliest, end = item.existenceEnd?.normalizedRange?.latest;
    const original = [item.existenceStart?.originalDate || '起點未詳', item.existenceEnd?.originalDate || '終點未詳'].join('；');
    const time = start && end ? { earliest: clone(start), latest: clone(end), precision: start.year === end.year ? 'year' : 'range', original, normalization: 'regnal-year-band', review: 'provisional', note: '這是研究切片中該政治身份的粗略時間範圍；起訖均未換公曆月日，分封不等於完整實控。' }
      : unknownTime(original, '一端無可核起止，保持完整時間unknown；原文終止／改名敘事仍存claims，不補造建國年份。');
    const name = item.id === 'faction:qi' ? '田氏齊政權（所選階段）' : item.id === 'faction:zhao' ? '趙歇、陳餘之趙（所選階段）' : item.label;
    if (item.id === 'faction:qi') Object.assign(time, { earliest: { era: 'BCE', year: 206 }, latest: { era: 'BCE', year: 203 }, precision: 'range', original: '田氏齊諸政體至漢四年平齊階段', normalization: 'regnal-year-band', review: 'provisional', note: '僅田氏政治身份切片；韓信後來的齊王與漢郡不沿用本ID為正式從屬。田榮、田廣的具體接替不以leaderIds跨年並列。' });
    if (item.id === 'faction:zhao') Object.assign(time, { earliest: { era: 'BCE', year: 206 }, latest: { era: 'BCE', year: 204 }, precision: 'range', original: '趙王歇復趙至漢三年井陘階段', normalization: 'regnal-year-band', review: 'provisional', note: '僅趙歇、陳餘政體切片；張耳及張敖後繼趙王另有來源主張，不沿用為同一永久政府。' });
    const kind = item.id === 'faction:chu-coalition' ? 'coalition' : item.id === 'faction:qin' ? 'imperial-government' : 'kingdom';
    const leaderIds = { 'faction:chu': ['person:xiang-yu'], 'faction:han': ['person:liu-bang'], 'faction:yong': ['person:zhang-han'], 'faction:sai': ['person:sima-xin'], 'faction:di': ['person:dong-yi'] }[item.id] || [];
    const claimIds = item.id === 'faction:han' ? item.claimIds.filter(id => id !== 'claim:faction-qin-collapse') : clone(item.claimIds);
    api.factions.set(item.id, { id: item.id, name, aliases: [], kind, time, leaderIds, claimIds, note: [item.identityDefinition, ...(item.cautions || []), ...(item.outsideScope || []),
      item.id === 'faction:qi' || item.id === 'faction:zhao' ? '同名後繼政體不自動等同此實體；相關異說留在claims，不設定一組永久並列領袖。' : '命名時段與名義政治身份不表示逐城控制已確定。'].filter(Boolean).join('；') });
  }
  const cheng = api.addPerson('person:han-cheng', '韓王成', ['韓成'], [], '韓王成之韓與劉邦之漢分開；未查到原962庫可確定的身份條目。');
  const founding = geo.claims.find(x => x.id === 'claim:faction-han-state-zhang-liang');
  const chengClaim = api.addClaim('claim:han-cheng-source-identity', cheng.id, 'source-person-identity', ['faction:han-state'], '留侯世家記項梁使張良求韓成，立以為韓王。', unknownTime('項梁立楚懷王後，求韓成段'), evidence(founding.citations.map(x => ({ sourceId: x.sourceId, locator: x.locator }))));
  cheng.claimIds.push(chengClaim); api.factions.get('faction:han-state').leaderIds.push(cheng.id);
  for (const dispute of geo.locationDisputes || []) {
    if (!dispute.candidateClaimIds?.length) continue;
    pkg.disputes.push({ id: dispute.id, title: '垓下現代地望候選', claimIds: [...dispute.candidateClaimIds, ...(dispute.contextClaimIds || [])], treatment: 'retain-alternatives', note: dispute.rule });
  }
  for (const dispute of geo.datingComparisons || []) pkg.disputes.push({ id: 'dispute:' + slug(dispute.id), title: '張耳立趙王紀年與篇章銜接', claimIds: dispute.claimIds, treatment: 'retain-alternatives', note: dispute.note });
}
function integrateGeoConnections(geo, pkg, api) {
  for (const record of geo.eventRelations || []) {
    if (record.kind !== 'event_movement') continue; // Sequence and capitals are claims, not traversable roads.
    const event = record.id.includes('hongmen-xianyang') ? api.events.get('event:xiang-yu-destroys-qin-court') : null;
    const time = event ? clone(event.time) : { earliest: { era: 'BCE', year: record.originalDate.includes('二年') ? 206 : 205 }, latest: { era: 'BCE', year: record.originalDate.includes('二年') ? 205 : 204 }, precision: 'range', original: record.originalDate, normalization: 'regnal-year-band', review: 'provisional', note: '研究來源明述移動；保留漢紀年跨歲首的保守年帶，不換公曆月日。' };
    pkg.routes.push({ id: 'route:' + slug(record.id), fromPlaceId: record.from, toPlaceId: record.to, kind: 'reported-movement', eventId: event?.id || null, time, distanceKm: null, claimIds: record.claimIds, note: '只為' + record.namedActor + '在指定原紀年的移動敘事；不是永久連通、最短路、實測里程或可任意逆行道路。' });
  }
}
function integrateSupply(pkg, supply, api) {
  for (const record of supply.records) {
    const proof = evidence(record.sourceRefs);
    const id = api.addClaim('claim:' + slug(record.id), record.id, 'reported-economic-mechanism', [...record.placeIds, ...record.personIds], record.statement, record.time, proof, { caveat: record.note });
    pkg.economy.push({ id: record.id, title: record.title, kind: record.kind, placeIds: record.placeIds.map(placeId), personIds: record.personIds,
      time: clone(record.time), mechanism: record.mechanism, quantities: [], claimIds: [id], note: record.note });
    for (const personId of record.personIds) api.persons.get(personId)?.claimIds.push(id);
    for (const place of record.placeIds) api.places.get(placeId(place))?.claimIds.push(id);
  }
  for (const route of supply.routes) {
    const item = pkg.economy.find(x => x.id === route.economyId);
    if (!item) throw new Error('Missing supply record ' + route.economyId);
    const id = api.addClaim('claim:' + slug(route.id), route.fromPlaceId, 'reported-supply-direction', [route.toPlaceId, item.id], '原章記關中向滎陽的軍食供給方向。', item.time, evidence([{ sourceId: route.sourceId, locator: route.locator }]), { caveat: route.note });
    pkg.routes.push({ id: route.id, fromPlaceId: route.fromPlaceId, toPlaceId: route.toPlaceId, kind: route.kind, eventId: null, time: clone(item.time), distanceKm: null, claimIds: [id], note: route.note });
  }
}
function integrateRelations(pkg, rawEvents, api) {
  const pairs = [
    ['event:zhang-han-surrenders', 'person:xiang-yu', 'person:zhang-han', 'negotiates', 'source:shiji-007', '洹水南殷虛盟降段', '項羽與章邯在此事件議約、相盟。'],
    ['event:liu-bang-takes-wuguan', 'person:zhang-liang', 'person:liu-bang', 'advises', 'source:shiji-008', '沛公用張良計攻武關段', '沛公在本次攻武關採用張良計策。'],
    ['event:hongmen-meeting', 'person:xiang-bo', 'person:zhang-liang', 'cooperates', 'source:shiji-007', '項伯夜見張良至會見段', '原文記項伯透過張良聯絡沛公，配合本次會見。'],
    ['event:chuhan-han-xin-appointed', 'person:xiao-he', 'person:han-xin', 'recommends', 'source:shiji-092', '蕭何追亡與薦將段', '蕭何向漢王薦舉韓信為大將。'],
    ['event:chuhan-xiayi-plan', 'person:zhang-liang', 'person:liu-bang', 'advises', 'source:shiji-055', '下邑問策段', '張良在本次問策建議爭取三方力量。'],
    ['event:chuhan-attack-qi', 'person:kuai-tong', 'person:han-xin', 'advises', 'source:shiji-092', '蒯通進言韓信段', '原文記韓信採蒯通進言而繼續攻齊。'],
    ['event:chuhan-han-xin-qi-king', 'person:zhang-liang', 'person:liu-bang', 'advises', 'source:shiji-092', '張良陳平附耳語段', '張良在冊立韓信事件勸漢王因勢冊立。'],
    ['event:chuhan-han-xin-qi-king', 'person:chen-ping', 'person:liu-bang', 'advises', 'source:shiji-092', '張良陳平附耳語段', '陳平與張良在本次冊立事件共同進諫。'],
    ['event:chuhan-guling', 'person:zhang-liang', 'person:liu-bang', 'advises', 'source:shiji-007', '固陵張子房建議分地段', '張良建議用分地承諾促使韓信、彭越會兵。'],
    ['event:chuhan-gaixia', 'person:peng-yue', 'person:liu-bang', 'cooperates', 'source:shiji-090', '彭越悉引兵會垓下段', '彭越帶自有軍隊與漢方合兵於垓下。']
  ];
  for (const [eventId, fromId, toId, type, sourceId, locator, statement] of pairs) {
    const event = api.events.get(eventId);
    const id = 'relation:' + slug(eventId) + '-' + slug(fromId) + '-' + slug(toId);
    const claimId = api.addClaim('claim:' + slug(id), fromId, 'event-' + type, [toId, eventId], statement, event.time, evidence([{ sourceId, locator }]), { caveat: '此有向關係只限指定事件；合作與建議不表示終身友好、直接隸屬或所有人物同場。' });
    pkg.relations.push({ id, fromId, toId, type, scope: 'event', eventId, time: clone(event.time), claimIds: [claimId], note: '限定事件內已記述的具體關係，不外推全期間。' });
    api.persons.get(fromId)?.claimIds.push(claimId); api.persons.get(toId)?.claimIds.push(claimId); event.claimIds.push(claimId);
  }
  const movements = [
    ['event:hongmen-meeting', 'place:ba-shang', 'place:hongmen', 'source:shiji-007', '沛公旦日從百餘騎來見項王至鴻門段', '沛公從霸上軍營赴鴻門會見；不據此建立完整路網。'],
    ['event:liu-bang-enters-hanzhong', 'place:xi', 'place:nanzheng', 'source:shiji-007', '四月諸侯罷戲下各就國段；高祖本紀四月至南鄭段', '由戲下就國與到南鄭是同段赴國過程的端點，不表示唯一路線。'],
    ['event:chuhan-return-sanqin', 'place:gu-dao', 'place:chencang', 'source:shiji-008', '八月從故道還、章邯迎擊陳倉段', '原文把從故道還師與在陳倉迎擊連接；不推算道路、里程或反向通行。']
  ];
  for (const [eventId, fromPlaceId, toPlaceId, sourceId, locator, statement] of movements) {
    const event = api.events.get(eventId), id = 'route:' + slug(eventId);
    const proof = evidence([{ sourceId, locator }]);
    if (eventId === 'event:liu-bang-enters-hanzhong') proof.push(...evidence([{ sourceId: 'source:shiji-008', locator: '漢元年四月至南鄭段' }]));
    const claimId = api.addClaim('claim:' + slug(id), fromPlaceId, 'reported-movement-direction', [toPlaceId, eventId], statement, event.time, proof);
    pkg.routes.push({ id, fromPlaceId, toPlaceId, kind: 'reported-movement', eventId, time: clone(event.time), distanceKm: null, claimIds: [claimId], note: '僅原文所述移動方向；未核路線幾何、距離、通行時間與普遍可通行性。' });
    event.claimIds.push(claimId);
  }
}
// Normalize our explanatory presentation, while preserving original quotations,
// alternative written aliases, URLs and the original library identity metadata.
function traditionalPresentation(value, key = '') {
  if (['excerpt', 'aliases', 'recordId', 'url', 'versionUrl'].includes(key)) return value;
  const substitutions = { '现代': '現代', '范围': '範圍', '独立': '獨立', '此时': '此時', '机制': '機制', '时段': '時段', '统治': '統治', '断定': '斷定', '场': '場', '遗': '遺', '军': '軍', '与': '與', '边': '邊', '语': '語', '称': '稱', '号': '號', '变': '變', '归': '歸', '陈': '陳', '张': '張', '赵': '趙', '汉': '漢', '齐': '齊', '并': '並', '当': '當', '内': '內', '时': '時', '阶': '階', '阵': '陣', '证': '證', '实': '實', '区': '區', '后继': '後繼', '之后': '之後', '候选': '候選', '裁决': '裁決', '领袖': '領袖', '完整独立': '完整獨立' };
  if (typeof value === 'string') {
    let result = value;
    for (const [from, to] of Object.entries(substitutions)) result = result.replaceAll(from, to);
    return result;
  }
  if (Array.isArray(value)) return value.map(item => traditionalPresentation(item, key));
  if (value && typeof value === 'object') for (const name of Object.keys(value)) value[name] = traditionalPresentation(value[name], name);
  return value;
}
function readInputs() {
  return Object.fromEntries([['early', 'early-events'], ['later', 'later-events'], ['geo', 'places-factions'], ['supply', 'supply-records']].map(([key, name]) => [key, JSON.parse(fs.readFileSync(path.join(INPUT, name + '.json'), 'utf8'))]));
}
function verifyLibrary(filename) {
  const input = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!Array.isArray(input) || input.length !== 962) throw new Error('Expected original 962-record snapshot');
  for (const ref of IDENTITIES) {
    const matches = input.filter(record => record.id === ref.recordId && record.name === ref.name && record.type === ref.type);
    if (matches.length !== 1) throw new Error('Manual identity no longer matches: ' + ref.recordId);
  }
  return IDENTITIES.length;
}
function main() {
  const verificationFlag = process.argv.indexOf('--verify-library');
  if (verificationFlag !== -1) {
    if (!process.argv[verificationFlag + 1]) throw new Error('--verify-library requires a local snapshot filename');
    console.log('Identity metadata verified: ' + verifyLibrary(process.argv[verificationFlag + 1]));
  }
  const pkg = buildPackage(readInputs()), serialized = JSON.stringify(pkg, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(OUTPUT, 'utf8') !== serialized) throw new Error('Generated package differs; rebuild required');
    console.log('Rebuild is byte-for-byte identical.');
  } else {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true }); fs.writeFileSync(OUTPUT, serialized);
    console.log('Built ' + path.relative(ROOT, OUTPUT));
  }
  console.log(JSON.stringify(history.validatePackage(pkg, SCHEMA), null, 2));
}
if (require.main === module) main();
module.exports = { buildPackage, readInputs, verifyLibrary };
