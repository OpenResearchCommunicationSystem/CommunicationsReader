import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

// Second synthetic sample dataset, purpose-built to stress-test
// src/translate/translate.js rather than exercise the whole app (that's
// dummy-dataset-100.zip's job -- see generate-sample-dataset.mjs).
// Deliberately NO attachments (out of scope for this dataset) and NO
// short one-liners: every message is long-form formal business prose,
// because short chat-style lines (dummy-dataset-100's style) don't
// stress a translation model the way a real forwarded business letter
// does. See this file's own header comment further down for the rubric
// this dataset is meant to be graded against.
//
// Covers exactly the five languages translate.js's AVAILABLE_LANGS
// currently ships (ara/chi_sim/rus/tur/fas) plus a small Greek
// "negative control" section -- Greek has no translation model (see
// AVAILABLE_LANGS's own comment on why), so those messages exist to
// confirm the app reports "unsupported" cleanly instead of attempting a
// translation or crashing.

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, '..', 'sample-data');
const OUT_ZIP = path.join(OUT_DIR, 'dummy-dataset-language-test-1.zip');

const ROBERT = 'Robert Chen <robert.chen@globaltradepartners.com>';

let msgCounter = 0;
function nextMessageId(domain = 'example.com') {
  msgCounter++;
  return `<msg-${msgCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${domain}>`;
}

function headerBlock(headers) {
  return Object.entries(headers)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');
}

function buildPlainMessage({ headers, body }) {
  const finalHeaders = { 'MIME-Version': '1.0', 'Content-Type': 'text/plain; charset=utf-8', ...headers };
  return Buffer.from(headerBlock(finalHeaders) + '\r\n\r\n' + body, 'utf8');
}

