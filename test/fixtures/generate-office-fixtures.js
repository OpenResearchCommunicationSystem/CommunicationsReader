import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';

// --- .docx ---------------------------------------------------------------
// Minimal valid OOXML package: [Content_Types].xml, _rels/.rels, and
// word/document.xml -- the three parts mammoth actually needs.
export function buildMinimalDocx(text = 'Hello test document') {
  const zip = new AdmZip();

  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
      'utf8'
    )
  );

  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
      'utf8'
    )
  );

  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
      'utf8'
    )
  );

  return zip.toBuffer();
}

// --- .xlsx -----------------------------------------------------------------
// Generated with exceljs itself (writer/reader round-trip) rather than
// hand-written OOXML spreadsheet XML, which has more required interlocking
// parts than docx/pptx (workbook.xml, worksheets, shared strings, rels).
export async function buildMinimalXlsx(cellValue = 'Hello test cell') {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.getCell('A1').value = cellValue;
  sheet.getCell('B1').value = 'Second column';
  return workbook.xlsx.writeBuffer();
}

// --- .pptx -------------------------------------------------------------
// Our own pptx.js reader only looks for ppt/slides/slideN.xml entries and
// regexes out <a:t> text runs -- it doesn't validate a full OOXML package,
// so the fixture only needs that one part to exist with the right shape,
// not a spec-complete PowerPoint file.
export function buildMinimalPptx(text = 'Hello test slide') {
  const zip = new AdmZip();
  zip.addFile(
    'ppt/slides/slide1.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`,
      'utf8'
    )
  );
  return zip.toBuffer();
}

// --- .pdf --------------------------------------------------------------
// Hand-written minimal PDF 1.4 skeleton (one page, one Helvetica text-
// showing content stream). pdf.js tolerates the simplified xref table.
// Verified empirically against pdfjs-dist before committing to this
// approach.
export function buildMinimalPdfWithText(text = 'Hello PDF text layer') {
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 100] /Contents 5 0 R >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const stream = `BT /F1 12 Tf 10 50 Td (${text}) Tj ET`;
  objs[5] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  return buildPdfFromObjects(objs);
}

/**
 * Same page/font/resources structure as buildMinimalPdfWithText, but with
 * an empty content stream -- simulates a scanned page with no text layer,
 * without needing a real embedded image.
 */
export function buildMinimalPdfNoTextLayer() {
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 100] /Contents 5 0 R >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objs[5] = `<< /Length 0 >>\nstream\n\nendstream`;
  return buildPdfFromObjects(objs);
}

function buildPdfFromObjects(objs) {
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i < objs.length; i++) {
    offsets.push(out.length);
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = out.length;
  const count = objs.length;
  out += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, 'binary');
}
