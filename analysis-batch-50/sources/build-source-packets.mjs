import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Public archive material only. This helper never opens userdata, credentials,
// private chat, or the existing analysis manuscripts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = path.join(root, 'analysis-batch-50/sources');
const digest = s => createHash('sha256').update(s).digest('hex');
const manifestBytes = await readFile(path.join(root, 'analysis-batch-50/manifest.v1.json'));
const manifest = JSON.parse(manifestBytes);
const archivePath = 'backend/static/data/history/source-archive.v1.json';
const archiveBytes = await readFile(path.join(root, archivePath));
const archive = JSON.parse(archiveBytes);
const bookCache = new Map();
const sourceMap = new Map(archive.sources.map(x => [x.id, x]));
const dossierMap = new Map(archive.dossiers.map(x => [x.recordId, x]));

const plan = {
 '01': {identity:'劉秀，東漢世祖光武帝；不是西漢末同名劉秀（劉歆）。', docs:['houhanshu/卷1上','houhanshu/卷1下','zizhitongjian/卷039'], anchors:['劉秀','光武'], topics:['昆陽','更始','赤眉','度田','奴婢','馮異'], questions:['昆陽之役的兵力、劉秀自身行動與諸將分工有哪些原典證據？','光武的度田、奴婢與功臣政策如何理解，柔道是否等於無為？','漢初創業成本與東漢統一時間的比較應用哪些可核數據？']},
 '02': {identity:'趙匡胤，北宋太祖；不是趙光義。', docs:['songshi/卷001','songshi/卷003','songshi/卷256'], anchors:['趙匡胤','太祖','趙普'], topics:['陳橋','石守信','兵權','李煜','江南','燕'], questions:['陳橋兵變與杯酒釋兵權的早期文本、成書時間和敘事差異？','太祖中央集權的具體軍政財政措施，哪些由趙普等人參與？','南方平定、燕雲未收及太祖死因應區分哪些事實和後世說法？']},
 '03': {identity:'愛新覺羅玄燁，清聖祖康熙帝。', docs:['qingshigao/卷6','qingshigao/卷7','qingshigao/卷8'], anchors:['玄燁','聖祖'], topics:['吳三桂','臺灣','鄭','噶爾丹','雅克薩','皇太子'], questions:['三藩、臺灣、雅克薩與噶爾丹各戰役中皇帝決策與將領貢獻？','康熙朝財政、吏治與晚年儲位衝突的檔案／實錄及現代研究？','所用《清史稿》本紀缺文如何以清實錄或故宮、第一歷史檔案館材料補核？']},
 '04': {identity:'朱棣，明成祖；本紀當時稱太宗，成祖廟號是後來改定。', docs:['mingshi/卷5','mingshi/卷7','mingshi/卷304'], anchors:['朱棣','成祖','鄭和'], topics:['建文','北平','北京','安南','蒙古','鄭和'], questions:['靖難與登基合法性敘事應交叉核對何種明實錄和現代研究？','北征、安南、遷都及海航的財政／人命成本與具體結果？','鄭和的行動、王朝政策和皇帝個人的統率評分如何區分？']},
 '05': {identity:'李治，唐高宗；不是清高宗或宋高宗。', docs:['jiutangshu/卷4','jiutangshu/卷5','xintangshu/卷003'], anchors:['李治','高宗'], topics:['蘇定方','長孫無忌','皇后','高麗','安西','太子'], questions:['永徽律疏、長孫無忌失勢與帝后權力分工的原典和現代研究？','西突厥、高句麗戰役如何分清高宗決策與蘇定方／李勣執行？','病情、皇后參政與晚年處政，哪些是可核事件、哪些是推論？']},
 '06': {identity:'嬴稷，秦昭襄王；不是秦始皇或秦孝公。', docs:['shiji/卷005','shiji/卷073','shiji/卷079'], anchors:['昭襄王','昭王','白起','范雎'], topics:['長平','范雎','白起','昭王','太后','應侯'], questions:['宣太后、魏冉、范雎、白起與秦王決策的年代及分工？','長平戰事的數字、坑殺與邯鄲失利應如何核原文與考古／研究？','王權重組、遠交近攻的成效和代價有哪些可核材料？']},
 '07': {identity:'愛新覺羅弘曆，清高宗乾隆帝。', docs:['qingshigao/卷10','qingshigao/卷13','qingshigao/卷15'], anchors:['弘曆','高宗'], topics:['準噶爾','回部','金川','臺灣','和珅','緬甸'], questions:['十全武功各役實際成敗、成本與皇帝敘事，如何用清實錄與檔案對照？','準噶爾、回部與金川涉及的族群政策、暴力及後續治理？','乾隆晚年財政、文字獄、和珅與人口壓力的現代學術證據？']},
 '08': {identity:'劉詢（初名病已），漢宣帝；與北魏宣武帝不同。', docs:['hanshu/卷008','hanshu/卷068','hanshu/卷089'], anchors:['孝宣皇帝','宣帝','霍光'], topics:['霍光','匈奴','西域','黃霸','循吏','刑'], questions:['霍光掌權、霍氏被誅與宣帝親政的實際時間與帝后事件？','西域、匈奴關係與地方吏治中皇帝和臣僚的貢獻？','霸王道雜之、綜核名實的原文及制度效果有哪些研究？']},
 '09': {identity:'劉裕，南朝宋武帝；不是北宋皇帝。', docs:['songshu/卷001','songshu/卷003','nanshi/卷001'], anchors:['劉裕','武帝'], topics:['桓玄','北伐','長安','義熙','恭帝','司馬'], questions:['北伐各階段、收復長安與撤軍失守之間的決策與派系關係？','從晉臣到篡位皇帝的原典敘事與政敵被殺事件？','軍事才能、寒門出身與南朝權力重組的學術解讀？']},
 '10': {identity:'趙禎，北宋仁宗。', docs:['songshi/卷009','songshi/卷011','songshi/卷012','songshi/卷314'], anchors:['仁宗','范仲淹'], topics:['元昊','慶曆','范仲淹','財賦','狄青','皇后'], questions:['慶曆新政中仁宗、范仲淹、韓琦等人的意見和權力邊界？','宋夏戰爭、財政與政治寬容的成效／代價有哪些可核數據？','仁宗形象如何區分官方本紀、臣僚回憶、後世文人記憶？']},
 '11': {identity:'武曌，武則天；唐高宗皇后，後建立武周。', docs:['jiutangshu/卷6','xintangshu/卷004'], anchors:['武曌','則天','皇后'], topics:['長孫無忌','酷吏','狄仁傑','太子','李勣','周'], questions:['由皇后至武周皇帝的各階段如何精確定年、區分李治和武氏權力？','酷吏、科舉、官僚任用與邊防的實際政策和制度成效？','幼女死亡等著名敘事的史源年代、異文及現代學術判讀？']},
 '12': {identity:'趙炅，宋史本紀記初名匡乂、改賜光義、即位後改名炅，北宋太宗。', docs:['songshi/卷004','songshi/卷005','songshi/卷272'], anchors:['太宗','楊業'], topics:['北漢','高梁','雍熙','楊業','幽州','太祖'], questions:['登位、金匱之盟與燭影斧聲應如何核早期材料並分層？','高梁河、雍熙北伐的指揮鏈與曹彬／潘美／楊業責任？','太宗的官僚、文化與統一政策相對太祖有哪些具體延續和改變？']},
 '13': {identity:'朱祐樘，明孝宗弘治帝。', docs:['mingshi/卷15','mingshi/卷181'], anchors:['孝宗','李東陽','劉健'], topics:['劉健','李東陽','謝遷','災','賦','張'], questions:['弘治朝內閣政治中帝王與劉健、李東陽、謝遷的分工？','弘治中興的財政、邊政和民生指標，相對成化／正德如何比較？','皇帝婚姻、外戚與晚年政務的流行說法有哪些實錄證据？']},
 '14': {identity:'高歡，東魏實際掌權者，北齊追尊神武帝；不是日本神武天皇。', docs:['beiqishu/卷1','beiqishu/卷2','beishi/卷006'], anchors:['高歡','神武'], topics:['爾朱','宇文泰','沙苑','玉壁','侯景','鄴'], questions:['爾朱氏崩潰、東西魏分裂與高歡建立實際權力的年代？','沙苑、邙山、玉壁等戰役中兵力、指揮和敗因有哪些相異記載？','北齊書神武本紀的補卷來源與北史承襲關係如何影響解讀？']},
 '15': {identity:'趙昚，南宋孝宗。', docs:['songshi/卷033','songshi/卷034','songshi/卷035'], anchors:['孝宗','趙昚'], topics:['隆興','張浚','虞允文','和議','乾道','國用'], questions:['隆興北伐和議中孝宗、張浚、將領的指揮分歧與戰果？','乾淳之治的財政、軍備和行政成效，哪些可用宋會要等原料核對？','高宗仍在世時權力結構、恢復理想與實務妥協的證據？']},
 '17': {identity:'拓跋燾，北魏世祖太武帝；與孝文帝元宏不同。', docs:['weishu/卷4上','weishu/卷4下','beishi/卷002'], anchors:['世祖','太武','燾'], topics:['赫連','柔然','沮渠','崔浩','佛','劉義隆'], questions:['滅夏、北燕、北涼和柔然戰爭的年代、指揮與實際疆域？','太武滅佛與崔浩案的原典、宗教和政治背景？','450南征與國內皇權／宦官衝突怎樣區分軍事成功與治理代價？']},
 '18': {identity:'曹操，曹魏奠基者、生前魏王；魏武帝是追尊。', docs:['sanguozhi/卷01','sanguozhi/卷10','houhanshu/卷9'], anchors:['曹操','太祖','荀彧'], topics:['官渡','赤壁','屯田','荀彧','徐州','天子'], questions:['曹操軍事與政治功績如何區分本人、荀彧、郭嘉等的共同貢獻？','徐州屠戮、屯田、用人和挾天子的不同史源及現代研究？','裴松之引書、曹瞞傳與陳壽正文的來源立場和承襲？']},
 '19': {identity:'李勣，本姓徐，早年徐世勣，後避唐太宗諱名勣；與李靖不同。', docs:['jiutangshu/卷67','xintangshu/卷093'], anchors:['李勣','徐世勣','徐懋功'], topics:['黎陽','李密','突厥','高麗','皇后','敬業'], questions:['徐世勣到李勣的姓名變化、李密舊部和早期歸唐過程？','突厥、高句麗戰役中李靖、高宗與李勣的分工及軍事能力證据？','廢后立武事件、臨終誡子與後人敘事的原典上下文？']},
 '20': {identity:'蘇定方，名烈、字定方，唐將；不是演義中的反派角色。', docs:['jiutangshu/卷83','xintangshu/卷111'], anchors:['蘇定方','蘇烈'], topics:['頡利','賀魯','百濟','高麗','功','李靖'], questions:['東突厥、西突厥、百濟、高句麗各次作戰的戰果與指揮分工？','新舊唐書姓名蘇烈／蘇定方如何對接，戰爭暴力與戰敗事件有哪些記載？','史傳和後世演義形象差異如何用學術研究說清？']},
 '23': {identity:'王忠嗣，唐玄宗朝邊將，父王海賓。', docs:['jiutangshu/卷103','xintangshu/卷133'], anchors:['王忠嗣'], topics:['石堡','四鎮','李林甫','哥舒','李亨','吐蕃'], questions:['四鎮節度使的實際職任年代和其軍事治理範圍？','拒攻石堡城、被誣與哥舒翰救援的史源及兵力／死傷數？','忠於太子、權臣構陷與皇帝猜忌哪些有可核文本、哪些是後見推論？']},
 '24': {identity:'孫武，傳統敘事中的春秋吳國軍事人物；與戰國孫臏不同。', docs:['shiji/卷065','shiji/卷031'], anchors:['孫武','闔廬'], topics:['孫武','宮女','伍子胥','楚','夫差'], candidateTexts:[{title:'孫子兵法',url:'https://zh.wikisource.org/wiki/孫子兵法',purpose:'核兵法文本、篇章与出土竹簡對照；此入口本次未逐章開啟。'}], questions:['孫武生平、吳楚戰爭與《孫子》作者問題的原典及銀雀山竹簡研究？','宮女練兵故事的史源與史記成書年代，不能直當當代錄像式記錄。','兵法理論與本人可證戰績如何分開評統率、智謀、政治和武力？']},
 '26': {identity:'孟珙，南宋軍事人物；孟宗政之子，字璞玉。', docs:['songshi/卷412','songshi/卷041'], anchors:['孟珙'], topics:['蔡州','襄陽','江陵','京湖','蒙古','屯田'], questions:['聯蒙滅金、宋蒙轉戰及荊湖防線的時間和指揮分工？','地方屯田、軍民治理與戰場守備如何核宋史以外材料？','稱防禦大師的比較依據、實際戰敗／政治限制和後續影響？']},
 '27': {identity:'李光弼，唐安史之亂時將領；父楷洛，契丹出身。', docs:['jiutangshu/卷110','xintangshu/卷136'], anchors:['李光弼'], topics:['常山','太原','河陽','郭子儀','史思明','程元振'], questions:['常山、太原、河陽戰事的地理、指揮和戰果？','與郭子儀的分工、朝廷及宦官干預如何影響戰爭？','晚年不入朝、軍心流失與中興第一評語的原典範圍？']},
 '28': {identity:'孫臏，戰國齊軍事人物；與孫武不同。', docs:['shiji/卷065','shiji/卷046'], anchors:['孫臏','田忌'], topics:['龐涓','桂陵','馬陵','田忌','減灶','威王'], candidateTexts:[{title:'孫臏兵法出土與整理',url:'https://www.ncha.gov.cn/',purpose:'候選機構入口；請實際搜尋銀雀山漢墓竹簡與正式整理研究。'}], questions:['孫臏兵法竹簡與史記孫臏傳如何互證及分辨後附故事？','桂陵、馬陵年代、田忌／孫臏分工與圍魏救趙、減灶敘事？','賽馬故事、膑刑與逃亡的史源和心理推論如何分層？']},
 '29': {identity:'伍員，字子胥，春秋楚人，後仕吳。', docs:['shiji/卷066','shiji/卷031','zuozhuan/定公'], anchors:['伍子胥','伍員'], topics:['柏舉','楚','闔廬','夫差','越','申包胥'], questions:['左傳與史記對入郢、鞭尸及吳楚關係的記載差異？','伍員、孫武、闔閭的軍事分工與吳國稱霸／失敗因果？','復仇、諫越與自殺的史實記載和後世忠烈敘事？']},
 '31': {identity:'左宗棠，清末湖南湘陰人，非現代同名人物。', docs:['qingshigao/卷412','qingshigao/卷23'], anchors:['左宗棠'], topics:['新疆','阿古柏','糧','船','伊犁','胡雪巖'], questions:['西征新疆的後勤、財政、國際形勢與部將軍事分工？','伊犁交涉中左宗棠、曾紀澤及朝廷不同方案如何核檔案？','福州船政、對回民的戰爭暴力及晚年中法戰事如何完整評價？']},
 '32': {identity:'戚繼光，明將，字元敬；與俞大猷有合作和不同職責。', docs:['mingshi/卷212','mingshi/卷322'], anchors:['戚繼光','俞大猷'], topics:['台州','倭','義烏','薊','練兵','張居正'], candidateTexts:[{title:'紀效新書',url:'https://zh.wikisource.org/wiki/紀效新書',purpose:'待ChatGPT開啟具體篇章核兵法、編制與訓練；注意十八卷本／十四卷本版本。'},{title:'練兵實紀',url:'https://zh.wikisource.org/wiki/練兵實紀',purpose:'待核北方軍事訓練文本與版本。'}], questions:['紀效新書、練兵實紀不同版本與戚家軍編制的實際變化？','抗倭戰爭中的海商、日人、地方勢力與俞大猷合作分工？','薊鎮治理、張居正關係、財政負擔和被罷免的年代／責任？']},
 '33': {identity:'木華黎（Muqali），成吉思汗麾下札剌亦兒部將；不是成吉思汗本人。', docs:['yuanshi/卷119','yuanshi/卷001'], anchors:['木華黎','太祖'], topics:['太行','燕京','國王','金','孛魯','河北'], questions:['木華黎受國王號、軍政權限與成吉思汗西征分工？','河北山東攻金戰爭的後勤、地方降將和暴力政策有哪些不同記載？','元史、蒙古秘史與近代學術研究如何互證個人戰績？']},
 '34': {identity:'僕固懷恩（史書常作仆固懷恩），唐鐵勒將；注意字形，不與僕固氏他人混同。', docs:['jiutangshu/卷121','xintangshu/卷224上'], anchors:['仆固懷恩','僕固懷恩'], topics:['回紇','太原','辛雲京','吐蕃','郭子儀','仆固瑒'], questions:['平安史的戰績、回紇聯軍和女兒聯姻的具體分工／成本？','從功臣到反叛的時間線，史書叛臣分類與讒言敘事如何交叉檢查？','家族死亡、軍隊依附及族群背景是否足以支持某種心理內核？']},
 '35': {identity:'陳慶之，南朝梁將，字子雲；非陳霸先。', docs:['liangshu/卷32','nanshi/卷61'], anchors:['陳慶之'], topics:['元顥','洛陽','七千','爾朱','梁','白'], questions:['護送元顥北伐的戰事次序與爾朱榮反攻，南北史源怎樣比較？','七千、四十七戰、三十二城等數字源自何處、有何文本性質？','白袍敘事、個人武力與戰役指揮如何分開，失敗和後續職任有哪些證據？']},
 '37': {identity:'荀彧，字文若，潁川人，曹操重要政治人物；非荀攸。', docs:['sanguozhi/卷10','sanguozhi/卷01'], anchors:['荀彧'], topics:['天子','兗州','官渡','魏公','潁川','曹操'], questions:['荀彧與荀攸、郭嘉在官渡及曹操政權建設中的不同角色？','迎天子、人才網絡及漢臣認同如何核原典與现代研究？','荀彧死亡／空食器敘事在陳壽和裴注不同材料中的差異？']},
 '38': {identity:'張良，字子房，漢初留侯；非張昌、張梁。', docs:['shiji/卷055','hanshu/卷040'], anchors:['張良','留侯'], topics:['博浪','韓信','鴻門','四皓','黃石','辟穀'], questions:['張良實際策劃、韓信陳平等人的共同貢獻有哪些可核片段？','圯橋老人、四皓與辟穀故事的史源和修辭層級？','留侯退隱、家國復仇與漢初功臣風險是否有具体证據？']},
 '39': {identity:'李斯，秦丞相，楚上蔡人。', docs:['shiji/卷087','shiji/卷006'], anchors:['李斯'], topics:['逐客','郡縣','焚','趙高','沙丘','上蔡'], questions:['諫逐客、郡縣與法制標準化的直接文本和李斯本人貢獻？','焚書命令的範圍、坑儒敘事與秦簡考古研究？','沙丘政變、扶蘇胡亥趙高與李斯責任的史源／心理推論？']},
 '40': {identity:'于謙，字廷益，明忠肅公；不是當代演藝人物，也不是清代于姓人物。', docs:['mingshi/卷170','mingshi/卷11'], anchors:['于謙'], topics:['土木','北京','景帝','英宗','兵','石亨'], questions:['土木之變後北京守衛的指揮鏈、軍力與朝廷爭議？','于謙與景泰帝、英宗返京及奪門之變的政治安排？','被殺的原罪名、事後昭雪及忠烈形象應如何分時間層？']},
 '41': {identity:'謝安，字安石，東晉陳郡謝氏政治人物。', docs:['jinshu/卷079','jinshu/卷114'], anchors:['謝安','苻堅'], topics:['淝水','謝玄','桓溫','北府','東山','桓沖'], questions:['淝水之戰中謝安統筹、謝玄／劉牢之現場指揮與苻堅敗因？','東晉門閥、桓溫威脅、皇權與謝氏家族的實際權力結構？','東山、圍棋、折屐故事與世說新語、晉書的來源關係？']},
 '42': {identity:'范仲淹，字希文，北宋政治、軍事人物，諡文正。', docs:['songshi/卷314','songshi/卷011'], anchors:['范仲淹'], topics:['慶曆','元昊','韓琦','朋黨','新政','義田'], questions:['慶曆改革十事、皇帝支持和官僚阻力的具體政策／期限？','西北邊防、韓琦與范仲淹不同戰略及義莊的原典／研究？','岳陽樓記的文學自我形象和實際政策、家族實踐如何並讀？']},
 '44': {identity:'劉基，字伯溫，明誠意伯；不是後世讖書作者傳說中的全知軍師。', docs:['mingshi/卷128','mingshi/卷2'], anchors:['劉基'], topics:['陳友諒','太祖','胡惟庸','李善長','鄱陽','青田'], questions:['朱元璋陣營中劉基的具體策劃與其他將臣共同貢獻？','胡惟庸、李善長、爵賞与劉基死亡的異文和時點？','燒餅歌等後世讖書與劉基真實文集／生平如何清楚分開？']},
 '45': {identity:'張廷玉，清大學士，張英之子；歷仕康熙、雍正、乾隆。', docs:['qingshigao/卷288','qingshigao/卷10'], anchors:['張廷玉'], topics:['軍機','鄂爾泰','配享','世宗','高宗','若靄'], questions:['軍機處成立與張廷玉實際職掌、文書程序與雍正授權？','配享爭議、乾隆處分與退休願望的具體年代和奏折證据？','清史稿列傳可能缺文如何用故宮／第一歷史檔案館／清實錄補核？']},
 '46': {identity:'霍光，字子孟，霍去病之弟，西漢大司馬大將軍。', docs:['hanshu/卷068','hanshu/卷008'], anchors:['霍光'], topics:['昌邑','宣帝','許','上官','昭帝','霍禹'], questions:['昭帝輔政、廢昌邑王與立宣帝的程序／合法性和群臣角色？','霍光生前權力、霍顯殺后與死後霍氏清算的時間線？','漢書贊語與近代權臣研究如何分別支持政治能力、家族盲點？']},
 '47': {identity:'張之洞，字孝達，號香濤，清末督撫與洋務人物。', docs:['qingshigao/卷437','qingshigao/卷24'], anchors:['張之洞'], topics:['鐵','學堂','湖北','勸學','新政','變法'], questions:['漢陽鐵廠、教育與軍事新政的實際成效、財務與技術限制？','勸學篇的中體西用文本和戊戌、庚子、清末新政中的決策？','與李鴻章、盛宣懷及地方財政的合作／衝突有哪些檔案與研究？']},
 '48': {identity:'公孫僑，字子產，春秋鄭國執政；不是戰國人物。', docs:['zuozhuan/襄公','zuozhuan/昭公','shiji/卷042'], anchors:['子產','公孫僑'], topics:['子產','刑書','鄉校','寬猛','叔向','賦'], questions:['鑄刑書、鄉校不毀與寬猛相濟各段原紀年和上下文？','鄭國處晉楚間外交、田制／賦制改革的證据和解释争论？','孔子悼語與左傳的道德敘事如何作分析，不能代替政策效果證据？']},
 '50': {identity:'徐光啟，字子先，明文定公；文集、農政全書與曆法合作有不同作者分工。', docs:['mingshi/卷251','mingshi/卷31'], anchors:['徐光啟'], topics:['曆','利瑪竇','農','兵','禮','徐光啟'], candidateTexts:[{title:'農政全書',url:'https://zh.wikisource.org/wiki/農政全書',purpose:'候選原典入口，需核具體版本、編輯整理與章節。'},{title:'幾何原本',url:'https://zh.wikisource.org/wiki/幾何原本',purpose:'候選原典入口，需核徐光啟與利瑪竇共同翻譯版本。'}], questions:['崇禎曆局的制度安排、徐光啟與耶穌會士分工及實際施用時點？','農政全書的編纂、身後整理與農業實驗的實際證据？','軍事訓練、守城與科學知識的國政應用，哪些屬成果、哪些未實現？']},
};

