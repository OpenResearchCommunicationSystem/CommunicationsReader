import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { buildMinimalDocx, buildMinimalPdfWithText } from '../test/fixtures/generate-office-fixtures.js';
import { renderTextToPng } from '../test/fixtures/render-text-png.js';

// Synthetic (fully invented) 100-email sample dataset for manually
// exercising the app end-to-end: search, threading (header-linked AND
// subject-fallback), crypto/keyword detection, multi-language text,
// forwards, junk mail, attachment extraction/OCR, and attachment
// dedup (the same file attached to several messages). No real names,
// companies, or data sources -- every identity/address/company below is
// invented for this purpose.

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, '..', 'sample-data');
const OUT_ZIP = path.join(OUT_DIR, 'dummy-dataset-100.zip');

// --- fake-but-syntactically-valid wallet addresses -------------------------
// Matches src/crypto-detect/wallet-patterns.js's regexes exactly (charset +
// length), so a real crypto scan of this dataset produces real hits.
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const HEX = '0123456789abcdef';
function randChars(charset, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += charset[Math.floor(Math.random() * charset.length)];
  return s;
}
const fakeTron = () => 'T' + randChars(BASE58, 33);
const fakeEth = () => '0x' + randChars(HEX, 40);
const fakeBtcBech32 = () => 'bc1' + randChars(BECH32, 39);
const fakeBtcLegacy = () => '1' + randChars(BASE58, 33);

// --- identities --------------------------------------------------------
// Display names kept in Latin script (even where the language isn't) to
// stay clear of raw-non-ASCII-header-parsing edge cases; the native-script
// content lives in subjects/bodies, which is what matters for testing
// search/threading/OCR anyway.
const PEOPLE = {
  liWei: 'Li Wei <li.wei@huaxintrading.cn>',
  chenQiang: 'Chen Qiang <chen.qiang@orientalshipping.com.cn>',
  zhangMin: 'Zhang Min <zhang.min@huaxintrading.cn>',
  carlos: 'Carlos Mendoza <carlos.mendoza@comercialdelsur.es>',
  laura: 'Laura Fernandez <laura.fernandez@comercialdelsur.es>',
  javier: 'Javier Ortiz <javier.ortiz@transportesibericos.mx>',
  yousef: 'Yousef Al-Abdullah <yousef.alabdullah@gulfmaritime.ae>',
  sara: 'Sara Al-Hassan <sara.alhassan@gulfmaritime.ae>',
  khalid: 'Khalid Al-Mansour <khalid.almansour@desertfinance.sa>',
  nikos: 'Nikos Papadopoulos <nikos.papadopoulos@aegeanshipping.gr>',
  eleni: 'Eleni Georgiou <eleni.georgiou@aegeanshipping.gr>',
  dimitris: 'Dimitris Konstantinou <dimitris.konstantinou@hellenictrade.gr>',
  mehmet: 'Mehmet Yilmaz <mehmet.yilmaz@anadolulojistik.com.tr>',
  ayse: 'Ayse Kaya <ayse.kaya@anadolulojistik.com.tr>',
  emre: 'Emre Sahin <emre.sahin@bogazicifinans.com.tr>',
  robert: 'Robert Chen <robert.chen@globaltradepartners.com>',
};

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

function buildMultipartMessage({ headers, body, attachments }) {
  const boundary = `----Boundary${Math.random().toString(36).slice(2, 12)}`;
  const finalHeaders = {
    'MIME-Version': '1.0',
    'Content-Type': `multipart/mixed; boundary="${boundary}"`,
    ...headers,
  };
  const parts = [`--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}\r\n`];
  for (const att of attachments) {
    const b64 = att.content.toString('base64').replace(/(.{76})/g, '$1\r\n');
    parts.push(
      `--${boundary}\r\nContent-Type: ${att.mimeType}; name="${att.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${att.filename}"\r\n\r\n${b64}\r\n`
    );
  }
  parts.push(`--${boundary}--\r\n`);
  return Buffer.from(headerBlock(finalHeaders) + '\r\n\r\n' + parts.join(''), 'utf8');
}

const messages = []; // { zipPath, content: Buffer }
let fileCounter = 0;
function addMessage(folder, buf) {
  fileCounter++;
  messages.push({ zipPath: `${folder}/msg-${String(fileCounter).padStart(3, '0')}.eml`, content: buf });
}

