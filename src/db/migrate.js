// Additive-only schema migrations (new columns only -- SQLite's ALTER
// TABLE can't drop/rename/retype a column). schema.js's CREATE TABLE IF
// NOT EXISTS already has every current column for a brand-new DB; this
// exists for a DB created by an older version of this app that may
// already hold real investigator data (the M5 packaged .exe is already
// deployed) and won't get new columns from CREATE TABLE alone. Each entry
// is PRAGMA table_info-guarded, so runMigrations() is a safe no-op once a
// DB has already been migrated, and a safe no-op on a fresh DB whose
// CREATE TABLE already defines the column.
const COLUMN_MIGRATIONS = [
  { table: 'attachments', column: 'contentHash', definition: 'TEXT' },
  { table: 'attachments', column: 'quarantineStatus', definition: "TEXT NOT NULL DEFAULT 'pending'" },
  { table: 'attachments', column: 'quarantineReason', definition: 'TEXT' },
  { table: 'communications', column: 'threadMethod', definition: 'TEXT' },
  { table: 'communications', column: 'translatedText', definition: 'TEXT' },
  { table: 'communications', column: 'translatedLang', definition: 'TEXT' },
  { table: 'communications', column: 'translatedAt', definition: 'INTEGER' },
  { table: 'communications', column: 'translationMeta', definition: 'TEXT' },
  { table: 'attachments', column: 'translatedText', definition: 'TEXT' },
  { table: 'attachments', column: 'translatedLang', definition: 'TEXT' },
  { table: 'attachments', column: 'translatedAt', definition: 'INTEGER' },
  { table: 'attachments', column: 'translationMeta', definition: 'TEXT' },
];

function tableExists(db, table) {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined;
}

function ensureColumn(db, table, column, definition) {
  // Guard against the target table not existing at all -- real usage
  // always calls runMigrations() after TABLES_SQL has created every
  // table, but a test exercising one migration in isolation against a
  // deliberately minimal fixture (only the one table under test) is a
  // legitimate scenario too. Nothing to migrate on a table that doesn't
  // exist yet; CREATE TABLE will define the column fully whenever the
  // table is eventually created.
  if (!tableExists(db, table)) return;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Applies all known additive column migrations. Call once, right after
 * CREATE TABLE IF NOT EXISTS, from openDatabase().
 */
export function runMigrations(db) {
  for (const { table, column, definition } of COLUMN_MIGRATIONS) {
    ensureColumn(db, table, column, definition);
  }
}
