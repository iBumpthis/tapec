import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { openDb, upsertMedia } from "./db.js";

function loadConfig() {
  const defaultConfig = {
    libraries: [],
    dbPath: "C:\\TapeC\\tapec.sqlite",
    host: "0.0.0.0",
    port: 32410,
    allowedExtensions: ["mp3", "mp4", "m4a", "wav"]
  };

  let fileConfig = {};

  try {
    fileConfig = JSON.parse(
      fs.readFileSync(new URL("./config.json", import.meta.url), "utf8")
    );
  } catch (err) {
    console.warn("config.json not found or invalid, using defaults.");
  }

  return {
    ...defaultConfig,
    ...fileConfig,
    host: process.env.TAPEC_HOST ?? fileConfig.host ?? defaultConfig.host,
    port: Number(process.env.TAPEC_PORT ?? fileConfig.port ?? defaultConfig.port),
    dbPath: process.env.TAPEC_DB_PATH ?? fileConfig.dbPath ?? defaultConfig.dbPath
  };
}

function metaPathForMedia(absPath) {
  return `${absPath}.meta.json`;
}

function readMeta(absPath) {
  const mp = metaPathForMedia(absPath);
  if (!fs.existsSync(mp)) return { markers: [], notes: "" };
  try {
    const j = JSON.parse(fs.readFileSync(mp, "utf8"));
    if (!j || typeof j !== "object") return { markers: [], notes: "" };
    if (!Array.isArray(j.markers)) j.markers = [];
    if (typeof j.notes !== "string") j.notes = "";
    return j;
  } catch {
    return { markers: [], notes: "" };
  }
}

function writeMeta(absPath, metaObj) {
  const mp = metaPathForMedia(absPath);
  const clean = {
    title: metaObj.title ?? undefined,
    creator: metaObj.creator ?? undefined,
    notes: typeof metaObj.notes === "string" ? metaObj.notes : "",
    markers: Array.isArray(metaObj.markers) ? metaObj.markers : []
  };
  fs.writeFileSync(mp, JSON.stringify(clean, null, 2), "utf8");
}

function mimeForExt(ext) {
  switch (ext) {
    case "mp3": return "audio/mpeg";
    case "m4a": return "audio/mp4";
    case "wav": return "audio/wav";
    case "mp4": return "video/mp4";
    default: return "application/octet-stream";
  }
}

// Basic HTTP Range support for seeking
function sendRangeStream(reply, absPath, mime) {
  const stat = fs.statSync(absPath);
  const total = stat.size;
  const range = reply.request.headers.range;

  reply.header("Accept-Ranges", "bytes");

  if (!range) {
    reply
      .code(200)
      .header("Content-Length", total)
      .header("Content-Type", mime);
    return reply.send(fs.createReadStream(absPath));
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return reply.code(416).send();

  const start = Number(match[1]);
  const end = match[2]
    ? Number(match[2])
    : Math.min(start + 4 * 1024 * 1024 - 1, total - 1); // 4MB default

  if (!Number.isFinite(start) || start >= total) {
    reply.code(416).header("Content-Range", `bytes */${total}`);
    return reply.send();
  }

  const safeEnd = Math.min(end, total - 1);
  const chunkSize = safeEnd - start + 1;

  reply
    .code(206)
    .header("Content-Range", `bytes ${start}-${safeEnd}/${total}`)
    .header("Content-Length", chunkSize)
    .header("Content-Type", mime);

  return reply.send(fs.createReadStream(absPath, { start, end: safeEnd }));
}

function walkDir(rootAbs, onFile) {
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
      if (ent.isDirectory()) stack.push(abs);
      else if (ent.isFile()) onFile(abs);
    }
  }
}

function toRelPath(rootAbs, absPath) {
  return path.relative(rootAbs, absPath).split(path.sep).join("/");
}

function normalizeDashes(s) {
  return s.replace(/[–—]/g, "-");
}

function parseTimeToSeconds(t) {
  const parts = t.split(":").map(n => Number(n));
  if (parts.some(n => !Number.isFinite(n))) return null;

  if (parts.length === 2) {
    const [m, s] = parts;
    if (s < 0 || s > 59 || m < 0) return null;
    return m * 60 + s;
  }

  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (s < 0 || s > 59 || m < 0 || m > 59 || h < 0) return null;
    return h * 3600 + m * 60 + s;
  }

  return null;
}

const TIME_RE = `(\\d{1,3}:\\d{2}(?::\\d{2})?)`;

function cleanTitle(s) {
  return s.replace(/^\s*[-|]+\s*/, "").replace(/\s*[-|]+\s*$/, "").trim();
}