function normalize(s) { return String(s || '').replace(/[\s\p{P}\p{S}]/gu, ''); }
async function loadDocument(key) {
 const split = key.indexOf('/');
 const bookId = 'book:' + key.slice(0, split), title = key.slice(split + 1);
 const book = archive.books.find(x => x.id === bookId);
 if (!book) throw Error('Unknown book ' + key);
 if (!bookCache.has(bookId)) {
   const local = 'backend' + book.contentPath;
   bookCache.set(bookId, {local, ...JSON.parse(await readFile(path.join(root, local)))});
 }
 const bundle = bookCache.get(bookId);
 const canonicalTitle = s => s.replace(/卷0+(\d)/g,'卷$1');
 const document = bundle.documents.find(x => canonicalTitle(x.requestedTitle.split('/').at(-1)) === canonicalTitle(title));
 if (!document?.text) throw Error('No text ' + key);
 const actual = digest(document.text);
 if (actual !== document.textSha256) throw Error('Archive text hash mismatch ' + key);
 return {document, localPath:bundle.local};
}

function excerpts(document, config, index) {
 const text = document.text;
 const positions = [];
 for (const name of config.anchors) {
   const heading = text.indexOf('\n\n' + name + '\n\n');
   if (heading >= 0) positions.push(heading + 2);
 }
 // Prefer the personal biography heading; otherwise the correct hand-mapped
 // chapter opening. The topic windows remain locators, not proven claims.
 const start = positions[0] ?? 0;
 const requests = [{from:start, length:1200, label:'人物／篇章起點'}];
 for (const topic of config.topics) {
   const p = text.indexOf(topic, Math.min(start + 80, text.length));
   if (p >= 0 && (p < start || p > start + 950)) requests.push({from:Math.max(0,p-100),length:1000,label:'待核主題：'+topic});
 }
 // Only give the full-chapter ending if this is a single-person chronicle.
 if (/^(01|03|05|07|09|10|12|14|15|17)$/.test(config.slug)) requests.push({from:Math.max(0,text.length-1000),length:1000,label:'全卷末尾（核上下文）'});
 const selected = [];
 for(const r of requests) {
   if (selected.length === 3) break;
   if(selected.some(x=>Math.abs(x.charStart-r.from)<750))continue;
   const charStart = r.from, charEnd = Math.min(text.length,r.from+r.length);
   const raw = text.slice(charStart,charEnd);
   selected.push({label:r.label,charStart,charEnd,sha256:digest(raw),text:raw});
 }
 return selected;
}

