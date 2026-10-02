'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { plainText, extractionVersion } = require('../scripts/wikisource-text.cjs');

// Real public-domain passage fixtures, transcribed by Chinese Wikisource
// contributors (applicable contributions CC BY-SA 4.0). Revision URLs identify
// the downloaded source; tests are offline and never mutate corpus snapshots.
test('史記卷一 preserves people, surnames, and nested editorial footnotes', () => {
  // https://zh.wikisource.org/w/index.php?oldid=7903634
  const raw = '{{專|黃帝}}者，{{專|少典}}之子，姓{{專|公孫}}，名曰{{專|軒轅}}。'
    + '生而神靈，弱而能言，{{標|幼而徇齊}}<ref>{{專|張文虎}}{{書|札記}}卷一：'
    + '「『徇』{{書|群書治要}}、{{書|説文繫傳}}引並作『侚』，與{{書|集解}}訓疾義合。」</ref>，長而敦敏。';
  const actual = plainText(raw);
  assert.ok(actual.startsWith('黃帝者，少典之子，姓公孫，名曰軒轅。'));
  assert.ok(actual.includes('幼而徇齊〔張文虎札記卷一：'));
  assert.ok(actual.includes('群書治要、説文繫傳引並作『侚』'));
  assert.ok(actual.endsWith('〕，長而敦敏。'));
  assert.ok(!actual.includes('{{'));
});

test('adjacent proper nouns and nested script variants retain the full name', () => {
  // 史記卷一, same revision. 專's arguments are adjacent words, not link labels.
  const raw = '{{專|帝顓頊|高陽}}者，{{專|黃帝}}之孫而{{專|昌意}}之子也。'
    + '{{專|高辛}}父曰{{專|-{zh:蟜;zh-hans:{{!|𫊸|⿰虫乔}};zh-hant:蟜;}-極}}。';
  assert.equal(plainText(raw), '帝顓頊高陽者，黃帝之孫而昌意之子也。高辛父曰蟜極。');
});

test('後漢書 volume 19 retains ProperNoun and era templates', () => {
  // https://zh.wikisource.org/w/index.php?oldid=7913335
  const raw = '{{ProperNoun|恭}}字{{ProperNoun|伯宗}}，{{ProperNoun|國}}弟{{ProperNoun|廣}}之子也。'
    + '{{YL|永平十七年}}冬，騎都尉{{ProperNoun|劉張}}出擊{{ProperNoun|車師}}，請{{ProperNoun|恭}}爲司馬。';
  assert.equal(plainText(raw), '恭字伯宗，國弟廣之子也。永平十七年冬，騎都尉劉張出擊車師，請恭爲司馬。');
  assert.equal(plainText('{{YL|天復元年|901年}}'), '天復元年〔紀年對照：901年〕');
});

test('三國志 volume 30 preserves place names and alternate readings', () => {
  // https://zh.wikisource.org/w/index.php?oldid=2690100
  const raw = '{{ul|倭人}}在{{ul|帶方}}東南大海之中，依山島爲國邑。'
    + '又南渡一海千餘里，名曰瀚海，至{{ul|一{{另|大|支}}國}}，官亦曰{{ul|卑狗}}。';
  assert.equal(plainText(raw), '倭人在帶方東南大海之中，依山島爲國邑。又南渡一海千餘里，名曰瀚海，至一大〔異文：支〕國，官亦曰卑狗。');
});

test('後漢書 volume 68 preserves taboo-name commentary and small text', () => {
  // https://zh.wikisource.org/w/index.php?oldid=1495293
  const raw = '郭{{參|太|本名「泰」，避范曄父名諱改。}}字林宗，'
    + '{{*|范曄父名泰，故改爲此「太」。鄭公業之名亦同焉。}}太原界休人也。{{*|介休，今汾州縣。}}';
  const actual = plainText(raw);
  assert.ok(actual.includes('郭太〔註：本名「泰」，避范曄父名諱改。〕字林宗'));
  assert.ok(actual.includes('〔范曄父名泰，故改爲此「太」。鄭公業之名亦同焉。〕'));
  assert.ok(actual.endsWith('〔介休，今汾州縣。〕'));
});

test('rare characters, corrections and paired note templates survive', () => {
  assert.equal(plainText('{{!|{{Unihan|23DAF}}|⿰氵門}}'), '𣶯〔字形：⿰氵門〕');
  assert.equal(plainText('{{校|鄉|卿}}大夫{{*s}}原校：{{書|周禮}}{{*e}}'), '鄉〔校字：卿〕大夫〔原校：周禮〕');
  assert.equal(plainText('{{?|⿰月施}}'), '〔缺字：⿰月施〕');
  assert.ok(plainText('{{Unihan|110000}}').includes('110000'));
});

test('舊五代史 preserves passages supplied in lengthy source annotations', () => {
  // https://zh.wikisource.org/w/index.php?oldid=1567203 (volume 86)
  const raw = '高祖皇后李氏。{{*|（《五代會要》：高祖皇后李氏，唐明宗第三女。'
    + '{{YL|天成三年}}四月，封永寧公主；{{YL|長興四年}}九月，進封魏國公主；'
    + '{{YL|清泰二年}}九月，改封晉國長公主；至{{YL|天福六年}}十一月，尊為皇后。）}}';
  const actual = plainText(raw);
  assert.ok(actual.includes('高祖皇后李氏，唐明宗第三女'));
  assert.ok(actual.includes('天成三年四月，封永寧公主'));
  assert.ok(actual.includes('天福六年十一月，尊為皇后'));
});

