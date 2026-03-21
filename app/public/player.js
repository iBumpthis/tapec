fetch("/api/health")
  .then(r => r.json())
  .then(d => console.log("TapeC player.js", d.version, new Date().toISOString()))
  .catch(() => console.log("TapeC player.js [version unknown]", new Date().toISOString()));

const params = new URLSearchParams(location.search);
const id = params.get("id");

const elTitle = document.getElementById("title");
const elSub = document.getElementById("sub");
const elPlayer = document.getElementById("player");
const elMarkers = document.getElementById("markers");
const elNotes = document.getElementById("notes");
const elMarkerText = document.getElementById("markerText");
const elImportMarkersBtn = document.getElementById("importMarkersBtn");
const elSaveBtn = document.getElementById("saveBtn");
const elSaveStatus = document.getElementById("saveStatus");

let markers = [];

// Parse display fields from filename convention: "{ARTIST} - {TRACK} ({YEAR}).ext"
// Returns { artist, title, year } — all fields optional/null if not parseable.
function parseFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  let year = null;
  const yearMatch = base.match(/\((\d{4})\)/);
  if (yearMatch) year = yearMatch[1];
  const stripped = base.replace(/\([^)]*\)/g, "").trim();
  const dashIdx = stripped.indexOf(" - ");
  if (dashIdx !== -1) {
    return {
      artist: stripped.slice(0, dashIdx).trim(),
      title: stripped.slice(dashIdx + 3).trim(),
      year
    };
  }
  return { artist: null, title: stripped || filename, year };
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseTimestampToSec(ts) {
  const parts = ts.trim().split(":").map(p => p.trim());
  if (parts.length === 2) {
    const [m, s] = parts.map(Number);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

function renderMarkers() {
  elMarkers.innerHTML = "";
  for (const mk of markers) {
    const div = document.createElement("div");
    div.className = "marker";
    div.innerHTML = `<strong>${fmtTime(mk.t)}</strong><span>${mk.label}</span>`;
    div.addEventListener("click", () => {
      elPlayer.currentTime = mk.t;
      elPlayer.play();
    });
    elMarkers.appendChild(div);
  }
}

function parseImport(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const m = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/.exec(line);
    if (!m) continue;
    const t = parseTimestampToSec(m[1]);
    if (t == null) continue;
    const label = m[2].trim();
    if (!label) continue;
    out.push({ t, label });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

async function load() {
  const res = await fetch(`/api/media/${encodeURIComponent(id)}`);
  const current = await res.json();
  if (!res.ok) {
    elTitle.textContent = "Not found";
    return;
  }

  const { artist, title, year } = parseFilename(current.filename);
  const yearPartTitle = year ? ` - ${year}` : "";
  elTitle.textContent = artist ? `${artist} - ${title}${yearPartTitle}` : title;
  const yearPart = year ? `${year} • ` : "";
  elSub.textContent = `${yearPart}${current.libName} • ${current.relPath}`;

  elPlayer.src = current.streamUrl;

  markers = Array.isArray(current.meta?.markers) ? current.meta.markers : [];
  elNotes.value = current.meta?.notes ?? "";

  renderMarkers();
}

async function save() {
  elSaveStatus.textContent = "Saving...";
  const payload = { notes: elNotes.value, markers };

  const res = await fetch(`/api/media/${encodeURIComponent(id)}/meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    elSaveStatus.textContent = data?.error ?? "Save failed";
    return;
  }

  elSaveStatus.textContent = "Saved ✅";
  setTimeout(() => (elSaveStatus.textContent = ""), 1500);
}

if (elImportMarkersBtn && elMarkerText) {
  elImportMarkersBtn.addEventListener("click", async () => {
    const markerText = (elMarkerText.value || "").trim();
    if (!markerText) {
      elSaveStatus.textContent = "Paste a tracklist first";
      return;
    }

    elSaveStatus.textContent = "Importing...";

    const res = await fetch(`/api/media/${encodeURIComponent(id)}/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markerText, notes: elNotes.value })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      elSaveStatus.textContent = data?.error ?? "Import failed";
      return;
    }

    const savedCount = data?.saved?.markerCount ?? null;
    const errCount = Array.isArray(data.importErrors) ? data.importErrors.length : 0;

    elSaveStatus.textContent =
      savedCount != null
        ? `Imported ${savedCount} marker(s)${errCount ? ` (skipped ${errCount})` : ""} ✅`
        : (errCount ? `Imported (skipped ${errCount}) ✅` : "Imported ✅");

    await load();
    setTimeout(() => (elSaveStatus.textContent = ""), 2000);
  });
}

if (elSaveBtn) elSaveBtn.addEventListener("click", save);

load();
// --- Browse overlay ---
const elBrowseBtn = document.getElementById("browseBtn");
document.getElementById("backBtn").addEventListener("click", () => {
  window.location.href = "/";
});
const elBrowseOverlay = document.getElementById("browseOverlay");
const elBrowseClose = document.getElementById("browseClose");
const elBrowseBackdrop = document.getElementById("browseBackdrop");
const elBrowseLib = document.getElementById("browseLib");
const elBrowseQ = document.getElementById("browseQ");
const elBrowseList = document.getElementById("browseList");

let browseLibraries = [];
let browseDebounce = null;

function openBrowse() {
  elBrowseOverlay.classList.remove("hidden");
  elBrowseQ.focus();
  if (browseLibraries.length === 0) loadBrowse();
}

function closeBrowse() {
  elBrowseOverlay.classList.add("hidden");
}

async function loadBrowse() {
  const lib = elBrowseLib.value || "";
  const q = elBrowseQ.value.trim();

  const url = new URL("/api/library", location.origin);
  if (lib) url.searchParams.set("lib", lib);
  if (q) url.searchParams.set("q", q);

  const res = await fetch(url);
  const data = await res.json();

  // Populate library selector once
  if (browseLibraries.length === 0) {
    browseLibraries = data.libraries ?? [];
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "All libraries";
    elBrowseLib.appendChild(optAll);
    for (const name of browseLibraries) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      elBrowseLib.appendChild(opt);
    }
  }

  elBrowseList.innerHTML = "";
  for (const it of data.items) {
    const { artist, title, year } = parseFilename(it.filename);
    const div = document.createElement("div");
    div.className = "browse-item" + (String(it.id) === String(id) ? " browse-item-current" : "");

    const label = document.createElement("div");
    label.className = "browse-item-title";
    label.textContent = artist ? `${artist} - ${title}` : title;

    const meta = document.createElement("div");
    meta.className = "small";
    const yearPart = year ? `${year} • ` : "";
    meta.textContent = `${yearPart}${it.libName} • ${it.ext.toUpperCase()}`;

    div.appendChild(label);
    div.appendChild(meta);

    div.addEventListener("click", () => {
      window.location.href = `/player.html?id=${encodeURIComponent(it.id)}`;
    });

    elBrowseList.appendChild(div);
  }
}

elBrowseBtn.addEventListener("click", openBrowse);
elBrowseClose.addEventListener("click", closeBrowse);
elBrowseBackdrop.addEventListener("click", closeBrowse);
elBrowseLib.addEventListener("change", loadBrowse);
elBrowseQ.addEventListener("input", () => {
  clearTimeout(browseDebounce);
  browseDebounce = setTimeout(loadBrowse, 250);
});