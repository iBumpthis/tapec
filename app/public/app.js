const elLib = document.getElementById("lib");
const elQ = document.getElementById("q");
const elExt = document.getElementById("ext");
const elRefresh = document.getElementById("refresh");
const elList = document.getElementById("list");
const elStatus = document.getElementById("status");
const elScan = document.getElementById("scan");

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

// Parse display fields from filename convention: "{ARTIST} - {TRACK} ({YEAR}).ext"
// Returns { artist, title, year } — all fields optional/null if not parseable.
// Falls back gracefully: if nothing matches, title = stripped filename.
function parseFilename(filename) {
  // Strip extension
  const base = filename.replace(/\.[^.]+$/, "");

  // Pull year from last parenthesised 4-digit number, ignoring (WR) and similar
  let year = null;
  const yearMatch = base.match(/\((\d{4})\)/);
  if (yearMatch) year = yearMatch[1];

  // Strip all parenthesised segments to clean up title/artist split
  const stripped = base.replace(/\([^)]*\)/g, "").trim();

  // Split on first " - " to get artist / track
  const dashIdx = stripped.indexOf(" - ");
  if (dashIdx !== -1) {
    return {
      artist: stripped.slice(0, dashIdx).trim(),
      title: stripped.slice(dashIdx + 3).trim(),
      year
    };
  }

  // No " - " found — use whole stripped string as title
  return { artist: null, title: stripped || filename, year };
}

async function loadLibrary() {
  elStatus.textContent = "Loading...";
  const lib = elLib.value || "";
  const q = elQ.value.trim();
  const ext = elExt.value || "";

  const url = new URL("/api/library", location.origin);
  if (lib) url.searchParams.set("lib", lib);
  if (q) url.searchParams.set("q", q);
  if (ext) url.searchParams.set("ext", ext);

  const res = await fetch(url);
  const data = await res.json();

  if (elLib.options.length === 0) {
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "All libraries";
    elLib.appendChild(optAll);

    for (const name of data.libraries) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      elLib.appendChild(opt);
    }
  }

  elList.innerHTML = "";
  for (const it of data.items) {
    const { artist, title, year } = parseFilename(it.filename);

    const row = document.createElement("div");
    row.className = "item";

    const left = document.createElement("div");
    const a = document.createElement("a");
    a.href = `/player.html?id=${encodeURIComponent(it.id)}`;

    // Primary display: "Artist - Title" or just "Title" if no artist parsed
    a.textContent = artist ? `${artist} - ${title}` : title;
    left.appendChild(a);

    // Sub-line: library • ext • size • year (if present)
    const meta = document.createElement("div");
    meta.className = "small";
    const yearPart = year ? `${year} • ` : "";
    meta.textContent = `${yearPart}${fmtBytes(it.sizeBytes)} • ${it.libName} • ${it.ext.toUpperCase()}`;
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "small";
    right.textContent = new Date(it.mtimeMs).toLocaleString();

    row.appendChild(left);
    row.appendChild(right);
    elList.appendChild(row);
  }

  elStatus.textContent = `${data.items.length} item(s)`;
}

elRefresh.addEventListener("click", loadLibrary);
elLib.addEventListener("change", loadLibrary);
elExt.addEventListener("change", loadLibrary);
elQ.addEventListener("input", () => {
  clearTimeout(window.__t);
  window.__t = setTimeout(loadLibrary, 250);
});

elScan.addEventListener("click", async () => {
  elStatus.textContent = "Scanning...";
  const res = await fetch("/api/scan", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    elStatus.textContent = data?.error ?? "Scan failed";
    return;
  }
  await loadLibrary();
});

loadLibrary();