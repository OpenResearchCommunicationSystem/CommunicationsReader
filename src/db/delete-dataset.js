import { rm } from 'node:fs/promises';

/**
 * Deletes a dataset and everything derived from it. communications,
 * participants, attachments, and crypto_matches all cascade-delete via
 * ON DELETE CASCADE foreign keys (foreign_keys is ON, see schema.js) --
 * deleting the one datasets row is enough at the database level. Also
 * removes the on-disk attachments directory for this dataset, since
 * deleting DB rows doesn't touch files already extracted to disk.
 *
 * Returns { deleted: boolean } -- false if no dataset with that id exists.
 */
export async function deleteDataset(db, datasetId) {
  const row = db.prepare('SELECT attachmentsDir FROM datasets WHERE id = ?').get(datasetId);
  if (!row) return { deleted: false };

  db.prepare('DELETE FROM datasets WHERE id = ?').run(datasetId);

  if (row.attachmentsDir) {
    await rm(row.attachmentsDir, { recursive: true, force: true });
  }

  return { deleted: true };
}