function parseMarkerLine(line) {
  const rawLine = line;
  let s = normalizeDashes(String(line ?? "")).trim();
  if (!s) return null;

  // 1) Bracket/paren range anywhere: Title [00:00-00:40]  OR  Title (00:00-00:40)
  {
    const re = new RegExp(`^(.*?)[\\[(]\\s*${TIME_RE}\\s*-\\s*${TIME_RE}\\s*[\\])](.*)$`);
    const m = s.match(re);
    if (m) {
      const start = parseTimeToSeconds(m[2]);
      const end = parseTimeToSeconds(m[3]);
      if (start == null || end == null || end < start) return null;
      const title = cleanTitle(`${m[1]} ${m[4]}`);
      return { startSeconds: start, endSeconds: end, title: title || `Track @ ${m[2]}`, rawLine };
    }
  }

  // 2) Range-first: 00:00-00:40 Intro
  {
    const re = new RegExp(`^${TIME_RE}\\s*-\\s*${TIME_RE}\\s*(.+)$`);
    const m = s.match(re);
    if (m) {
      const start = parseTimeToSeconds(m[1]);
      const end = parseTimeToSeconds(m[2]);
      if (start == null || end == null || end < start) return null;
      const title = cleanTitle(m[3]);
      return { startSeconds: start, endSeconds: end, title: title || `Track @ ${m[1]}`, rawLine };
    }
  }

  // 3) Range-last: Intro 00:00-00:40
  {
    const re = new RegExp(`^(.*?)\\s+${TIME_RE}\\s*-\\s*${TIME_RE}\\s*$`);
    const m = s.match(re);
    if (m) {
      const start = parseTimeToSeconds(m[2]);
      const end = parseTimeToSeconds(m[3]);
      if (start == null || end == null || end < start) return null;
      const title = cleanTitle(m[1]);
      return { startSeconds: start, endSeconds: end, title: title || `Track @ ${m[2]}`, rawLine };
    }
  }

  // 4) Time-first: 0:00 Intro  OR  0:00 - Intro
  {
    const re = new RegExp(`^${TIME_RE}\\s*(?:-\\s*)?(.+)$`);
    const m = s.match(re);
    if (m) {
      const start = parseTimeToSeconds(m[1]);
      if (start == null) return null;
      const title = cleanTitle(m[2]);
      return { startSeconds: start, endSeconds: null, title: title || `Track @ ${m[1]}`, rawLine };
    }
  }

  // 5) Time-last: Intro 0:00  OR  Intro - 0:00
  {
    const re = new RegExp(`^(.+?)(?:\\s*-)?\\s*${TIME_RE}\\s*$`);
    const m = s.match(re);
    if (m) {
      const start = parseTimeToSeconds(m[2]);
      if (start == null) return null;
      const title = cleanTitle(m[1]);
      return { startSeconds: start, endSeconds: null, title: title || `Track @ ${m[2]}`, rawLine };
    }
  }

  return null;
}

function parseMarkerBlock(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const parsed = [];
  const errors = [];

  lines.forEach((line, idx) => {
    const t = line.trim();
    if (!t) return;
    const m = parseMarkerLine(t);
    if (m) parsed.push({ ...m, _i: idx });
    else errors.push({ line: idx + 1, text: t });
  });

  // Sort by start time; preserve original order for ties
  parsed.sort((a, b) => (a.startSeconds - b.startSeconds) || (a._i - b._i));

  // Overlap repair only when previous has an explicit endSeconds
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const cur = parsed[i];
    if (prev.endSeconds != null && cur.startSeconds < prev.endSeconds) {
      cur.wasAdjusted = 1;
      cur.adjustReason = "overlap: shifted to previous end";
      cur.startSeconds = prev.endSeconds;
    }
  }

  // Strip helper field
  parsed.forEach(p => delete p._i);

  return { parsed, errors };
}

