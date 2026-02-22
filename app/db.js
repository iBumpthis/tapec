import Database from "better-sqlite3";

function ensureColumn(db, table, colName, colDefSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some(c => c.name === colName);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDefSql}`);
  }
}

export function openDb(dbPath) {
  const db = new Database(dbPath);

  // Recommended pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // -------------------------
  // MEDIA TABLE
  // -------------------------
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
  const mediaCols = db.prepare(`PRAGMA table_info(media)`).all();
  const hasLastSeen = mediaCols.some(c => c.name === "lastSeenScan");
  if (!hasLastSeen) {
    db.exec(`ALTER TABLE media ADD COLUMN lastSeenScan INTEGER NOT NULL DEFAULT 0`);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_seen ON media(lastSeenScan);`);

  // -------------------------
  // MARKERS TABLE (v0.2)
  // -------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mediaId INTEGER NOT NULL,
      startSeconds INTEGER NOT NULL,
      endSeconds INTEGER,                -- exclusive end (nullable)
      title TEXT NOT NULL,
      rawLine TEXT,                      -- original pasted line
      wasAdjusted INTEGER NOT NULL DEFAULT 0,
      adjustReason TEXT,
      createdAtMs INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(mediaId) REFERENCES media(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_markers_media ON markers(mediaId);
    CREATE INDEX IF NOT EXISTS idx_markers_time ON markers(mediaId, startSeconds);
  `);

  // Idempotent migrations (safe if table already existed)
  ensureColumn(db, "markers", "endSeconds", "INTEGER");
  ensureColumn(db, "markers", "rawLine", "TEXT");
  ensureColumn(db, "markers", "wasAdjusted", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "markers", "adjustReason", "TEXT");
  ensureColumn(db, "markers", "createdAtMs", "INTEGER NOT NULL DEFAULT 0");

  return db;
}

export function upsertMedia(db, row) {
  const stmt = db.prepare(`
    INSERT INTO media (
      libName, absPath, relPath, filename, ext,
      sizeBytes, mtimeMs, lastSeenScan
    )
    VALUES (
      @libName, @absPath, @relPath, @filename, @ext,
      @sizeBytes, @mtimeMs, @lastSeenScan
    )
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