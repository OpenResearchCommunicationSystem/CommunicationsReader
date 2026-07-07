// Realistic mock data (shaped exactly like the real IPC responses) used
// only when running the renderer standalone in a browser via `vite dev`
// (no window.api / Electron preload present). Lets the UI be previewed
// and iterated on visually before wiring real IPC. Modeled on the actual
// structure/content seen from real test datasets during Milestones 1-4.

export const mockDatasets = [
  { id: 1, label: 'dataset_4', sourceType: 'email-eml', importedAt: Date.now() - 86400000, succeededCount: 8, failedCount: 0, totalCount: 8 },
  { id: 2, label: 'dataset_5', sourceType: 'email-eml', importedAt: Date.now() - 3600000, succeededCount: 8, failedCount: 0, totalCount: 8 },
];

const shippingMembers = [
  { communicationId: 2, datasetId: 1, timestamp: new Date('2021-03-15T02:00:00Z').getTime(), subject: 'Re: اجاره کشتی MV Golestan — محموله نفت خام فجیره' },
  { communicationId: 3, datasetId: 1, timestamp: new Date('2021-03-16T06:50:00Z').getTime(), subject: 'Re: اجاره کشتی MV Golestan — محموله نفت خام فجیره' },
  { communicationId: 6, datasetId: 1, timestamp: new Date('2021-03-18T03:15:00Z').getTime(), subject: 'Re: اجاره کشتی MV Golestan — محموله نفت خام فجیره' },
  { communicationId: 7, datasetId: 1, timestamp: new Date('2021-03-20T00:45:00Z').getTime(), subject: 'Re: اجاره کشتی MV Golestan — محموله نفت خام فجیره' },
  { communicationId: 8, datasetId: 1, timestamp: new Date('2021-03-22T08:30:00Z').getTime(), subject: 'Re: اجاره کشتی MV Golestan — محموله نفت خام فجیره' },
];

const sgsMembers = [
  { communicationId: 1, datasetId: 1, timestamp: new Date('2021-03-20T02:30:00Z').getTime(), subject: 'گواهی بازرسی SGS برای پمپ‌های KSB' },
  { communicationId: 4, datasetId: 1, timestamp: new Date('2021-03-21T06:30:00Z').getTime(), subject: 'Re: گواهی بازرسی SGS برای پمپ‌های KSB' },
  { communicationId: 5, datasetId: 1, timestamp: new Date('2021-03-25T01:30:00Z').getTime(), subject: 'Re: گواهی بازرسی SGS برای پمپ‌های KSB' },
];

export const mockThreads = [
  {
    threadId: 'thr_shipping',
    method: 'subject-fallback',
    subject: 'Re: اجاره کشتی MV Golestan — محموله نفت خام فجیره',
    participants: ['reza.hosseini@sepehrnaft.ir', 'davoud.bahrami@kavehmaritime.ir', 'saeed.jafari@kavehmaritime.ir', 'fatemeh.karimi@sepehrnaft.ir', 'hassan.golshani@aryanexchange.ir'],
    dateRange: { start: shippingMembers[0].timestamp, end: shippingMembers[shippingMembers.length - 1].timestamp },
    messageCount: shippingMembers.length,
    members: shippingMembers,
  },
  {
    threadId: 'thr_sgs',
    method: 'subject-fallback',
    subject: 'گواهی بازرسی SGS برای پمپ‌های KSB',
    participants: ['nader.shirazi@company.ir', 'zahra.moradi@company.ir'],
    dateRange: { start: sgsMembers[0].timestamp, end: sgsMembers[sgsMembers.length - 1].timestamp },
    messageCount: sgsMembers.length,
    members: sgsMembers,
  },
];

const mockCommunications = {
  1: {
    id: 1,
    datasetId: 1,
    subject: 'گواهی بازرسی SGS برای پمپ‌های KSB',
    fromRaw: 'nader.shirazi@company.ir',
    toRaw: 'zahra.moradi@company.ir',
    timestamp: sgsMembers[0].timestamp,
    bodyText:
      'زهرا خانم با سلام\nگواهی بازرسی SGS برای پمپ‌های KSB صادر شد:\n- شماره گواهی: SGS-IR-2021-04521\n- تاریخ بازرسی: ۲۸ اسفند ۱۳۹۹\n- نتیجه: تأیید — مطابق با مشخصات فنی سفارش\n\nگواهی اصلی به پیوست ارسال می‌شود',
    bodyEmpty: false,
    attachments: [
      { id: 1, filename: 'SGS_Inspection_Certificate_Alborz_Industrial.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 9616, extractionStatus: 'attempted_succeeded' },
    ],
  },
  2: {
    id: 2,
    datasetId: 1,
    subject: 'Re: اجاره کشتی MV Golestan — محموله نفت خام فجیره',
    fromRaw: 'reza.hosseini@sepehrnaft.ir',
    toRaw: 'davoud.bahrami@kavehmaritime.ir',
    timestamp: shippingMembers[0].timestamp,
    bodyText:
      'جناب آقای بهرامی با سلام و احترام\nبدینوسیله به اطلاع می‌رساند شرکت سپهر نفت تجارت نیازمند اجاره یک فروند نفتکش با ظرفیت حداقل ۷۰,۰۰۰ تن برای حمل محموله نفت خام از بندرعباس به بندر فجیره می‌باشد.',
    bodyEmpty: false,
    attachments: [],
  },
  7: {
    id: 7,
    datasetId: 1,
    subject: 'Re: اجاره کشتی MV Golestan — محموله نفت خام فجیره',
    fromRaw: 'saeed.jafari@kavehmaritime.ir',
    toRaw: 'reza.hosseini@sepehrnaft.ir, fatemeh.karimi@sepehrnaft.ir',
    timestamp: shippingMembers[3].timestamp,
    bodyText: 'با سلام به دستور آقای بهرامی، قرارداد اجاره سفری ... به پیوست ارسال می‌گردد.',
    bodyEmpty: false,
    attachments: [
      { id: 2, filename: 'VCP-KVMR-2021-001-charter-party.jpg', mimeType: 'image/jpeg', size: 23947, extractionStatus: 'attempted_succeeded' },
      { id: 3, filename: 'MV_Golestan_Charter_Details.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 7544, extractionStatus: 'attempted_succeeded' },
    ],
  },
};

export function mockGetCommunication(id) {
  return mockCommunications[id] || null;
}

export const mockCryptoMatches = [
  { id: 1, communicationId: 7, attachmentId: null, matchType: 'keyword', patternName: 'keyword_fa_exchange_house', matchedText: 'صرافی', sourceField: 'bodyText' },
];
