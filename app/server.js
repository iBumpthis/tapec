import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { openDb, upsertMedia } from "./db.js";

function loadConfig() {
  return JSON.parse(fs.readFileSync(new URL("./config.json", import.meta.url), "utf8"));
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
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT * FROM media WHERE id = ?`).get(id);
    if (!row) return reply.code(404).send({ error: "Not found" });

    const body = req.body ?? {};
    const markers = Array.isArray(body.markers) ? body.markers : [];

    const cleanMarkers = markers
      .map(m => ({ t: Number(m.t), label: String(m.label ?? "").trim() }))
      .filter(m => Number.isFinite(m.t) && m.t >= 0 && m.label.length > 0)
      .sort((a, b) => a.t - b.t);

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

    return reply.send({ ok: true });
  });

  // Stream endpoint
  app.get("/stream/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT * FROM media WHERE id = ?`).get(id);
    if (!row) return reply.code(404).send();

    if (!fs.existsSync(row.absPath)) return reply.code(404).send();
    return sendRangeStream(reply, row.absPath, mimeForExt(row.ext));
  });

  // Scan (so UI button works)
  app.post("/api/scan", async (req, reply) => {
    try {
      const result = runScan(cfg, db);
      return reply.send({ ok: true, ...result });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // Health
  app.get("/api/health", async () => ({ ok: true, name: "TapeC", version: "0.1.0" }));

  // Listen (must be after routes)
  await app.listen({ port: cfg.port, host: "0.0.0.0" });
}

await main().catch((err) => {
  console.error("[TapeC] Fatal:", err);
  process.exit(1);
});