function daysAgo(n, hour = 10) {
  const d = new Date('2026-06-20T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toUTCString().replace('GMT', '+0000');
}

// --- prebuilt attachments ------------------------------------------------
const helloWorldPng = renderTextToPng('HELLO WORLD');
const worldPng = renderTextToPng('WORLD');
const invoiceDocx = buildMinimalDocx('华鑫贸易有限公司 发票 INV-88213 - 原油货款 285,000 USDT - TRC20结算');
const contractPdf = buildMinimalPdfWithText('CHARTER PARTY - Vessel MV Test Trader - 50000 MT crude oil - Payment via USDT TRC20');

const PNG = { filename: 'photo_forwarded.png', mimeType: 'image/png', content: helloWorldPng };
const PNG2 = { filename: 'site_photo.png', mimeType: 'image/png', content: worldPng };
const DOCX = { filename: 'invoice.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: invoiceDocx };
const PDF = { filename: 'charter_party.pdf', mimeType: 'application/pdf', content: contractPdf };

// =========================================================================
// 1. Financial threads (header-linked via Message-ID/In-Reply-To/References,
//    except thread 4 which deliberately omits headers to exercise the
//    subject-fallback path -- real exports frequently lack them).
// =========================================================================

function financialThread({ folder, subject, messagesSpec, linkByHeaders }) {
  let prevId = null;
  const allIds = [];
  messagesSpec.forEach((spec, i) => {
    const id = nextMessageId('trading.example');
    allIds.push(id);
    const headers = {
      From: spec.from,
      To: spec.to,
      Subject: i === 0 ? subject : `Re: ${subject}`,
      Date: daysAgo(spec.daysAgo, spec.hour),
      'Message-ID': id,
    };
    if (linkByHeaders && prevId) {
      headers['In-Reply-To'] = prevId;
      headers.References = allIds.slice(0, -1).join(' ');
    }
    const buf = spec.attachments
      ? buildMultipartMessage({ headers, body: spec.body, attachments: spec.attachments })
      : buildPlainMessage({ headers, body: spec.body });
    addMessage(folder, buf);
    prevId = id;
  });
}

// Thread 1 -- Chinese, crude oil / USDT settlement (header-linked)
financialThread({
  folder: 'Inbox/CN',
  subject: '关于原油货款结算的安排',
  linkByHeaders: true,
  messagesSpec: [
    {
      from: PEOPLE.liWei, to: PEOPLE.chenQiang, daysAgo: 40,
      body: `陈强先生，您好。\n\n关于上月装运的原油货款，我们建议通过 USDT (TRC20) 结算，以加快到账速度。\n钱包地址：${fakeTron()}\n应付金额：285,000 USDT\n\n请确认后安排付款，谢谢。\n\n李伟\n华鑫贸易有限公司`,
      attachments: [DOCX],
    },
    {
      from: PEOPLE.chenQiang, to: PEOPLE.liWei, daysAgo: 39,
      body: `李伟先生，您好。\n\n已收到发票，金额确认无误。我们会在两个工作日内完成 USDT 转账。\n请提供收款钱包的二次确认，避免出错。\n\n陈强\nOriental Shipping Co.`,
    },
    {
      from: PEOPLE.liWei, to: PEOPLE.chenQiang, daysAgo: 38,
      body: `陈强先生：\n\n钱包地址二次确认如下（请仔细核对每一位字符）：\n${fakeTron()}\n\n另外，如果 USDT 转账遇到问题，可以走比特币 (Bitcoin) 通道，我方钱包：\n${fakeBtcBech32()}\n\n谢谢配合。`,
    },
    {
      from: PEOPLE.chenQiang, to: PEOPLE.liWei, daysAgo: 36,
      body: `李伟先生：\n\n转账已完成，交易哈希已通过其他渠道发送。请查收 285,000 USDT。\n本次结算涉及金额较大，建议双方保留好聊天与邮件记录。\n\n陈强`,
    },
    {
      from: PEOPLE.liWei, to: PEOPLE.chenQiang, daysAgo: 35,
      body: `陈强先生：\n\n资金已到账，交易完成。感谢合作，期待下批货物的装运安排。\n\n李伟`,
    },
  ],
});

// Thread 2 -- Spanish, invoice + wire transfer + BTC (header-linked)
financialThread({
  folder: 'Inbox/ES',
  subject: 'Liquidacion de factura y transferencia bancaria',
  linkByHeaders: true,
  messagesSpec: [
    {
      from: PEOPLE.carlos, to: PEOPLE.javier, daysAgo: 30,
      body: `Estimado Javier,\n\nAdjunto la factura correspondiente al ultimo envio. El importe total es de 42,300 EUR.\n\nComo alternativa a la transferencia bancaria tradicional, podemos recibir el pago en Bitcoin a esta direccion (crypto wallet):\n${fakeBtcLegacy()}\n\nQuedamos atentos.\nCarlos Mendoza\nComercial del Sur`,
    },
    {
      from: PEOPLE.javier, to: PEOPLE.carlos, daysAgo: 29,
      body: `Estimado Carlos,\n\nRecibido, gracias. Preferimos hacer la transferencia bancaria (wire transfer) habitual esta vez, ya que el departamento de contabilidad aun no aprueba pagos en criptomoneda directamente.\n\nConfirmo el importe: 42,300 EUR. Enviaremos el comprobante en 48 horas.\n\nJavier Ortiz`,
    },
    {
      from: PEOPLE.carlos, to: PEOPLE.javier, daysAgo: 27,
      body: `Javier,\n\nPerfecto, quedamos a la espera del comprobante de la transferencia bancaria.\n\nUn saludo,\nCarlos`,
    },
    {
      from: PEOPLE.javier, to: PEOPLE.carlos, daysAgo: 25,
      body: `Carlos,\n\nTransferencia realizada. Numero de referencia bancaria: TR-2026-889213. Deberia reflejarse en 1-2 dias habiles.\n\nSaludos,\nJavier`,
      attachments: [PNG],
    },
  ],
});

// Thread 3 -- Arabic, hawala + wallet (header-linked)
financialThread({
  folder: 'Inbox/AR',
  subject: 'ترتيبات تحويل الأموال عبر الحوالة',
  linkByHeaders: true,
  messagesSpec: [
    {
      from: PEOPLE.yousef, to: PEOPLE.khalid, daysAgo: 22,
      body: `الأستاذ خالد المحترم،\n\nبخصوص المبلغ المستحق، نقترح التحويل عبر الحوالة (hawala) نظراً لسرعة الإجراء.\nكما يمكن التحويل عبر USDT إلى المحفظة التالية:\n${fakeEth()}\n\nالمبلغ الإجمالي: 96,500 دولار\n\nمع خالص التقدير،\nيوسف العبدالله`,
    },
    {
      from: PEOPLE.khalid, to: PEOPLE.yousef, daysAgo: 21,
      body: `الأستاذ يوسف المحترم،\n\nتم استلام الرسالة. سنقوم بالتحويل عبر الحوالة كما هو معتاد. سيتم التأكيد خلال يومين.\n\nمع التحية،\nخالد المنصور`,
    },
    {
      from: PEOPLE.yousef, to: PEOPLE.khalid, daysAgo: 19,
      body: `الأستاذ خالد،\n\nالرجاء التأكيد بمجرد إتمام الحوالة. صرافي المنطقة يعرف تفاصيل الاستلام.\n\nيوسف`,
    },
    {
      from: PEOPLE.khalid, to: PEOPLE.yousef, daysAgo: 18,
      body: `الأستاذ يوسف،\n\nتم إتمام الحوالة بنجاح. المبلغ 96,500 دولار وصل عبر الصرافي المحلي.\n\nخالد`,
    },
  ],
});

// Thread 4 -- Greek, shipping + crypto payment. Deliberately NO
// In-Reply-To/References -- exercises subject-fallback threading.
financialThread({
  folder: 'Inbox/EL',
  subject: 'Pliromi gia tin naylosi tou ploiou',
  linkByHeaders: false,
  messagesSpec: [
    {
      from: PEOPLE.nikos, to: PEOPLE.dimitris, daysAgo: 16,
      body: `Agapite Dimitri,\n\nGia tin naylosi tou ploiou, protinoume pliromi se Tether (USDT) gia taxytita.\nDiefthynsi crypto wallet: ${fakeTron()}\nPoso: 61,000 USDT\n\nMe ektimisi,\nNikos Papadopoulos\nAegean Shipping`,
    },
    {
      from: PEOPLE.dimitris, to: PEOPLE.nikos, daysAgo: 15,
      body: `Agapite Niko,\n\nSymfonoume me tin pliromi se USDT. Tha stilei to posos entos 3 imeron.\n\nMe ektimisi,\nDimitris Konstantinou\nHellenic Trade`,
    },
    {
      from: PEOPLE.nikos, to: PEOPLE.dimitris, daysAgo: 12,
      body: `Agapite Dimitri,\n\nEpivevaiono oti to posos ton 61,000 USDT paralifthike sto crypto wallet. Efxaristoume gia tin synergasia.\n\nNikos`,
    },
  ],
});

// Thread 5 -- Turkish, invoice dispute + TRON wallet (header-linked)
financialThread({
  folder: 'Inbox/TR',
  subject: 'Fatura anlasmazligi ve odeme talebi',
  linkByHeaders: true,
  messagesSpec: [
    {
      from: PEOPLE.mehmet, to: PEOPLE.emre, daysAgo: 14,
      body: `Sayin Emre Bey,\n\nGecen ayki nakliye faturasinda tutarsizlik tespit ettik. Fatura numarasi: INV-55210.\nOdemeyi Tether (USDT) TRC20 ile yapmayi teklif ediyoruz:\nCuzdan adresi: ${fakeTron()}\nTutar: 18,750 USDT\n\nSaygilarimla,\nMehmet Yilmaz\nAnadolu Lojistik`,
      attachments: [PDF],
    },
    {
      from: PEOPLE.emre, to: PEOPLE.mehmet, daysAgo: 13,
      body: `Sayin Mehmet Bey,\n\nFaturayi inceledik, tutarsizlik dogru. Duzeltilmis tutar uzerinden USDT odemesi yapacagiz.\n\nSaygilarimla,\nEmre Sahin\nBogazici Finans`,
    },
    {
      from: PEOPLE.mehmet, to: PEOPLE.emre, daysAgo: 11,
      body: `Sayin Emre Bey,\n\nDuzeltilmis tutar: 18,750 USDT. Cuzdan adresini bir kez daha teyit ediyorum:\n${fakeTron()}\n\nTesekkurler,\nMehmet`,
    },
    {
      from: PEOPLE.emre, to: PEOPLE.mehmet, daysAgo: 9,
      body: `Sayin Mehmet Bey,\n\nOdeme gonderildi. Islem kaydini private key ile imzaladik, guvenlik icin detaylari ayri bir kanaldan iletecegiz.\n\nEmre`,
    },
    {
      from: PEOPLE.mehmet, to: PEOPLE.emre, daysAgo: 8,
      body: `Sayin Emre Bey,\n\nOdeme cuzdanimizda gorunuyor, tutar dogru. Anlasmazlik kapatilmistir.\n\nTesekkurler,\nMehmet Yilmaz`,
    },
  ],
});

// =========================================================================
// 2. Forwards -- realistic "---------- Forwarded message ---------" bodies,
//    Fwd: subject (normalizeSubject strips this, so these fallback-group
//    with their originals by subject+participant overlap even though the
//    forwarding envelope/participants differ), sent to a new recipient.
// =========================================================================

function forwardOf({ folder, originalSubject, originalFrom, originalTo, originalDate, originalBody, forwardFrom, forwardTo, forwardDaysAgo, note }) {
  const body =
    `${note}\n\n---------- Forwarded message ---------\n` +
    `From: ${originalFrom}\nDate: ${originalDate}\nSubject: ${originalSubject}\nTo: ${originalTo}\n\n${originalBody}`;
  const buf = buildPlainMessage({
    headers: {
      From: forwardFrom,
      To: forwardTo,
      Subject: `Fwd: ${originalSubject}`,
      Date: daysAgo(forwardDaysAgo),
      'Message-ID': nextMessageId('trading.example'),
    },
    body,
  });
  addMessage(folder, buf);
}

forwardOf({
  folder: 'Inbox/CN',
  originalSubject: '关于原油货款结算的安排',
  originalFrom: PEOPLE.liWei,
  originalTo: PEOPLE.chenQiang,
  originalDate: daysAgo(40),
  originalBody: `陈强先生，您好。\n\n关于上月装运的原油货款，我们建议通过 USDT (TRC20) 结算。\n钱包地址：${fakeTron()}\n应付金额：285,000 USDT`,
  forwardFrom: PEOPLE.zhangMin,
  forwardTo: PEOPLE.robert,
  forwardDaysAgo: 34,
  note: 'Robert, FYI - forwarding the settlement thread for your records. -- Zhang Min',
});

forwardOf({
  folder: 'Inbox/ES',
  originalSubject: 'Liquidacion de factura y transferencia bancaria',
  originalFrom: PEOPLE.carlos,
  originalTo: PEOPLE.javier,
  originalDate: daysAgo(30),
  originalBody: `Estimado Javier,\n\nAdjunto la factura. El importe total es de 42,300 EUR. Alternativa en Bitcoin:\n${fakeBtcLegacy()}`,
  forwardFrom: PEOPLE.laura,
  forwardTo: PEOPLE.robert,
  forwardDaysAgo: 24,
  note: 'Robert, te reenvio esta cadena para tu archivo. Saludos, Laura',
});

forwardOf({
  folder: 'Inbox/AR',
  originalSubject: 'ترتيبات تحويل الأموال عبر الحوالة',
  originalFrom: PEOPLE.yousef,
  originalTo: PEOPLE.khalid,
  originalDate: daysAgo(22),
  originalBody: `الأستاذ خالد المحترم،\n\nنقترح التحويل عبر الحوالة (hawala). المبلغ الإجمالي: 96,500 دولار`,
  forwardFrom: PEOPLE.sara,
  forwardTo: PEOPLE.robert,
  forwardDaysAgo: 17,
  note: 'Robert, forwarding for the file. -- Sara',
});

forwardOf({
  folder: 'Inbox/EL',
  originalSubject: 'Pliromi gia tin naylosi tou ploiou',
  originalFrom: PEOPLE.nikos,
  originalTo: PEOPLE.dimitris,
  originalDate: daysAgo(16),
  originalBody: `Agapite Dimitri,\n\nProtinoume pliromi se Tether (USDT). Diefthynsi: ${fakeTron()}\nPoso: 61,000 USDT`,
  forwardFrom: PEOPLE.eleni,
  forwardTo: PEOPLE.robert,
  forwardDaysAgo: 10,
  note: 'Robert, FYI forwarding this. -- Eleni',
});

forwardOf({
  folder: 'Inbox/TR',
  originalSubject: 'Fatura anlasmazligi ve odeme talebi',
  originalFrom: PEOPLE.mehmet,
  originalTo: PEOPLE.emre,
  originalDate: daysAgo(14),
  originalBody: `Sayin Emre Bey,\n\nOdemeyi Tether (USDT) TRC20 ile yapmayi teklif ediyoruz. Tutar: 18,750 USDT`,
  forwardFrom: PEOPLE.ayse,
  forwardTo: PEOPLE.robert,
  forwardDaysAgo: 6,
  note: 'Robert, forwarding for your records. -- Ayse',
});

// A second-generation forward (a forward of a forward) -- Robert relays to
// himself/archive, testing a 3-deep References-free fallback chain.
forwardOf({
  folder: 'Inbox/CN',
  originalSubject: '关于原油货款结算的安排',
  originalFrom: PEOPLE.zhangMin,
  originalTo: PEOPLE.robert,
  originalDate: daysAgo(34),
  originalBody: 'Robert, FYI - forwarding the settlement thread for your records.',
  forwardFrom: PEOPLE.robert,
  forwardTo: 'Archive <archive@globaltradepartners.com>',
  forwardDaysAgo: 33,
  note: 'Filing for compliance records.',
});

// =========================================================================
// 3. Junk / spam -- singletons, no threading headers, no financial
//    keyword/address hits (a couple of red-herring dollar amounts aside).
// =========================================================================

const JUNK = [
  { from: '"International Lottery Commission" <winner@luckydraw-intl.biz>', subject: 'CONGRATULATIONS!!! You have WON $2,500,000 USD',
    body: 'Dear Winner,\n\nYour email address has been selected in our international lottery draw. To claim your prize of $2,500,000 USD, please reply with your full name, address, and bank details immediately.\n\nInternational Lottery Commission' },
  { from: '"Account Security" <noreply@secure-bank-alerts.net>', subject: 'URGENT: Your account will be suspended in 24 hours',
    body: 'Dear Customer,\n\nWe detected unusual activity on your account. Click the link below and verify your login credentials within 24 hours or your account will be permanently suspended.\n\nSecure Bank Alerts Team' },
  { from: '"Daily Deals Market" <news@dailydeals-market.com>', subject: '70% OFF everything today only - dont miss out!',
    body: 'Hi there,\n\nOur biggest sale of the year is happening RIGHT NOW. Shoes, electronics, home goods - everything must go. Unsubscribe anytime.\n\nDaily Deals Market' },
  { from: '"Shipping Notification" <tracking@fastparcel-delivery.top>', subject: 'Your package could not be delivered - action required',
    body: 'Dear Customer,\n\nWe attempted to deliver your parcel but were unable to reach you. A redelivery fee of $2.99 is required. Click here to reschedule.\n\nFastParcel Delivery' },
  { from: '"HR Newsletter" <hr-updates@globaltradepartners.com>', subject: 'This month in HR: new dental plan, office potluck, and more',
    body: 'Hello everyone,\n\nA few updates this month: the new dental plan enrollment window opens next week, and dont forget the office potluck on Friday. Please sign up on the shared sheet.\n\nHR Team' },
  { from: '"Prince Adebayo" <prince.adebayo.estate@freemail-intl.biz>', subject: 'Business proposal - confidential',
    body: 'Dear Friend,\n\nI am the son of a deceased businessman with $18,000,000 USD held in a bank vault. I need your assistance to transfer these funds and will share 30% for your help. Please respond in confidence.\n\nRegards,\nPrince Adebayo' },
  { from: '"Webinar Invites" <events@marketing-growth-hub.com>', subject: 'Free webinar: 10x your sales with AI (limited seats)',
    body: 'Hi,\n\nJoin our free webinar this Thursday and learn the secrets top companies use to 10x their sales pipeline. Limited seats available, register now.\n\nMarketing Growth Hub' },
  { from: '"IT Support" <it-notice@globaltradepartners.com>', subject: 'Scheduled maintenance this weekend',
    body: 'Hello all,\n\nEmail and file servers will be offline for scheduled maintenance this Saturday from 10pm to 2am. Please save your work accordingly.\n\nIT Support' },
  { from: '"Recruiter" <talent@careersnow-network.com>', subject: 'Exciting opportunity - are you open to new roles?',
    body: 'Hi,\n\nI came across your profile and think you would be a great fit for a Senior role at a fast-growing company. Would you be open to a quick chat this week?\n\nBest,\nRecruiting Team' },
  { from: '"Office Manager" <facilities@globaltradepartners.com>', subject: 'Parking garage closed next Monday',
    body: 'Hi everyone,\n\nThe parking garage will be closed next Monday for resurfacing. Please use the street parking or the overflow lot two blocks north.\n\nFacilities' },
  { from: '"Certificate Authority Notice" <no-reply@ssl-renewals-center.net>', subject: 'Your SSL certificate expires soon - renew now',
    body: 'Dear Administrator,\n\nOur records show your SSL certificate is expiring soon. Renew now to avoid disruption to your website. Special discount available today only.\n\nSSL Renewals Center' },
  { from: '"Frequent Flyer Program" <miles@skyroute-rewards.info>', subject: 'You have 50,000 unclaimed miles - expiring soon!',
    body: 'Dear Member,\n\nYou have 50,000 unclaimed frequent flyer miles that will expire at the end of the month. Log in now to redeem them for flights, hotels, or gift cards.\n\nSkyRoute Rewards' },
  { from: '"Weekly Digest" <digest@industry-news-weekly.com>', subject: 'This week in shipping and logistics',
    body: 'Hello,\n\nHere is your weekly roundup of shipping and logistics news: port congestion easing in Asia, new fuel regulations proposed in the EU, and more.\n\nIndustry News Weekly' },
  { from: '"Extended Warranty Dept" <warranty@auto-protection-plus.top>', subject: 'Final notice: your vehicle warranty is about to expire',
    body: 'Dear Vehicle Owner,\n\nThis is your final notice. Your extended warranty coverage is about to expire. Call now to renew and avoid costly repair bills.\n\nAuto Protection Plus' },
  { from: '"Team Lunch" <office-social@globaltradepartners.com>', subject: 'Team lunch Friday - please RSVP',
    body: 'Hi team,\n\nWe are organizing a team lunch this Friday at 12:30 at the usual spot. Please RSVP by Wednesday so we can get a headcount.\n\nThanks!' },
  { from: '"Survey Team" <feedback@customer-voice-panel.com>', subject: 'Take our 2-minute survey and get a $50 gift card',
    body: 'Hi,\n\nWe value your opinion! Complete this short 2-minute survey and receive a $50 gift card as a thank-you. Offer valid while supplies last.\n\nCustomer Voice Panel' },
  { from: '"Conference Committee" <info@global-trade-summit-2026.com>', subject: 'Early bird registration ends Friday - Global Trade Summit 2026',
    body: 'Dear Colleague,\n\nEarly bird registration for the Global Trade Summit 2026 ends this Friday. Secure your seat now and save 40% off the standard rate.\n\nConference Committee' },
  { from: '"Domain Renewal Center" <billing@domain-renewals-service.biz>', subject: 'Domain expiration notice - renew today',
    body: 'Dear Domain Owner,\n\nOur records indicate your domain registration is expiring soon. Renew today to avoid losing your domain and any associated email accounts.\n\nDomain Renewals Service' },
];

JUNK.forEach((j, i) => {
  const buf = buildPlainMessage({
    headers: { From: j.from, To: 'undisclosed-recipients:;', Subject: j.subject, Date: daysAgo(2 + i), 'Message-ID': nextMessageId('mail.example') },
    body: j.body,
  });
  addMessage('Inbox/Junk', buf);
});

// =========================================================================
// 4. General, non-financial correspondence across all five languages plus
//    English -- fills the dataset out to 100 total. A mix of singletons and
//    small subject-fallback threads (no References headers, same pattern
//    real-world exports show).
// =========================================================================

const GENERAL = [
  // Chinese
  { lang: 'CN', from: PEOPLE.zhangMin, to: PEOPLE.chenQiang, subject: '下周会议安排', body: '陈强先生，您好。\n\n确认下周三上午十点的视频会议，讨论下季度的物流计划。请提前准备好港口清单。\n\n张敏' },
  { lang: 'CN', from: PEOPLE.chenQiang, to: PEOPLE.zhangMin, subject: 'Re: 下周会议安排', body: '张敏女士，收到，我方会准备好相关材料。另外请确认是否需要邀请仓储部门参加。\n\n陈强' },
  { lang: 'CN', from: PEOPLE.liWei, to: PEOPLE.zhangMin, subject: '春节假期安排通知', body: '各位同事：\n\n春节假期从下月初开始，共放假七天。请提前处理好未完成的订单，节后正常上班。\n\n人事部' },
  { lang: 'CN', from: PEOPLE.chenQiang, to: PEOPLE.liWei, subject: '集装箱延误说明', body: '李伟先生：\n\n由于港口拥堵，本批集装箱预计延误三天到达。请相应调整仓库接收计划，抱歉带来不便。\n\n陈强' },
  { lang: 'CN', from: PEOPLE.zhangMin, to: PEOPLE.liWei, subject: '新员工入职介绍', body: '李伟先生：\n\n下周一将有一位新同事入职，负责东南亚市场对接，届时请多多关照。\n\n张敏' },
  { lang: 'CN', from: PEOPLE.liWei, to: PEOPLE.chenQiang, subject: '样品寄送确认', body: '陈强先生：\n\n样品已经通过快递寄出，预计三个工作日送达，请留意查收。\n\n李伟' },
  { lang: 'CN', from: PEOPLE.chenQiang, to: PEOPLE.zhangMin, subject: '仓库盘点结果', body: '张敏女士：\n\n本季度仓库盘点已完成，整体库存与系统记录基本一致，仅有小幅差异，报告随后发送。\n\n陈强' },

  // Spanish
  { lang: 'ES', from: PEOPLE.laura, to: PEOPLE.javier, subject: 'Reunion de planificacion trimestral', body: 'Hola Javier,\n\nConfirmamos la reunion de planificacion trimestral para el proximo martes a las 10:00. Por favor trae el informe de rutas actualizado.\n\nLaura' },
  { lang: 'ES', from: PEOPLE.javier, to: PEOPLE.laura, subject: 'Re: Reunion de planificacion trimestral', body: 'Hola Laura,\n\nPerfecto, alli estare. Tambien invitare al equipo de almacen para que participen en la parte logistica.\n\nJavier' },
  { lang: 'ES', from: PEOPLE.carlos, to: PEOPLE.laura, subject: 'Vacaciones de verano - calendario del equipo', body: 'Hola Laura,\n\nAdjunto el calendario propuesto de vacaciones de verano para el equipo. Por favor revisalo y confirma tus fechas preferidas.\n\nCarlos' },
  { lang: 'ES', from: PEOPLE.javier, to: PEOPLE.carlos, subject: 'Retraso en el contenedor', body: 'Hola Carlos,\n\nEl contenedor se retrasara aproximadamente dos dias por congestion en el puerto. Disculpa las molestias, te mantendremos informado.\n\nJavier' },
  { lang: 'ES', from: PEOPLE.laura, to: PEOPLE.carlos, subject: 'Bienvenida al nuevo empleado', body: 'Hola Carlos,\n\nEl lunes se incorpora un nuevo companero al equipo comercial. Por favor dale la bienvenida cuando lo veas.\n\nLaura' },
  { lang: 'ES', from: PEOPLE.carlos, to: PEOPLE.javier, subject: 'Confirmacion de envio de muestras', body: 'Hola Javier,\n\nLas muestras fueron enviadas hoy por mensajeria. Deberian llegar en tres dias habiles.\n\nCarlos' },

  // Arabic
  { lang: 'AR', from: PEOPLE.sara, to: PEOPLE.khalid, subject: 'اجتماع التخطيط الأسبوعي', body: 'الأستاذ خالد،\n\nنؤكد موعد الاجتماع الأسبوعي يوم الثلاثاء الساعة العاشرة صباحاً لمناقشة خطة الشحن.\n\nسارة' },
  { lang: 'AR', from: PEOPLE.khalid, to: PEOPLE.sara, subject: 'رد: اجتماع التخطيط الأسبوعي', body: 'الأستاذة سارة،\n\nحسناً، سأحضر الاجتماع وسأقوم بإعداد التقرير المطلوب مسبقاً.\n\nخالد' },
  { lang: 'AR', from: PEOPLE.yousef, to: PEOPLE.sara, subject: 'تأخير الحاوية في الميناء', body: 'الأستاذة سارة،\n\nنعتذر عن تأخر وصول الحاوية بسبب الازدحام في الميناء. سيتم التحديث فور توفر معلومات جديدة.\n\nيوسف' },
  { lang: 'AR', from: PEOPLE.khalid, to: PEOPLE.yousef, subject: 'ترحيب بموظف جديد', body: 'الأستاذ يوسف،\n\nسينضم موظف جديد إلى الفريق يوم الاثنين القادم، نرجو الترحيب به عند وصوله.\n\nخالد' },
  { lang: 'AR', from: PEOPLE.sara, to: PEOPLE.yousef, subject: 'تأكيد إرسال العينات', body: 'الأستاذ يوسف،\n\nتم إرسال العينات المطلوبة عبر البريد السريع، ومن المتوقع وصولها خلال ثلاثة أيام عمل.\n\nسارة' },

  // Greek
  { lang: 'EL', from: PEOPLE.eleni, to: PEOPLE.dimitris, subject: 'Evdomadiaia synantisi sxediasmou', body: 'Agapite Dimitri,\n\nEpivevaionoume tin evdomadiaia synantisi tin Triti stis 10:00 gia to sxedio metaforon.\n\nEleni' },
  { lang: 'EL', from: PEOPLE.dimitris, to: PEOPLE.eleni, subject: 'Re: Evdomadiaia synantisi sxediasmou', body: 'Agapiti Eleni,\n\nEntaxei, tha eimai ekei kai tha etoimaso tin anafora pou zitisate.\n\nDimitris' },
  { lang: 'EL', from: PEOPLE.nikos, to: PEOPLE.eleni, subject: 'Kathysterisi container sto limani', body: 'Agapiti Eleni,\n\nTo container tha kathysterisei ligo logo symforisis sto limani. Tha enimeronoume gia neoteres exelixeis.\n\nNikos' },
  { lang: 'EL', from: PEOPLE.eleni, to: PEOPLE.nikos, subject: 'Kalosorisma neou synadelfou', body: 'Agapite Niko,\n\nTin Deftera erxete enas neos synadelfos sti symvasi. Parakalo na ton kalosorisete.\n\nEleni' },
  { lang: 'EL', from: PEOPLE.dimitris, to: PEOPLE.nikos, subject: 'Epivevaiosi apostolis deigmaton', body: 'Agapite Niko,\n\nTa deigmata stalthikan simera me tachumetaforiki. Anamenete na ftasoun se treis ergasimes imeres.\n\nDimitris' },

  // Turkish
  { lang: 'TR', from: PEOPLE.ayse, to: PEOPLE.emre, subject: 'Haftalik planlama toplantisi', body: 'Sayin Emre Bey,\n\nHaftalik planlama toplantisini Sali gunu saat 10:00 olarak onayliyoruz.\n\nAyse' },
  { lang: 'TR', from: PEOPLE.emre, to: PEOPLE.ayse, subject: 'Re: Haftalik planlama toplantisi', body: 'Sayin Ayse Hanim,\n\nTamamdir, toplantiya katilacagim ve istenen raporu hazirlayacagim.\n\nEmre' },
  { lang: 'TR', from: PEOPLE.mehmet, to: PEOPLE.ayse, subject: 'Konteyner gecikmesi hakkinda', body: 'Sayin Ayse Hanim,\n\nLiman yogunlugu nedeniyle konteynerimiz birkac gun gecikecek. Gelismeleri paylasmaya devam edecegiz.\n\nMehmet' },
  { lang: 'TR', from: PEOPLE.ayse, to: PEOPLE.mehmet, subject: 'Yeni calisan hosgeldin', body: 'Sayin Mehmet Bey,\n\nPazartesi gunu ekibimize yeni bir calisan katilacak, lutfen kendisini karsilayin.\n\nAyse' },
  { lang: 'TR', from: PEOPLE.emre, to: PEOPLE.mehmet, subject: 'Numune gonderimi onayi', body: 'Sayin Mehmet Bey,\n\nIstenen numuneler bugun kargo ile gonderildi, uc is gunu icinde ulasmasi bekleniyor.\n\nEmre' },

  // English (connective / internal correspondence at the intermediary)
  { lang: 'EN', from: PEOPLE.robert, to: PEOPLE.liWei, subject: 'Quarterly review call', body: `Hi Li Wei,\n\nCan we set up a quarterly review call next week to go over the settlement process and any open items? Let me know what works.\n\nBest,\nRobert` },
  { lang: 'EN', from: PEOPLE.robert, to: PEOPLE.carlos, subject: 'Re: Quarterly review call', body: `Hi Carlos,\n\nThanks for the update on the last shipment. Adding this to our records for the quarterly review.\n\nBest,\nRobert` },
  { lang: 'EN', from: PEOPLE.robert, to: PEOPLE.yousef, subject: 'Compliance documentation request', body: `Hi Yousef,\n\nCould you send over the compliance documentation for last month's transactions when you have a chance? No rush.\n\nThanks,\nRobert` },
  { lang: 'EN', from: PEOPLE.robert, to: PEOPLE.nikos, subject: 'Welcome note', body: `Hi Nikos,\n\nGreat working with you on the shipping arrangements. Looking forward to the next round.\n\nBest,\nRobert` },
  { lang: 'EN', from: PEOPLE.robert, to: PEOPLE.mehmet, subject: 'Invoice archive confirmation', body: `Hi Mehmet,\n\nConfirming the invoice records have been filed on our end for the quarter. Let me know if anything else is needed.\n\nBest,\nRobert`, attachments: [PNG] },
  { lang: 'EN', from: PEOPLE.robert, to: PEOPLE.zhangMin, subject: 'Great catching up', body: `Hi Zhang Min,\n\nGreat catching up on the call today. I'll circulate notes by end of week.\n\nBest,\nRobert` },
  { lang: 'EN', from: PEOPLE.robert, to: PEOPLE.laura, subject: 'Office site photo', body: `Hi Laura,\n\nAttaching a photo from the site visit last week, thought you'd want it for the file.\n\nBest,\nRobert`, attachments: [PNG2] },
];

GENERAL.forEach((g) => {
  const buf = g.attachments
    ? buildMultipartMessage({
        headers: { From: g.from, To: g.to, Subject: g.subject, Date: daysAgo(3 + Math.floor(Math.random() * 45)), 'Message-ID': nextMessageId('mail.example') },
        body: g.body,
        attachments: g.attachments,
      })
    : buildPlainMessage({
        headers: { From: g.from, To: g.to, Subject: g.subject, Date: daysAgo(3 + Math.floor(Math.random() * 45)), 'Message-ID': nextMessageId('mail.example') },
        body: g.body,
      });
  addMessage(`Inbox/${g.lang}`, buf);
});

// =========================================================================
// Pad up to exactly 100 with short filler correspondence (English,
// unthreaded) if the hand-composed content above landed under target.
// =========================================================================
const TARGET_TOTAL = 100;
const FILLER_TOPICS = [
  'Meeting notes attached',
  'Quick question about the schedule',
  'Following up on last week',
  'Document review needed',
  'Out of office next week',
  'Update on the project timeline',
  'Can we reschedule?',
  'Thanks for your help',
  'Draft for your review',
  'Checking in',
];
let fillerIndex = 0;
while (messages.length < TARGET_TOTAL) {
  const topic = FILLER_TOPICS[fillerIndex % FILLER_TOPICS.length];
  fillerIndex++;
  const buf = buildPlainMessage({
    headers: {
      From: PEOPLE.robert,
      To: 'Team <team@globaltradepartners.com>',
      Subject: `${topic} (${fillerIndex})`,
      Date: daysAgo(1 + fillerIndex),
      'Message-ID': nextMessageId('mail.example'),
    },
    body: `Hi team,\n\n${topic}. Let me know if you have questions.\n\nBest,\nRobert`,
  });
  addMessage('Inbox/EN', buf);
}

// Trim if hand-composed content overshot 100 (keeps the dataset exactly
// the requested size rather than silently drifting).
messages.length = Math.min(messages.length, TARGET_TOTAL);

// --- write the zip -------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const zip = new AdmZip();
for (const m of messages) zip.addFile(m.zipPath, m.content);
zip.writeZip(OUT_ZIP);

console.log(`Wrote ${messages.length} messages to ${OUT_ZIP}`);