function daysAgo(n, hour = 10) {
  const d = new Date('2026-07-09T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toUTCString().replace('GMT', '+0000');
}

const messages = []; // { zipPath, content: Buffer }
let fileCounter = 0;
function addMessage(folder, buf) {
  fileCounter++;
  messages.push({ zipPath: `${folder}/msg-${String(fileCounter).padStart(3, '0')}.eml`, content: buf });
}

function tag(subjectBase, label) {
  return `${subjectBase} · [${label}]`;
}

// =========================================================================
// Per-language content. Six standalone paragraphs each (~50-90 words,
// formal register), every one carrying a date, a monetary/reference
// number, a proper noun, and -- deliberately -- an embedded English
// trade term (CIF/FOB/Demurrage/Due Diligence/etc.), since real business
// correspondence in these languages code-switches on trade/legal jargon
// constantly and that's a genuine translation edge case, not a
// contrived one. Longer letters are built by concatenating 2, 4, or all
// 6 of these rather than hand-writing 20 unique long letters per
// language -- same content, deliberately reused in different
// combinations to produce short/medium/long/extra-long variants without
// needing 100+ independently authored paragraphs.
// =========================================================================

const LANGS = {
  chi_sim: {
    folder: 'Inbox/LangTest-CN',
    domain: 'huaxintrading.cn',
    people: [
      'Li Wei <li.wei@huaxintrading.cn>',
      'Zhang Min <zhang.min@huaxintrading.cn>',
      'Chen Qiang <chen.qiang@orientalshipping.com.cn>',
    ],
    subjectBase: '重要商务事项',
    forwardNote: '请查收以下往来邮件，供你存档。',
    paragraphs: [
      '关于本次租船合同（Charter Party）第七条款项的修订，我方希望将卸货港的滞期费标准从每日8,500美元调整为9,200美元，以反映近期燃油成本的上涨。请贵司法务部门于本月25日前确认是否接受该修订，以便双方尽快签署补充协议。',
      '关于发票编号INV-77341的付款问题，我方财务部门核对后发现贵司实际到账金额为142,600美元，较合同约定的150,000美元少了7,400美元。请贵司说明差额产生的具体原因，并在收到本邮件后五个工作日内补齐差额，否则我方将暂停下一批货物的装运安排。',
      '根据海关总署最新发布的原产地证明（Certificate of Origin）要求，自下季度起所有出口至东南亚地区的货物必须附带经认证的CO文件，否则将无法完成清关手续。请贵司出口部门尽快与当地商会联系，办理相关认证，避免因文件缺失导致货物滞留港口。',
      '关于贵司提出的股权收购意向，我方董事会已于上周五召开专题会议，初步同意以每股4.35美元的价格收购贵司在东南亚物流子公司35%的股权，总金额约为1,220万美元。具体条款仍需双方法律顾问进一步磋商，预计将在下月中旬完成尽职调查（Due Diligence）。',
      '对于上批货物因港口拥堵导致的十一天延误，我方深表歉意。经核实，此次延误并非我方仓储管理疏漏所致，而是由于目的港连续遭遇恶劣天气，导致多艘船舶被迫在锚地等待。我方已安排优先靠泊，并将承担因延误产生的仓储附加费用。',
      '截至本季度末，我方与贵司的贸易往来总额达到3,860万美元，较上一季度增长约12%，主要得益于东南亚航线新增的三条定期班轮服务。展望下季度，我方计划进一步扩大与贵司在原油及成品油贸易领域的合作规模，具体方案将在下次季度会议上详细说明。',
    ],
  },
  ara: {
    folder: 'Inbox/LangTest-AR',
    domain: 'gulfmaritime.ae',
    people: [
      'Yousef Al-Abdullah <yousef.alabdullah@gulfmaritime.ae>',
      'Khalid Al-Mansour <khalid.almansour@desertfinance.sa>',
      'Sara Al-Hassan <sara.alhassan@gulfmaritime.ae>',
    ],
    subjectBase: 'بخصوص عدة أمور تجارية مهمة',
    forwardNote: 'يرجى الاطلاع على المراسلات أدناه للأرشفة.',
    paragraphs: [
      'بخصوص تعديل الفقرة السابعة من عقد استئجار السفينة (Charter Party)، نرغب في تعديل قيمة غرامة التأخير (Demurrage) في ميناء التفريغ من 8,500 دولار يومياً إلى 9,200 دولار، وذلك انعكاساً لارتفاع تكاليف الوقود مؤخراً. نرجو من الإدارة القانونية لديكم تأكيد الموافقة قبل تاريخ 25 من هذا الشهر لإتمام توقيع الملحق.',
      "بخصوص الفاتورة رقم INV-77341، لاحظ قسم المحاسبة لدينا أن المبلغ المستلم فعلياً هو 142,600 دولار، بينما القيمة المتفق عليها في العقد هي 150,000 دولار، أي بفارق قدره 7,400 دولار. نرجو توضيح سبب هذا الفارق وسداد المبلغ المتبقي خلال خمسة أيام عمل من تاريخ استلام هذه الرسالة.",
      'وفقاً للمتطلبات الجديدة الصادرة عن الجمارك بخصوص شهادة المنشأ (Certificate of Origin)، يجب أن ترفق جميع الشحنات المصدرة إلى دول جنوب شرق آسيا اعتباراً من الربع القادم بشهادة منشأ معتمدة، وإلا فلن يتم استكمال إجراءات التخليص الجمركي. نرجو من قسم التصدير التواصل مع الغرفة التجارية المحلية في أقرب وقت.',
      'بخصوص عرض الاستحواذ المقدم من قبلكم، عقد مجلس الإدارة اجتماعاً خاصاً يوم الجمعة الماضي، ووافق مبدئياً على الاستحواذ على 35% من حصص الشركة التابعة للخدمات اللوجستية في جنوب شرق آسيا بسعر 4.35 دولار للسهم، بقيمة إجمالية تقارب 12.2 مليون دولار، على أن يتم استكمال إجراءات الفحص النافي للجهالة (Due Diligence) الشهر المقبل.',
      'نتقدم باعتذارنا الصادق عن التأخير الذي بلغ أحد عشر يوماً في وصول الشحنة الأخيرة بسبب ازدحام الميناء. وقد تبين بعد المراجعة أن التأخير لم ينتج عن أي تقصير في إدارة المستودعات لدينا، وإنما بسبب سوء الأحوال الجوية في ميناء الوجهة، مما اضطر عدداً من السفن للانتظار في المرسى. وسنقوم بتحمل أي رسوم تخزين إضافية ناتجة عن ذلك.',
      'بلغ إجمالي حجم التبادل التجاري بيننا خلال هذا الربع 38.6 مليون دولار، بارتفاع نسبته 12% مقارنة بالربع السابق، ويعود ذلك بشكل أساسي إلى إضافة ثلاثة خطوط ملاحية منتظمة على مسار جنوب شرق آسيا. ونخطط خلال الربع القادم لتوسيع تعاوننا في مجال تجارة النفط الخام والمشتقات، وسنقدم تفاصيل الخطة في الاجتماع الربعي القادم.',
    ],
  },
  rus: {
    folder: 'Inbox/LangTest-RU',
    domain: 'volgatrade.ru',
    people: [
      'Igor Petrov <igor.petrov@sibneftlogistics.ru>',
      'Natalia Sokolova <natalia.sokolova@volgatrade.ru>',
      'Dmitri Volkov <dmitri.volkov@volgatrade.ru>',
    ],
    subjectBase: 'Важные деловые вопросы',
    forwardNote: 'Пожалуйста, ознакомьтесь с перепиской ниже для архива.',
    paragraphs: [
      'Уважаемая Наталья Соколова, в отношении пункта 7 договора фрахтования (Charter Party) мы хотели бы изменить ставку демереджа в порту выгрузки с 8 500 долларов США в сутки до 9 200 долларов США, учитывая недавний рост стоимости топлива. Просим ваш юридический отдел подтвердить согласие до 25 числа текущего месяца, чтобы мы могли подписать дополнительное соглашение.',
      'По счету-фактуре № INV-77341 наш финансовый отдел обнаружил расхождение: фактически поступившая сумма составила 142 600 долларов США, тогда как по договору должно было поступить 150 000 долларов, разница составляет 7 400 долларов. Просим пояснить причину расхождения и перечислить оставшуюся сумму в течение пяти рабочих дней.',
      'Согласно новым таможенным требованиям, начиная со следующего квартала все грузы, экспортируемые в страны Юго-Восточной Азии, должны сопровождаться сертификатом происхождения (Certificate of Origin), иначе таможенное оформление не будет завершено. Просим экспортный отдел незамедлительно связаться с местной торговой палатой для получения необходимого сертификата.',
      'Относительно вашего предложения о приобретении доли, совет директоров провёл специальное заседание в прошлую пятницу и предварительно одобрил приобретение 35% акций логистической дочерней компании в Юго-Восточной Азии по цене 4,35 доллара за акцию, на общую сумму около 12,2 миллиона долларов. Юридическая проверка (Due Diligence) должна быть завершена в середине следующего месяца.',
      'Приносим искренние извинения за задержку в одиннадцать дней при доставке последней партии груза из-за перегруженности порта. После проверки выяснилось, что задержка произошла не по вине нашего складского управления, а из-за неблагоприятных погодных условий в порту назначения, из-за чего нескольким судам пришлось ожидать на рейде. Мы возьмём на себя дополнительные расходы на хранение, возникшие в результате этой задержки.',
      'Общий объём торгового оборота между нашими компаниями за этот квартал составил 38,6 миллиона долларов, что на 12% больше, чем в прошлом квартале, главным образом благодаря запуску трёх новых регулярных судоходных линий в Юго-Восточную Азию. В следующем квартале мы планируем расширить сотрудничество в области торговли сырой нефтью и нефтепродуктами, подробности будут представлены на следующей квартальной встрече.',
    ],
  },
  tur: {
    folder: 'Inbox/LangTest-TR',
    domain: 'anadolulojistik.com.tr',
    people: [
      'Mehmet Yilmaz <mehmet.yilmaz@anadolulojistik.com.tr>',
      'Ayse Kaya <ayse.kaya@anadolulojistik.com.tr>',
      'Emre Sahin <emre.sahin@bogazicifinans.com.tr>',
    ],
    subjectBase: 'Onemli is konulari',
    forwardNote: 'Lutfen asagidaki yaziyi arsiviniz icin inceleyin.',
    paragraphs: [
      "Sayin Ayse Hanim, navlun sozlesmesinin (Charter Party) yedinci maddesi kapsaminda, tahliye limanindaki demuraj bedelini gunluk 8.500 dolardan 9.200 dolara yukseltmeyi teklif ediyoruz; bu degisiklik son donemde artan yakit maliyetlerini yansitmaktadir. Hukuk departmaninizin bu ayin 25'ine kadar onayini rica ederiz, boylece ek protokolu imzalayabiliriz.",
      "INV-77341 numarali fatura ile ilgili olarak, muhasebe departmanimiz odenen tutarin 142.600 dolar oldugunu, ancak sozlesmede belirtilen tutarin 150.000 dolar oldugunu tespit etmistir; aradaki 7.400 dolarlik fark aciklanmalidir. Bu farkin nedenini bildirmenizi ve kalan tutari bu yaziyi aldiktan sonra bes is gunu icinde odemenizi rica ederiz.",
      'Gumruk idaresinin yeni duzenlemesine gore, onumuzdeki ceyrekten itibaren Guneydogu Asya\'ya ihraç edilen tum yuklerin onayli Mensei Sehadetnamesi (Certificate of Origin) ile birlikte gonderilmesi gerekmektedir, aksi halde gumruk islemleri tamamlanamayacaktir. Ihracat departmaninizin en kisa surede yerel ticaret odasiyla iletisime gecmesini rica ederiz.',
      "Onerdiginiz hisse devri teklifi kapsaminda, yonetim kurulumuz gecen Cuma ozel bir toplanti yaparak, Guneydogu Asya'daki lojistik bagli ortakligimizin yuzde 35'lik hissesinin pay basina 4,35 dolardan, toplamda yaklasik 12,2 milyon dolar karsiliginda devrini on onayla kabul etmistir. Durum tespit incelemesinin (Due Diligence) gelecek ayin ortasina kadar tamamlanmasi beklenmektedir.",
      'Son sevkiyatin liman yogunlugu nedeniyle on bir gun gecikmesinden dolayi icten ozurlerimizi sunariz. Yapilan inceleme sonucunda gecikmenin depo yonetimimizden degil, varis limanindaki olumsuz hava kosullarindan kaynaklandigi, bu nedenle bircok geminin demirlemede beklemek zorunda kaldigi anlasilmistir. Bu gecikme nedeniyle olusan ek depolama ucretlerini biz karsilayacagiz.',
      "Bu ceyrekte aramizdaki toplam ticaret hacmi 38,6 milyon dolara ulasti; bu, bir onceki ceyrege gore yaklasik yuzde 12'lik bir artisa denk gelmektedir ve bu artis oncelikle Guneydogu Asya hattina eklenen uc yeni duzenli hat sayesinde gerceklesmistir. Onumuzdeki ceyrekte ham petrol ve rafine urun ticaretindeki isbirligimizi genisletmeyi planliyoruz; detaylar bir sonraki ceyrek toplantisinda paylasilacaktir.",
    ],
  },
  fas: {
    folder: 'Inbox/LangTest-FA',
    domain: 'parsiaviation.ir',
    people: [
      'Reza Hosseini <reza.hosseini@parsiaviation.ir>',
      'Maryam Ahmadi <maryam.ahmadi@tehranexport.ir>',
      'Farhad Karimi <farhad.karimi@parsiaviation.ir>',
    ],
    subjectBase: 'چند موضوع مهم تجاری',
    forwardNote: 'لطفاً مکاتبات زیر را برای بایگانی بررسی نمایید.',
    paragraphs: [
      'خانم مریم احمدی گرامی، در خصوص بند هفتم قرارداد اجاره کشتی (Charter Party)، مایلیم نرخ خسارت توقف (Demurrage) در بندر تخلیه را از روزی 8,500 دلار به 9,200 دلار افزایش دهیم؛ این تغییر به دلیل افزایش اخیر هزینه‌های سوخت است. خواهشمندیم واحد حقوقی شما تا تاریخ 25 همین ماه تأیید خود را اعلام کند تا الحاقیه قرارداد امضا شود.',
      'در خصوص فاکتور شماره INV-77341، واحد مالی ما متوجه شد که مبلغ واریزی واقعی 142,600 دلار بوده، در حالی که طبق قرارداد باید 150,000 دلار واریز می‌شد؛ این اختلاف 7,400 دلار است. خواهشمندیم دلیل این مغایرت را توضیح داده و مابقی مبلغ را ظرف پنج روز کاری پس از دریافت این نامه واریز نمایید.',
      'طبق الزامات جدید گمرکی، از فصل آینده تمامی محموله‌های صادراتی به کشورهای جنوب شرق آسیا باید همراه با گواهی مبدأ (Certificate of Origin) معتبر ارسال شوند، در غیر این صورت تشریفات گمرکی تکمیل نخواهد شد. خواهشمندیم واحد صادرات شما در اسرع وقت با اتاق بازرگانی محلی تماس بگیرد.',
      'در خصوص پیشنهاد تملک سهام از سوی شما، هیئت مدیره ما جلسه ویژه‌ای در جمعه گذشته برگزار کرد و به‌طور مقدماتی با تملک 35 درصد از سهام شرکت تابعه لجستیک در جنوب شرق آسیا، به قیمت هر سهم 4.35 دلار و مجموع تقریبی 12.2 میلیون دلار موافقت نمود. بررسی دقیق (Due Diligence) قرار است تا اواسط ماه آینده تکمیل شود.',
      'بابت تأخیر یازده روزه در رسیدن محموله اخیر به دلیل ازدحام بندر، صمیمانه عذرخواهی می‌کنیم. پس از بررسی مشخص شد این تأخیر ناشی از کوتاهی در مدیریت انبار ما نبوده، بلکه به دلیل شرایط نامساعد جوی در بندر مقصد بوده که باعث شد چندین کشتی مجبور به انتظار در لنگرگاه شوند. هزینه‌های اضافی انبارداری ناشی از این تأخیر بر عهده ما خواهد بود.',
      'حجم کل مبادلات تجاری بین ما در این فصل به 38.6 میلیون دلار رسید که نسبت به فصل گذشته حدود 12 درصد رشد داشته است؛ این رشد عمدتاً به دلیل افزودن سه خط کشتیرانی منظم جدید به مسیر جنوب شرق آسیا بوده است. در فصل آینده قصد داریم همکاری خود را در زمینه تجارت نفت خام و فرآورده‌های نفتی گسترش دهیم؛ جزئیات در نشست فصلی بعدی ارائه خواهد شد.',
    ],
  },
};

// Fixed paragraph-index combinations, reused across every language so the
// "shape" of the dataset (which topics get combined into which letters)
// is identical language to language -- makes cross-language comparison of
// translation quality on equivalent content straightforward.
const QUAD_COMBOS = [
  [0, 1, 2, 3],
  [1, 2, 4, 5],
  [0, 3, 4, 5],
];
const PAIR_COMBOS = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
  [1, 2], [1, 3], [1, 4], [1, 5], [2, 3],
];

