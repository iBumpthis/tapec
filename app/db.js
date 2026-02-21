import Database from "better-sqlite3";

function ensureColumn(db, table, colName, colDefSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some(c => c.name === colName);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDefSql}`);
}

export function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      libName TEXT NOT NULL,
      absPath TEXT NOT NULL UNIQUE,
      relPath TEXT NOT NULL,
      filename TEXT NOT NULL,
      ext TEXT NOT NULL,
      sizeBytes INTEGER NOT NULL,
      mtimeMs INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_media_lib ON media(libName);
    CREATE INDEX IF NOT EXISTS idx_media_rel ON media(relPath);
  `);

  // Migration: add lastSeenScan if missing
  const cols = db.prepare(`PRAGMA table_info(media)`).all();
  const hasLastSeen = cols.some(c => c.name === "lastSeenScan");
  if (!hasLastSeen) {
    db.exec(`ALTER TABLE media ADD COLUMN lastSeenScan INTEGER NOT NULL DEFAULT 0`);
  }

  // Now safe to create index on it
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_seen ON media(lastSeenScan);`);

  return db;
}

export function upsertMedia(db, row) {
  const stmt = db.prepare(`
    INSERT INTO media (libName, absPath, relPath, filename, ext, sizeBytes, mtimeMs, lastSeenScan)
    VALUES (@libName, @absPath, @relPath, @filename, @ext, @sizeBytes, @mtimeMs, @lastSeenScan)
    ON CONFLICT(absPath) DO UPDATE SET
      libName=excluded.libName,
      relPath=excluded.relPath,
      filename=excluded.filename,
      ext=excluded.ext,
      sizeBytes=excluded.sizeBytes,
      mtimeMs=excluded.mtimeMs,
      lastSeenScan=excluded.lastSeenScan
  `);
  stmt.run(row);
}