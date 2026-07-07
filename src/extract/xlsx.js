import ExcelJS from 'exceljs';

/**
 * Extracts a rough textual rendering of an .xlsx workbook: each sheet's
 * cells joined by tabs (preserving a rough tabular shape), sheets
 * separated by a labeled divider. Good enough for keyword/wallet-address
 * scanning, not meant to be a faithful spreadsheet rendering.
 */
export async function extractXlsx(savedPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(savedPath);

  const sheetNames = [];
  const blocks = [];

  workbook.eachSheet((worksheet) => {
    sheetNames.push(worksheet.name);
    const rows = [];
    worksheet.eachRow((row) => {
      const cellTexts = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = cell.text ?? '';
        if (text !== '') cellTexts.push(text);
      });
      if (cellTexts.length > 0) rows.push(cellTexts.join('\t'));
    });
    blocks.push(`--- Sheet: ${worksheet.name} ---\n${rows.join('\n')}`);
  });

  return {
    text: blocks.join('\n\n'),
    meta: { sheetNames },
  };
}