function joinParagraphs(paragraphs, indices) {
  return indices.map((i) => paragraphs[i]).join('\n\n');
}

function generateForLanguage(langCode, cfg, baseDaysAgo) {
  const { folder, domain, people, paragraphs, subjectBase, forwardNote } = cfg;
  let dayOffset = baseDaysAgo;
  let personIdx = 0;
  function nextPerson() {
    const p = people[personIdx % people.length];
    personIdx++;
    return p;
  }

  // -- Long letters (4 of the 6 paragraphs each) --------------------------
  QUAD_COMBOS.forEach((combo, i) => {
    const from = nextPerson();
    const to = nextPerson();
    const buf = buildPlainMessage({
      headers: {
        From: from, To: to,
        Subject: tag(subjectBase, `LONG ${i + 1}/${QUAD_COMBOS.length}`),
        Date: daysAgo(dayOffset), 'Message-ID': nextMessageId(domain),
      },
      body: joinParagraphs(paragraphs, combo),
    });
    addMessage(folder, buf);
    dayOffset -= 1;
  });

  // -- One extra-long letter (all 6 paragraphs) -- a token-limit probe ----
  {
    const from = nextPerson();
    const to = nextPerson();
    const buf = buildPlainMessage({
      headers: {
        From: from, To: to,
        Subject: tag(subjectBase, 'XLONG'),
        Date: daysAgo(dayOffset), 'Message-ID': nextMessageId(domain),
      },
      body: joinParagraphs(paragraphs, [0, 1, 2, 3, 4, 5]),
    });
    addMessage(folder, buf);
    dayOffset -= 1;
  }

  // -- Medium letters (2 of the 6 paragraphs each) -------------------------
  PAIR_COMBOS.forEach((combo, i) => {
    const from = nextPerson();
    const to = nextPerson();
    const buf = buildPlainMessage({
      headers: {
        From: from, To: to,
        Subject: tag(subjectBase, `MED ${i + 1}/${PAIR_COMBOS.length}`),
        Date: daysAgo(dayOffset), 'Message-ID': nextMessageId(domain),
      },
      body: joinParagraphs(paragraphs, combo),
    });
    addMessage(folder, buf);
    dayOffset -= 1;
  });

  // -- Deep forward chain: 1 original + 5 forwards, each hop quoting the ---
  // -- ENTIRE previous message (true nesting, not flattened to the
  // -- original) -- both subject ("Fwd: Fwd: Fwd: ...") and body quote
  // -- depth grow every hop, stress-testing normalizeSubject's stacked-
  // -- prefix stripping and the translator on genuinely long, deeply
  // -- quoted input.
  {
    let currentSubject = tag(subjectBase, 'FWD 1/6 - ORIGINAL');
    let currentFrom = nextPerson();
    let currentTo = nextPerson();
    let currentDate = daysAgo(dayOffset);
    let currentBody = joinParagraphs(paragraphs, [0, 1]);

    addMessage(folder, buildPlainMessage({
      headers: { From: currentFrom, To: currentTo, Subject: currentSubject, Date: currentDate, 'Message-ID': nextMessageId(domain) },
      body: currentBody,
    }));

    for (let hop = 1; hop <= 5; hop++) {
      dayOffset -= 2;
      const nextFrom = hop === 5 ? ROBERT : nextPerson();
      const nextTo = hop === 5 ? nextPerson() : ROBERT;
      const nextDate = daysAgo(dayOffset);
      const quoted =
        `---------- Forwarded message ---------\n` +
        `From: ${currentFrom}\nDate: ${currentDate}\nSubject: ${currentSubject}\nTo: ${currentTo}\n\n${currentBody}`;
      const nextBody = `${forwardNote}\n\n${quoted}`;
      const nextSubject = `Fwd: ${currentSubject.replace(/ · \[.*\]$/, '')}`.replace(
        /$/,
        ` · [FWD ${hop + 1}/6]`
      );

      addMessage(folder, buildPlainMessage({
        headers: { From: nextFrom, To: nextTo, Subject: nextSubject, Date: nextDate, 'Message-ID': nextMessageId(domain) },
        body: nextBody,
      }));

      currentSubject = nextSubject;
      currentFrom = nextFrom;
      currentTo = nextTo;
      currentDate = nextDate;
      currentBody = nextBody;
    }
  }
}

