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
  elPlayer.addEventListener("loadedmetadata", syncMarkersHeight, { once: true });

  markers = Array.isArray(current.meta?.markers) ? current.meta.markers : [];
  elNotes.value = current.meta?.notes ?? "";
  lastActiveIdx = -1;

  renderMarkers();

  // Pre-render strip on load if markers exist
  if (markers.length > 0) {
    if (markers[0].t === 0) {
      updateNowPlaying(0);
    } else {
      renderPreparedState();
    }
  }
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

// --- Markers panel: height sync to video ---
const elMarkersScroll = document.getElementById("markers-scroll");
const elMarkersToggle = document.getElementById("markersToggle");
let markersCollapsed = false;

function syncMarkersHeight() {
  if (markersCollapsed) return;
  const videoHeight = elPlayer.getBoundingClientRect().height;
  if (videoHeight > 0) {
    elMarkersScroll.style.maxHeight = videoHeight + "px";
  }
}

const resizeObserver = new ResizeObserver(() => syncMarkersHeight());
resizeObserver.observe(elPlayer);
window.addEventListener("resize", syncMarkersHeight);

// --- Markers panel: collapse toggle ---
elMarkersToggle.addEventListener("click", () => {
  markersCollapsed = !markersCollapsed;
  elMarkersScroll.classList.toggle("collapsed", markersCollapsed);
  document.getElementById("markersHeader").classList.toggle("collapsed", markersCollapsed);
  elMarkersToggle.textContent = markersCollapsed ? "tracks" : "collapse";
  const panelW = markersCollapsed ? "0px" : "320px";
  const topbarW = markersCollapsed ? "80px" : "320px";
  const gap = markersCollapsed ? "0" : "";
  document.querySelector(".panel").style.setProperty("--markers-width", panelW);
  document.querySelector(".markers-topbar").style.setProperty("--markers-width", topbarW);
  document.querySelector(".panel").style.gap = gap;
  document.querySelector(".markers-topbar").style.gap = gap;
  if (!markersCollapsed) setTimeout(syncMarkersHeight, 260);
});

// --- Now playing strip + active marker highlight ---
const elNowPlayingStrip = document.getElementById("nowPlayingStrip");
const elNpPrev = document.getElementById("npPrev");
const elNpCurrent = document.getElementById("npCurrent");
const elNpNext = document.getElementById("npNext");
let lastActiveIdx = -1;

function getActiveMarkerIdx(currentTime) {
  if (!markers.length) return -1;
  let idx = -1;
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].t <= currentTime) idx = i;
    else break;
  }
  return idx;
}

function renderPreparedState() {
  // Show strip with first marker centered (full size, muted color), no left pill
  elNowPlayingStrip.classList.remove("hidden");
  elNpPrev.style.display = "none";
  elNpPrev.onclick = null;

  elNpCurrent.classList.add("np-current", "prepared");
  elNpCurrent.classList.remove("np-adjacent");
  elNpCurrent.textContent = `${fmtTime(markers[0].t)} ${markers[0].label}`;
  elNpCurrent.onclick = () => { elPlayer.currentTime = markers[0].t; elPlayer.play(); };

  const next = markers.length > 1 ? markers[1] : null;
  elNpNext.textContent = next ? `${fmtTime(next.t)} ${next.label}` : "";
  elNpNext.style.display = next ? "" : "none";
  elNpNext.onclick = next ? () => { elPlayer.currentTime = next.t; elPlayer.play(); } : null;
}

function updateNowPlaying(idx) {
  if (idx === lastActiveIdx) return;
  lastActiveIdx = idx;

  // Update active class on marker list items
  const markerEls = elMarkers.querySelectorAll(".marker");
  markerEls.forEach((el, i) => {
    el.classList.toggle("active", i === idx);
  });

  // idx -1 means before first marker — show prepared state if markers exist
  if (idx === -1) {
    if (markers.length > 0) {
      renderPreparedState();
    } else {
      elNowPlayingStrip.classList.add("hidden");
    }
    return;
  }

  elNowPlayingStrip.classList.remove("hidden");

  // Restore current pill styling in case pre-load prepared state changed it
  elNpCurrent.classList.add("np-current");
  elNpCurrent.classList.remove("np-adjacent", "prepared");

  const prev = idx > 0 ? markers[idx - 1] : null;
  const current = markers[idx];
  const next = idx < markers.length - 1 ? markers[idx + 1] : null;

  elNpPrev.textContent = prev ? `${fmtTime(prev.t)} ${prev.label}` : "";
  elNpPrev.style.display = prev ? "" : "none";
  elNpPrev.onclick = prev ? () => { elPlayer.currentTime = prev.t; elPlayer.play(); } : null;

  elNpCurrent.textContent = `${fmtTime(current.t)} ${current.label}`;
  elNpCurrent.onclick = () => { elPlayer.currentTime = current.t; elPlayer.play(); };

  elNpNext.textContent = next ? `${fmtTime(next.t)} ${next.label}` : "";
  elNpNext.style.display = next ? "" : "none";
  elNpNext.onclick = next ? () => { elPlayer.currentTime = next.t; elPlayer.play(); } : null;
}

elPlayer.addEventListener("timeupdate", () => {
  const idx = getActiveMarkerIdx(elPlayer.currentTime);
  updateNowPlaying(idx);
});

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