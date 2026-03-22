import fs from "node:fs";
import path from "node:path";
import { openDb, upsertMedia } from "./db.js";

function loadConfig() {
  return JSON.parse(
    fs.readFileSync(new URL("./config.json", import.meta.url), "utf8")
  );
}

export function walkDir(rootAbs, onFile) {
  const stack = [rootAbs];

  while (stack.length) {
    const cur = stack.pop();

    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const abs = path.join(cur, ent.name);

      if (ent.isDirectory()) {
        stack.push(abs);
      } else if (ent.isFile()) {
        onFile(abs);
      }
    }
  }
}

export function toRelPath(rootAbs, absPath) {
  return path.relative(rootAbs, absPath).split(path.sep).join("/");
}

function main() {
  const scanId = Date.now();
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);

  let totalUpserts = 0;
  let totalDeletes = 0;

  for (const lib of cfg.libraries) {
    const libRoot = lib.path;

    console.log(`[TapeC] Scanning: ${lib.name} -> ${libRoot}`);

    if (!fs.existsSync(libRoot)) {
      console.warn(
        `[TapeC] WARNING: Library path does not exist: ${libRoot}`
      );
      continue;
    }

    walkDir(libRoot, (absPath) => {
      const ext = path.extname(absPath).slice(1).toLowerCase();
      if (!cfg.allowedExtensions.includes(ext)) return;

      let st;
      try {
        st = fs.statSync(absPath);
      } catch {
        return;
      }

      upsertMedia(db, {
        libName: lib.name,
        absPath,
        relPath: toRelPath(libRoot, absPath),
        filename: path.basename(absPath),
        ext,
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
        lastSeenScan: scanId
      });

      totalUpserts++;
    });

    // Cleanup stale entries for this library
    const deleted = db.prepare(`
      DELETE FROM media
      WHERE libName = ?
        AND lastSeenScan != ?
    `).run(lib.name, scanId).changes;

    if (deleted > 0) {
      console.log(
        `[TapeC] Cleaned ${deleted} stale item(s) in library: ${lib.name}`
      );
    }

    totalDeletes += deleted;
  }

  console.log(
    `[TapeC] Scan complete. Upserts: ${totalUpserts}, Deleted: ${totalDeletes}`
  );
}

main();