function candidateBibliography(dossier) {
 const seen = new Set();
 return (dossier?.candidatePages||[]).filter(x=>!x.isDisambiguation).flatMap(p=>(p.bibliography||[]).map(b=>({...b,encyclopediaRevisionUrl:p.revisionUrl}))).filter(b=>{
  if(!b.url || !/^https?:\/\//.test(b.url))return false;
  if(/(wikipedia\.org|baike\.|163\.com|thepaper\.cn|chinadaily\.com)/.test(b.url))return false;
  const key=b.citationTitle+'|'+b.url;if(seen.has(key))return false;seen.add(key);return true;
 }).slice(0,4).map(x=>({...x,status:'candidate-bibliography-not-opened'}));
}

function markdown(packet) {
 const out = ['# '+packet.name+'｜50人批次公開史料起點','',
  '- 人物 ID：'+packet.recordId,
  '- 身份對接：'+packet.identity,
  '- 來源包版本：batch50-sources-v1',
  '- 原典快照：'+packet.archiveSha256,
  '- 生成時間：'+packet.generatedAt,'',
  '## 使用方式','',
  '本包整理公開古籍固定版本與正式機構來源，不含私人對話、密鑰或遊戲存檔。原人物描述與既有分析是待評價材料，不是史實證據。請在 ChatGPT 真實上網搜尋並打開原來源，對照下列材料後按網站原 PROMPT 寫賞析、五維與靈魂內核；保留既有深度分析。',
  '', '已列摘錄是從本機保存的公版古籍原文按定位直接擷取，UTF-16 半開索引 [charStart,charEnd) 與 SHA-256 可重取驗證；它們不等於全卷校勘或每項敘述已查證。原文、史家評語、裴注／現代整理附注與人物心理推論請自然分層表達。相承史書不可重複計作獨立見證。',
  '', '## 本次請實際搜尋與核對',''];
 for (const question of packet.searchQuestions) out.push('- '+question);
 for (const [n,s] of packet.primarySources.entries()) {
  out.push('','## '+String.fromCharCode(65+n)+'｜'+s.title,'',
   '- 主材料狀態：本機固定版本已讀取／摘錄定位；分析命題待逐項核讀。',
   '- 來源網址：'+s.sourceUrl,
   '- 固定修訂：'+s.revisionUrl,
   '- revisionId：'+s.revisionId,
   '- revisionTimestamp：'+s.revisionTimestamp,
   '- 保存時間：'+s.retrievedAt,
   '- documentId：'+s.documentId,
   '- 本機公開原典：'+s.localPath,
   '- 全卷 textSha256：'+s.textSha256,
   '- archive status：'+s.status,
   '- textCompleteness：'+s.textCompleteness,
   '- 署名與重用：'+s.reuse);
  if(s.status==='incomplete')out.push('- 版本缺口：本庫標記 incomplete；請查原頁／替代版本，未擷取部分不得補造。');
  for(const e of s.excerpts)out.push('','### '+e.label,'',
    '- charStart：'+e.charStart+'；charEnd：'+e.charEnd,
    '- 段落 sha256：'+e.sha256,'','```text',e.text,'```');
 }
 if(packet.existingReviews.length) {
   out.push('','## 已有窄範圍核讀','');
   for(const r of packet.existingReviews) for(const e of r.evidence) out.push('- '+e.supportedFact+'；'+e.url+'；定位：'+e.locator+'；日期：'+e.accessedOn+'；範圍：'+e.reviewScope);
 }
 if(packet.institutionalStarts.length) {
   out.push('','## 正式機構／原文件起點','');
   for(const s of packet.institutionalStarts)out.push('- '+s.title+'：'+s.url+'\n  - 機構：'+(s.institution||'')+'；類型：'+(s.sourceType||'')+'；狀態：'+s.status+'；日期：'+(s.accessedDate||s.accessedOn||s.accessedAt||'2026-10-10')+'\n  - 支持最小命題：'+(s.minimalSupportedClaim||s.supportedFact||s.scope||s.notes||'需打開具體原頁核對')+'\n  - 核讀深度：'+(s.readDepth||'')+'；定位：'+(s.citationLocator||''));
 }
 if(packet.candidateTexts.length || packet.bibliographyCandidates.length) {
   out.push('','## 原典與研究候選（請實際打開）','');
   for(const s of packet.candidateTexts)out.push('- '+s.title+'：'+s.url+'；'+s.purpose);
   for(const b of packet.bibliographyCandidates)out.push('- '+b.citationTitle+'：'+b.url+'；'+[b.author,b.publisher,b.date].filter(Boolean).join('，')+'；索引固定版：'+b.encyclopediaRevisionUrl+'；此項只是書目候選。');
 }
 out.push('');return out.join('\n');
}

await mkdir(folder,{recursive:true});
const modernFile = path.join(folder,'modern-source-starts.v1.json');
let modern = {records:[]};try {modern=JSON.parse(await readFile(modernFile));}catch(e){if(e.code!=='ENOENT')throw e;}
const args=process.argv.slice(2);const selectedSlugs=args.filter(x=>/^\d{2}$/.test(x));
const records=[];
for (const row of manifest.records.filter(r=>!selectedSlugs.length || selectedSlugs.includes(r.slug))) {
 const config=plan[row.slug];
 const modernRow=modern.records.find(x=>x.slug===row.slug);
 if(!config && !modernRow){console.log('pending modern sources '+row.slug+' '+row.context.name);continue;}
 const packet={format:'dynasty-batch50-source-packet',schemaVersion:1,generatedAt:new Date().toISOString(),
  recordId:row.id,slug:row.slug,name:row.context.name,type:row.context.type,dynasty:row.context.dynasty,
  identity:config?.identity||modernRow.identity||row.context.name+'；近現代身份請核正式機構資料。',
  archivePath,archiveSha256:digest(archiveBytes),manifestSha256:digest(manifestBytes),
  searchQuestions:config?.questions||modernRow.searchQuestions||modernRow.questions||modernRow.sources?.map(x=>x.gptSearchQuestion).filter(Boolean)||[],primarySources:[],
  existingReviews:archive.reviews.filter(x=>x.recordIds.includes(row.id)),
  institutionalStarts:modernRow?.sources||modernRow?.institutionalStarts||[],
  candidateTexts:[...(config?.candidateTexts||[]),...(modern.candidateSourcesNotVerified||[]).filter(x=>x.personSlug===row.slug).map(x=>({title:x.title,url:x.url,purpose:x.note,status:x.status}))],bibliographyCandidates:candidateBibliography(dossierMap.get(row.id))};
 if(config)for(const [i,key]of config.docs.entries()) {
  const{document:d,localPath}=await loadDocument(key);
  packet.primarySources.push({title:d.title,documentId:d.id,sourceUrl:d.sourceUrl,revisionUrl:d.revisionUrl,
   revisionId:d.revisionId,revisionTimestamp:d.revisionTimestamp,retrievedAt:d.retrievedAt,textSha256:d.textSha256,
   localPath,status:d.status,textCompleteness:d.textCompleteness,reuse:d.reuse,
   excerpts:excerpts(d,{...config,slug:row.slug},i)});
 }
 if(packet.primarySources.length+packet.institutionalStarts.length<2)throw Error('Fewer than two source starts '+row.slug);
 if(packet.searchQuestions.length<2)throw Error('Missing actual search questions '+row.slug);
 const md=markdown(packet),file=row.slug+'.md',jsonFile=row.slug+'.sources.json';
 await writeFile(path.join(folder,file),md);await writeFile(path.join(folder,jsonFile),JSON.stringify(packet,null,2)+'\n');
 records.push({recordId:row.id,slug:row.slug,name:row.context.name,path:'analysis-batch-50/sources/'+file,
  sha256:digest(md),characters:md.length,jsonPath:'analysis-batch-50/sources/'+jsonFile,
  primarySources:packet.primarySources.length,institutionalStarts:packet.institutionalStarts.length,
  excerpts:packet.primarySources.reduce((n,s)=>n+s.excerpts.length,0),incompleteSourceTitles:packet.primarySources.filter(s=>s.status==='incomplete').map(s=>s.title)});
 console.log(row.slug+' '+row.context.name+' '+packet.primarySources.length+' primary '+packet.institutionalStarts.length+' institutional '+md.length+' chars');
}
const indexPath=path.join(folder,'index.v1.json');let old=[];try{old=JSON.parse(await readFile(indexPath)).records||[];}catch(e){if(e.code!=='ENOENT')throw e;}
const merged=[...new Map([...old,...records].map(x=>[x.slug,x])).values()].sort((a,b)=>a.slug.localeCompare(b.slug));
await writeFile(indexPath,JSON.stringify({format:'dynasty-batch50-source-index',schemaVersion:1,generatedAt:new Date().toISOString(),
 manifestSha256:digest(manifestBytes),archiveSha256:digest(archiveBytes),recordCount:merged.length,records:merged},null,2)+'\n');
