import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { appendEvent } from '../audit/audit-log.js';
import { classifyAttachment } from '../extract/index.js';
import { renderSafeJpeg } from '../extract/image-safe-render.js';

/**
 * Deletes every attachment's saved original file for the given
 * dataset(s) and nulls out savedPath, once extraction has already had
 * its one chance to read them (see src/extract/run-extraction.js --
 * extraction runs once per contentHash+kind group and writes
 * extractedText back to every row in that group, so nothing downstream
 * ever needs the original bytes again).
 *
 * Deliberately a separate step bolted on AFTER extraction, not a change
 * to extraction itself: electron/main.js's import handlers call this
 * once, right after their existing runExtraction() call. The investigator
 * confirmed directly (2026-11) that NO original attachment bytes should
 * ever persist in the workspace -- not even "safe" formats like docx/pdf,
 * since those can still carry macros/embedded scripts -- after their
 * partner's experience with Thunderbird raising virus alerts from opening
 * live email attachments directly. If an original is ever needed again,
 * it's recovered from the source archive, which this app never deletes.
 *
 * Image attachments are the one exception, confirmed directly (2026-11):
 * without SOME retained pixels, this app's AI-backed OCR has nothing to
 * ever translate -- the whole feature would be permanently unusable for
 * its actual real-world case (a scanned or photographed foreign-language
 * document), not just deferred. So for jpeg/png/bmp/tiff specifically,
 * this decodes the original fully to raw pixels and re-encodes it as a
 * fresh JPEG (src/extract/image-safe-render.js) BEFORE deleting anything
 * -- the output can't carry forward whatever made the original bytes
 * unsafe, since it's reconstructed from scratch, not copied. That
 * replacement is what gets kept; the original is still deleted. WebP (no
 * safe pure-JS decoder exists yet) and anything that fails to decode
 * fall through to the same delete-and-purge path as every other format.
 *
 * Returns { purged, rerendered } -- counts of attachments whose original
 * was deleted outright vs. replaced with a safe re-rendered copy.
 */
export async function purgeAttachmentOriginals(db, datasetIds) {
  if (!Array.isArray(datasetIds) || datasetIds.length === 0) return { purged: 0, rerendered: 0 };

  const rows = db
    .prepare(
      `SELECT a.id, a.savedPath, a.mimeType, a.filename
       FROM attachments a
       JOIN communications c ON c.id = a.communicationId
       WHERE c.datasetId IN (${datasetIds.map(() => '?').join(', ')})
         AND a.savedPath IS NOT NULL`
    )
    .all(...datasetIds);

  if (rows.length === 0) return { purged: 0, rerendered: 0 };

  const clearStmt = db.prepare('UPDATE attachments SET savedPath = NULL WHERE id = ?');
  const replaceStmt = db.prepare('UPDATE attachments SET savedPath = ?, mimeType = ?, size = ? WHERE id = ?');
  let purged = 0;
  let rerendered = 0;

  for (const row of rows) {
    let safeJpeg = null;
    if (classifyAttachment(row) === 'image') {
      try {
        const original = await readFile(row.savedPath);
        safeJpeg = renderSafeJpeg(original, row.mimeType);
      } catch {
        safeJpeg = null; // couldn't even read it -- falls through to the delete path below
      }
    }

    if (safeJpeg) {
      const newPath = path.join(path.dirname(row.savedPath), `${path.basename(row.savedPath, path.extname(row.savedPath))}.safe.jpg`);
      await writeFile(newPath, safeJpeg);
      if (newPath !== row.savedPath) {
        await unlink(row.savedPath).catch((err) => {
          if (err.code !== 'ENOENT') throw err;
        });
      }
      replaceStmt.run(newPath, 'image/jpeg', safeJpeg.length, row.id);
      rerendered++;
      continue;
    }

    try {
      await unlink(row.savedPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    clearStmt.run(row.id);
    purged++;
  }

  appendEvent(db, {
    eventType: 'attachment_originals_purged',
    subjectRef: datasetIds.join(','),
    payload: { datasetIds, purged, rerendered },
  });

  return { purged, rerendered };
}