generateForLanguage('chi_sim', LANGS.chi_sim, 90);
generateForLanguage('ara', LANGS.ara, 75);
generateForLanguage('rus', LANGS.rus, 60);
generateForLanguage('tur', LANGS.tur, 45);
generateForLanguage('fas', LANGS.fas, 30);

// =========================================================================
// Greek negative control -- translate.js has NO Greek model (see
// AVAILABLE_LANGS's own comment: the only pre-converted Marian el-en
// tokenizer produced repetition-looping garbage during implementation
// and was deliberately cut, not shipped). These five messages exist so
// testing this dataset also confirms the app reports Greek as
// unsupported for translation cleanly, rather than silently attempting
// one or crashing. Real Greek script this time (Greek OCR IS supported,
// unlike translation) -- unlike dataset 1's romanized Greek thread.
// =========================================================================
const GREEK_MESSAGES = [
  { body: "Αγαπητέ Δημήτρη, σχετικά με το τιμολόγιο υπ' αριθμόν INV-90210, το ποσό που εμβάσαμε είναι 54.300 ευρώ. Παρακαλώ επιβεβαιώστε την παραλαβή έως τις 20 του μηνός." },
  { body: 'Αγαπητέ Νίκο, η αποστολή καθυστερεί λόγω κακών καιρικών συνθηκών στο λιμάνι προορισμού. Θα σας ενημερώσουμε μόλις υπάρξει νεότερο.' },
  { body: 'Αγαπητέ Δημήτρη, το νέο ναυλοσύμφωνο (Charter Party) πρέπει να υπογραφεί έως την Παρασκευή. Παρακαλώ ελέγξτε το άρθρο 5 σχετικά με τις ρήτρες καθυστέρησης.' },
  { body: 'Αγαπητέ Νίκο, η τριμηνιαία αναφορά δείχνει αύξηση 9% στον όγκο συναλλαγών. Θα συζητήσουμε λεπτομέρειες στην επόμενη συνάντηση.' },
  { body: 'Αγαπητέ Δημήτρη, χρειαζόμαστε το πιστοποιητικό καταγωγής (Certificate of Origin) πριν από την αποστολή του επόμενου φορτίου.' },
];
const nikos = 'Nikos Papadopoulos <nikos.papadopoulos@aegeanshipping.gr>';
const dimitris = 'Dimitris Konstantinou <dimitris.konstantinou@hellenictrade.gr>';
GREEK_MESSAGES.forEach((g, i) => {
  const buf = buildPlainMessage({
    headers: {
      From: i % 2 === 0 ? nikos : dimitris,
      To: i % 2 === 0 ? dimitris : nikos,
      Subject: tag('Ελληνικά - δοκιμή', `GREEK-UNSUPPORTED ${i + 1}/${GREEK_MESSAGES.length}`),
      Date: daysAgo(10 - i), 'Message-ID': nextMessageId('aegeanshipping.gr'),
    },
    body: g.body,
  });
  addMessage('Inbox/LangTest-EL', buf);
});

// --- write the zip -------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const zip = new AdmZip();
for (const m of messages) zip.addFile(m.zipPath, m.content);
zip.writeZip(OUT_ZIP);

console.log(`Wrote ${messages.length} messages to ${OUT_ZIP}`);
