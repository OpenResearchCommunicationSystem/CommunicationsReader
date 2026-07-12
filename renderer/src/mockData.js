// Realistic mock data (shaped exactly like the real IPC responses) used
// only when running the renderer standalone in a browser via `vite dev`
// (no window.api / Electron preload present). Lets the UI be previewed
// and iterated on visually before wiring real IPC. Modeled on the actual
// structure/content seen from real test datasets during Milestones 1-4.
import { parseQuery, SearchSyntaxError } from '../../src/search/query-parser.js';
import { evaluateQuery } from '../../src/search/evaluate.js';

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
      {
        id: 1,
        filename: 'SGS_Inspection_Certificate_Alborz_Industrial.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 9616,
        contentHash: '9f8c1a2e6b3d4507c1a9e2f6b8d0c3a4e7f5b1029c8d6a4f3e2b1c0d9a8f7e6b',
        extractionStatus: 'attempted_succeeded',
        extractedText:
          'SGS INSPECTION CERTIFICATE\nCertificate No: SGS-IR-2021-04521\nClient: Alborz Industrial Group\nInspection Date: 2021-03-19\nScope: KSB pump units — hydrostatic test, dimensional check, material certs\nResult: PASS — conforms to purchase order technical specification',
      },
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
      {
        id: 2,
        filename: 'VCP-KVMR-2021-001-charter-party.jpg',
        mimeType: 'image/jpeg',
        size: 23947,
        extractionStatus: 'attempted_succeeded',
        extractedText:
          'VOYAGE CHARTER PARTY\nNo: VCP-KVMR-2021-001\nOwners: Kaveh Maritime\nCharterers: Sepehr Naft Tejarat\nVessel: MV Golestan\nCargo: Crude oil, approx. 70,000 MT\nLoad port: Bandar Abbas   Discharge port: Fujairah',
      },
      {
        id: 3,
        filename: 'MV_Golestan_Charter_Details.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 7544,
        extractionStatus: 'attempted_succeeded',
        extractedText:
          'Sheet: Charter Summary\nVessel | MV Golestan\nDWT | 74,200\nLaycan | 2021-03-22 / 2021-03-25\nFreight Rate | USD 2.85/bbl\nDemurrage | USD 18,000/day',
      },
    ],
  },
};

export function mockGetCommunication(id) {
  return mockCommunications[id] || null;
}

// Module-level so it behaves like a real backend's persisted focus set
// across calls within one preview session -- ordered by add time, same
// as the real focus_set_members table's addedAt ordering.
let mockFocusSetIds = [];

export function mockFocusAdd(communicationIds) {
  let added = 0;
  for (const id of communicationIds) {
    if (!mockFocusSetIds.includes(id)) {
      mockFocusSetIds.push(id);
      added++;
    }
  }
  return added;
}

export function mockFocusRemove(communicationIds) {
  const before = mockFocusSetIds.length;
  mockFocusSetIds = mockFocusSetIds.filter((id) => !communicationIds.includes(id));
  return before - mockFocusSetIds.length;
}

export function mockFocusClear() {
  const count = mockFocusSetIds.length;
  mockFocusSetIds = [];
  return count;
}

export function mockFocusList() {
  return mockFocusSetIds.map((id) => mockCommunications[id]).filter(Boolean);
}

export function mockFocusMaterialize() {
  // Count only ids with a real mock detail record, same as mockFocusList
  // -- the real backend can never have this mismatch (focus_set_members
  // has a foreign key against communications), but this fixture data
  // only fleshes out a few messages per thread.
  return {
    outputDir: '(preview mode -- nothing actually written to disk)',
    datasetCount: 1,
    communicationCount: mockFocusList().length,
    totalAttachmentReferences: 0,
    uniqueFiles: 0,
    duplicatesSaved: 0,
  };
}

export function mockFocusExportText() {
  return { filePath: '(preview mode -- nothing actually written to disk)', communicationCount: mockFocusList().length };
}

export function mockFindAttachmentsByHash(hash) {
  const results = [];
  for (const comm of Object.values(mockCommunications)) {
    for (const att of comm.attachments || []) {
      if (att.contentHash === hash) {
        results.push({
          attachmentId: att.id,
          filename: att.filename,
          communicationId: comm.id,
          subject: comm.subject,
          timestamp: comm.timestamp,
          datasetId: comm.datasetId,
        });
      }
    }
  }
  return results;
}

export const mockCryptoMatches = [
  { id: 1, communicationId: 7, attachmentId: null, matchType: 'keyword', patternName: 'keyword_fa_exchange_house', matchedText: 'صرافی', sourceField: 'bodyText' },
];

/**
 * Runs the real search engine (src/search/query-parser.js + evaluate.js
 * -- pure JS, no Node-only deps) against mockCommunications, so preview
 * mode exercises the exact same regex/NEAR/boolean-query behavior as the
 * real Electron IPC path, just over a small fixed dataset. datasetIds is
 * ignored here, consistent with the other mock*() functions in this file.
 */
export function mockRunSearch({ query } = {}) {
  if (!query || !query.trim()) return { resultCount: 0, results: [] };

  let ast;
  try {
    ast = parseQuery(query);
  } catch (err) {
    if (err instanceof SearchSyntaxError) return { resultCount: 0, results: [], error: err.message };
    throw err;
  }

  const results = [];
  for (const communication of Object.values(mockCommunications)) {
    const evaluated = evaluateQuery(ast, communication);
    if (evaluated) results.push({ communicationId: communication.id, hits: evaluated.hits });
  }
  return { resultCount: results.length, results };
}
