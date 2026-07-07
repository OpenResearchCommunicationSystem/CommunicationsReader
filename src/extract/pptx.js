import AdmZip from 'adm-zip';

// No actively-maintained, widely-adopted npm package exists for .pptx text
// extraction (confirmed by checking npm's registry for maintenance
// signals before writing this). A .pptx is just a ZIP of XML slide parts,
// and the only thing this pipeline needs is the visible text runs, so --
// consistent with this project's precedent of hand-rolling narrow parsers
// when no trustworthy library exists (see src/parser/mbox-split.js,
// src/parser/mime-raw-part.js) -- this is a small regex-based extractor,
// not a spec-complete OOXML reader. It does not handle grouped-shape
// traversal order, tables, or embedded charts beyond plain text runs.

const TEXT_RUN_RE = /<a:t>([\s\S]*?)<\/a:t>/g;

function unescapeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function slideNumber(entryName) {
  const match = entryName.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function extractPptx(savedPath) {
  const zip = new AdmZip(savedPath);
  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => slideNumber(a.entryName) - slideNumber(b.entryName));

  const slideTexts = slideEntries.map((entry) => {
    const xml = entry.getData().toString('utf8');
    const runs = [];
    let m;
    TEXT_RUN_RE.lastIndex = 0;
    while ((m = TEXT_RUN_RE.exec(xml)) !== null) {
      runs.push(unescapeXmlEntities(m[1]));
    }
    return runs.join('\n');
  });

  return {
    text: slideTexts.join('\n\n---\n\n'),
    meta: { slideCount: slideEntries.length },
  };
}
