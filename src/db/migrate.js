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
];

function ensureColumn(db, table, column, definition) {
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