function runScan(cfg, db) {
  const scanId = Date.now();
  let totalUpserts = 0;
  let totalDeletes = 0;

  for (const lib of cfg.libraries) {
    const libRoot = lib.path;
    if (!fs.existsSync(libRoot)) continue;

    walkDir(libRoot, (absPath) => {
      const ext = path.extname(absPath).slice(1).toLowerCase();
      if (!cfg.allowedExtensions.includes(ext)) return;

      let st;
      try { st = fs.statSync(absPath); } catch { return; }

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

    const deleted = db.prepare(`
      DELETE FROM media
      WHERE libName = ?
        AND lastSeenScan != ?
    `).run(lib.name, scanId).changes;

    totalDeletes += deleted;
  }

  return { scanId, totalUpserts, totalDeletes };
}

async function main() {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);

  const app = Fastify({ logger: true });

  // Serve UI from ./public
  const publicRoot = path.resolve(process.cwd(), "public");
  app.register(fastifyStatic, { root: publicRoot, prefix: "/" });

  // Library listing
  app.get("/api/library", async (req, reply) => {
    const libName = (req.query.lib ?? "").toString();
    const q = (req.query.q ?? "").toString().trim();
    const ext = (req.query.ext ?? "").toString().trim().toLowerCase();

    const rows = db.prepare(`
      SELECT id, libName, relPath, filename, ext, sizeBytes, mtimeMs
      FROM media
      WHERE (? = '' OR libName = ?)
        AND (? = '' OR filename LIKE '%' || ? || '%')
        AND (? = '' OR ext = ?)
      ORDER BY mtimeMs DESC
      LIMIT 2000
    `).all(libName, libName, q, q, ext, ext);

    return reply.send({
      libraries: cfg.libraries.map(l => l.name),
      items: rows
    });
  });

  // Media details + markers
  app.get("/api/media/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT * FROM media WHERE id = ?`).get(id);
    if (!row) return reply.code(404).send({ error: "Not found" });

    const meta = readMeta(row.absPath);

    return reply.send({
      id: row.id,
      libName: row.libName,
      relPath: row.relPath,
      filename: row.filename,
      ext: row.ext,
      sizeBytes: row.sizeBytes,
      mtimeMs: row.mtimeMs,
      streamUrl: `/stream/${row.id}`,
      meta
    });
  });

  // Save meta sidecar
  app.post("/api/media/:id/meta", async (req, reply) => {
        const body = req.body ?? {};

    // v0.2: accept either structured markers[] OR markerText paste block
    let incomingMarkers = [];
    let importErrors = [];

    if (typeof body.markerText === "string" && body.markerText.trim().length > 0) {
      const { parsed, errors } = parseMarkerBlock(body.markerText);
      importErrors = errors;

      incomingMarkers = parsed.map(m => ({
        t: m.startSeconds,
        label: m.title,
        endSeconds: m.endSeconds ?? null,
        rawLine: m.rawLine,
        wasAdjusted: m.wasAdjusted ?? 0,
        adjustReason: m.adjustReason ?? null
      }));
    } else {
      const markers = Array.isArray(body.markers) ? body.markers : [];
      incomingMarkers = markers
        .map(m => ({ t: Number(m.t), label: String(m.label ?? "").trim() }))
        .filter(m => Number.isFinite(m.t) && m.t >= 0 && m.label.length > 0)
        .sort((a, b) => a.t - b.t)
        .map(m => ({ ...m, endSeconds: null, rawLine: null, wasAdjusted: 0, adjustReason: null }));
    }

    // Clean markers for sidecar (existing behavior)
    const cleanMarkers = incomingMarkers
      .map(m => ({ t: Number(m.t), label: String(m.label ?? "").trim() }))
      .filter(m => Number.isFinite(m.t) && m.t >= 0 && m.label.length > 0)
      .sort((a, b) => a.t - b.t);

    // Write sidecar (keeps existing UI working)
    try {
      writeMeta(row.absPath, {
        title: body.title ?? undefined,
        creator: body.creator ?? undefined,
        notes: typeof body.notes === "string" ? body.notes : "",
        markers: cleanMarkers
      });
    } catch (e) {
      return reply.code(500).send({ error: `Failed to write meta: ${e.message}` });
    }

    // Write to SQLite markers table (v0.2)
    try {
      const del = db.prepare(`DELETE FROM markers WHERE mediaId = ?`);
      const ins = db.prepare(`
        INSERT INTO markers (mediaId, startSeconds, endSeconds, title, rawLine, wasAdjusted, adjustReason, createdAtMs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const tx = db.transaction((mediaId, list) => {
        del.run(mediaId);
        const now = Date.now();
        for (const m of list) {
          ins.run(
            mediaId,
            Number(m.t),
            m.endSeconds == null ? null : Number(m.endSeconds),
            String(m.label),
            m.rawLine == null ? null : String(m.rawLine),
            m.wasAdjusted ? 1 : 0,
            m.adjustReason == null ? null : String(m.adjustReason),
            now
          );
        }
      });

      tx(row.id, incomingMarkers);
    } catch (e) {
      return reply.code(500).send({ error: `Failed to write markers to DB: ${e.message}` });
    }

    return reply.send({ ok: true, importErrors });
    }
  });

  // Health
app.get("/api/health", async () => ({ ok: true, name: "TapeC", version: "0.2.0-dev" }));

  // Listen (must be after routes)
await app.listen({ port: cfg.port, host: cfg.host });
}

await main().catch((err) => {
  console.error("[TapeC] Fatal:", err);
  process.exit(1);
});