import mammoth from 'mammoth';

/**
 * Extracts plain text from a .docx file. Uses mammoth's dedicated raw-text
 * API (not its HTML-conversion API) since this pipeline wants text, not
 * markup.
 */
export async function extractDocx(savedPath) {
  const result = await mammoth.extractRawText({ path: savedPath });
  const warningCount = (result.messages || []).length;
  return {
    text: result.value,
    meta: warningCount > 0 ? { mammothWarningCount: warningCount } : null,
  };
}
