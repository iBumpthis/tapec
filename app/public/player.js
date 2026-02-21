const params = new URLSearchParams(location.search);
const id = params.get("id");

const elTitle = document.getElementById("title");
const elSub = document.getElementById("sub");
const elPlayer = document.getElementById("player");
const elMarkers = document.getElementById("markers");
const elNotes = document.getElementById("notes");
const elImportBox = document.getElementById("importBox");
const elImportBtn = document.getElementById("importBtn");
const elSaveBtn = document.getElementById("saveBtn");
const elSaveStatus = document.getElementById("saveStatus");

let markers = [];

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

  elTitle.textContent = current.filename;
  elSub.textContent = `${current.libName} • ${current.relPath}`;

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

elImportBtn.addEventListener("click", () => {
  const parsed = parseImport(elImportBox.value);
  if (parsed.length) {
    markers = parsed; // overwrite for v0.1
    renderMarkers();
  }
});

elSaveBtn.addEventListener("click", save);

load();