test('宋史 text boxes and author links preserve official and personal names', () => {
  // https://zh.wikisource.org/w/index.php?oldid=2709732 (volume 187)
  assert.equal(plainText('{{gap}}{{CBox|殿前指揮使左右班}}二。宋初，以舊府親從帶甲之士及諸班軍騎中選武藝絕倫者充。'),
    '殿前指揮使左右班二。宋初，以舊府親從帶甲之士及諸班軍騎中選武藝絕倫者充。');
  // https://zh.wikisource.org/w/index.php?oldid=2573823 (volume 251)
  assert.equal(plainText('{{a|韓令坤|韓令坤}}，磁州武安人。'), '韓令坤，磁州武安人。');
  assert.equal(plainText('{{Linktoauthor|周樹人|魯迅}}'), '周樹人');
  assert.equal(plainText('{{udots|[[請皇太后權同聽政詔|詔]]}}請皇太后同聽政。'), '詔請皇太后同聽政。');
  assert.equal(plainText('{{CBox|文字|red|yellow|1.2em|||字形提示}}'), '文字〔提示：字形提示〕');
  assert.equal(plainText('{{align|right|{{right|右樂章}}}}'), '右樂章');
  assert.equal(plainText('改知{{w|贛州}}。'), '改知贛州。');
  // SKchar uses an external glyph table/image, not a Unicode code point.
  assert.ok(plainText('自有{{SKchar|2652}}。').includes('{{SKchar|2652}}'));
});

test('unknown templates keep positional and named content, including nested pipes', () => {
  const raw = '{{未識模板|name={{專|劉邦}}|text=[[漢書/卷001|高帝]]與{{專|項羽}}|record=甲{{!}}乙}}';
  const actual = plainText(raw);
  assert.ok(actual.includes('未展開模板'));
  assert.ok(actual.includes('name=劉邦'));
  assert.ok(actual.includes('text=高帝與項羽'));
  assert.ok(actual.includes('record=甲|乙'));
  assert.equal(plainText('{{專|1=黃帝|2=軒轅}}'), '黃帝軒轅');
  assert.ok(plainText('{{color|正文}}').includes('正文'));
});

test('unknown nesting and malformed markup remain bounded and do not vanish', () => {
  const nested = '{{未識|'.repeat(120) + '蔡邕' + '}}'.repeat(120);
  assert.ok(plainText(nested).includes('蔡邕'));
  assert.equal(plainText('前文{{未完|張良'), '前文{{未完|張良');
  assert.equal(plainText('{{{尚未提供|人物}}}'), '{{{尚未提供|人物}}}');
});

test('cross-page transclusions stay explicit instead of inventing full text', () => {
  // 漢書卷096下 contains {{:輪臺詔}} in a quote:
  // https://zh.wikisource.org/w/index.php?oldid=2605487
  const actual = plainText('{{quote|{{:輪臺詔}}}}\n由是不復出軍。<pages index="漢書.djvu" from="42" to="43" />');
  assert.ok(actual.includes('未展開轉引：{{:輪臺詔}}'));
  assert.ok(actual.includes('由是不復出軍。'));
  assert.ok(actual.includes('未展開跨頁轉錄：index="漢書.djvu" from="42" to="43"'));
});

test('reference definitions, self-closing references and nowiki are not swallowed', () => {
  assert.equal(plainText('甲<ref name="x"/>正文<ref name="x">乙{{專|班固}}|丙</ref>丁'),
    '甲〔註參照：x〕正文〔乙班固|丙〕丁');
  assert.equal(plainText('{{quote|甲<ref>乙|丙{{專|丁}}</ref>戊}}'), '甲〔乙|丙丁〕戊');
  assert.equal(plainText('<nowiki>{{專|原樣}}</nowiki>'), '{{專|原樣}}');
  assert.equal(plainText('{{reflist|refs=<ref>後出的校注</ref>}}'), '〔後出的校注〕');
});

test('format cleanup preserves table cells, editor notices and text in wrappers', () => {
  const raw = '{{header2|section=卷一|previous=上卷人物|next=下卷人物|notes=此為{{小字|後人校注}}}}'
    + '{{注意|text=標題不屬於原文}}<noinclude>編者附記</noinclude>\n'
    + '{| class="wikitable"\n|+ 年表\n|-\n! 年 !! 人物\n| style="color:red" | 建元元年 || {{專|司馬遷}}\n|}\n'
    + '[[分類:史書]][[File:portrait.png|人物像]]{{Textquality|75%}}{{唐朝作品}}';
  const actual = plainText(raw);
  for (const term of ['卷一', '後人校注', '標題不屬於原文', '編者附記', '年表', '建元元年', '司馬遷']) assert.ok(actual.includes(term), term);
  for (const term of ['上卷人物', '下卷人物', 'wikitable', '75%']) assert.ok(!actual.includes(term), term);
  assert.ok(actual.includes('〔圖像未轉錄：portrait.png；圖說：人物像〕'));
  assert.equal(plainText('[[Image:map.png|right|200px|right bank of a river]]'),
    '〔圖像未轉錄：map.png；圖說：right bank of a river〕');
});

test('returns text only without running scripts or fetching remote markup', () => {
  assert.equal(plainText('<div onclick="throw 1">{{專|陳壽}}</div><script>throw new Error()</script><style>body{display:none}</style>'), '陳壽');
  assert.equal(plainText('&#x8ED2;&#36757;&nbsp;&amp;'), '軒辕 &');
  assert.equal(plainText('&#x110000;&#xD800;'), '&#x110000;&#xD800;');
  assert.equal(extractionVersion, 'wikitext-conservative-v2.1.0');
  assert.throws(() => plainText(null), TypeError);
});
