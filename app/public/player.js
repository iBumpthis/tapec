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

// --- Playback mode state ---
let currentMode = "video";
let currentTheme = "rgb";
let fileExt = "";

const elPlaybackFrame = document.getElementById("playbackFrame");
const elVizCanvas = document.getElementById("vizCanvas");
const elPlaybackToolbar = document.getElementById("playbackToolbar");
const elThemeSelector = document.getElementById("themeSelector");
const elModeNotice = document.getElementById("modeNotice");
const modeBtns = document.querySelectorAll(".mode-btn");
const themeBtns = document.querySelectorAll(".theme-btn");

// --- Custom controls ---
const elCustomControls = document.getElementById("customControls");
const elCcPlay = document.getElementById("ccPlay");
const elCcPlayIcon = document.getElementById("ccPlayIcon");
const elCcPauseIcon = document.getElementById("ccPauseIcon");
const elCcSeek = document.getElementById("ccSeek");
const elCcTimeCurrent = document.getElementById("ccTimeCurrent");
const elCcTimeDuration = document.getElementById("ccTimeDuration");
const elCcVolume = document.getElementById("ccVolume");
const elCcFullscreen = document.getElementById("ccFullscreen");
const elCcFsEnter = document.getElementById("ccFsEnter");
const elCcFsExit = document.getElementById("ccFsExit");
let isSeeking = false;

// --- Web Audio API state (lazy init) ---
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let vizAnimFrame = null;
let freqData = null;

const AUDIO_ONLY_EXTS = new Set(["mp3", "wav", "flac", "m4a", "ogg", "aac", "wma"]);

// ============================================================
// Custom control bar logic
// ============================================================

// Play/pause
elCcPlay.addEventListener("click", () => {
  if (elPlayer.paused) {
    elPlayer.play();
  } else {
    elPlayer.pause();
  }
});

// Click video to play/pause (video + visualizer modes)
elPlayer.addEventListener("click", () => {
  if (elPlayer.paused) {
    elPlayer.play();
  } else {
    elPlayer.pause();
  }
});

// Sync play/pause icon
elPlayer.addEventListener("play", () => {
  elCcPlayIcon.classList.add("hidden");
  elCcPauseIcon.classList.remove("hidden");
});
elPlayer.addEventListener("pause", () => {
  elCcPlayIcon.classList.remove("hidden");
  elCcPauseIcon.classList.add("hidden");
});

// Seek bar — update from playback
elPlayer.addEventListener("timeupdate", () => {
  if (!isSeeking && elPlayer.duration) {
    elCcSeek.value = (elPlayer.currentTime / elPlayer.duration) * 100;
    elCcTimeCurrent.textContent = fmtTime(elPlayer.currentTime);
  }
});

// Seek bar — user interaction
elCcSeek.addEventListener("mousedown", () => { isSeeking = true; });
elCcSeek.addEventListener("touchstart", () => { isSeeking = true; }, { passive: true });
elCcSeek.addEventListener("input", () => {
  if (elPlayer.duration) {
    elCcTimeCurrent.textContent = fmtTime((elCcSeek.value / 100) * elPlayer.duration);
  }
});
elCcSeek.addEventListener("change", () => {
  if (elPlayer.duration) {
    elPlayer.currentTime = (elCcSeek.value / 100) * elPlayer.duration;
  }
  isSeeking = false;
});

// Duration display
elPlayer.addEventListener("loadedmetadata", () => {
  elCcTimeDuration.textContent = fmtTime(elPlayer.duration);
});

// Volume
elCcVolume.addEventListener("input", () => {
  elPlayer.volume = Number(elCcVolume.value);
});

// Fullscreen
elCcFullscreen.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    elPlaybackFrame.requestFullscreen().catch(err => {
      console.warn("[TapeC] Fullscreen request failed:", err);
    });
  }
});

// Sync fullscreen icon
document.addEventListener("fullscreenchange", () => {
  const isFs = !!document.fullscreenElement;
  elCcFsEnter.classList.toggle("hidden", isFs);
  elCcFsExit.classList.toggle("hidden", !isFs);
});

// Fullscreen: show controls on mouse movement, hide after 3s idle
let fsIdleTimer = null;

elPlaybackFrame.addEventListener("mousemove", () => {
  if (!document.fullscreenElement) return;
  elCustomControls.classList.add("cc-visible");
  clearTimeout(fsIdleTimer);
  fsIdleTimer = setTimeout(() => {
    elCustomControls.classList.remove("cc-visible");
  }, 3000);
});

// Also show on any click (for play/pause), reset timer
elPlaybackFrame.addEventListener("click", () => {
  if (!document.fullscreenElement) return;
  elCustomControls.classList.add("cc-visible");
  clearTimeout(fsIdleTimer);
  fsIdleTimer = setTimeout(() => {
    elCustomControls.classList.remove("cc-visible");
  }, 3000);
});

// Clean up on fullscreen exit
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    clearTimeout(fsIdleTimer);
    elCustomControls.classList.remove("cc-visible");
  }
});

// ============================================================
// Visualizer themes
// ============================================================
const VIZ_THEMES = {
  muted: {
    bg: "rgba(0, 0, 0, 0.92)",
    barColor: (i, count, _t) => {
      const pct = i / count;
      const r = Math.round(120 + pct * 60);
      const g = Math.round(130 + pct * 50);
      const b = Math.round(145 + pct * 40);
      return `rgb(${r}, ${g}, ${b})`;
    }
  },
  colorful: {
    bg: "rgba(0, 0, 0, 0.92)",
    barColor: (i, count, _t) => {
      const hue = (i / count) * 280 + 200;
      return `hsl(${hue % 360}, 72%, 58%)`;
    }
  },
  rgb: {
    bg: "rgba(0, 0, 0, 0.95)",
    barColor: (i, count, t) => {
      const hue = ((i / count) * 360 + t * 40) % 360;
      return `hsl(${hue}, 90%, 55%)`;
    }
  }
};

// ============================================================
// Audio context + analyser (lazy, one-time setup)
// ============================================================
function ensureAudioContext() {
  if (audioCtx && sourceNode) return true;

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    freqData = new Uint8Array(analyser.frequencyBinCount);

    sourceNode = audioCtx.createMediaElementSource(elPlayer);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);

    return true;
  } catch (e) {
    console.error("[TapeC] AudioContext init failed:", e);
    return false;
  }
}

// ============================================================
// Visualizer draw loop — mirrored from center
// ============================================================
function startVizLoop() {
  if (vizAnimFrame) return;

  const draw = () => {
    vizAnimFrame = requestAnimationFrame(draw);

    const canvas = elVizCanvas;
    const ctx = canvas.getContext("2d");

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const w = canvas.width;
    const h = canvas.height;
    const theme = VIZ_THEMES[currentTheme] || VIZ_THEMES.rgb;

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    analyser.getByteFrequencyData(freqData);

    const t = performance.now() / 1000;
    const usableBins = Math.floor(analyser.frequencyBinCount * 0.6);
    const barWidth = w / (usableBins * 2);
    const centerX = w / 2;

    for (let i = 0; i < usableBins; i++) {
      const val = freqData[i] / 255;
      const barHeight = val * h * 1;

      ctx.fillStyle = theme.barColor(i, usableBins, t);

      const gap = Math.max(1, barWidth * 0.15);
      const bw = barWidth - gap;

      const xRight = centerX + i * barWidth;
      ctx.fillRect(xRight + gap / 2, h - barHeight, bw, barHeight);

      const xLeft = centerX - (i + 1) * barWidth;
      ctx.fillRect(xLeft + gap / 2, h - barHeight, bw, barHeight);
    }
  };

  draw();
}

function stopVizLoop() {
  if (vizAnimFrame) {
    cancelAnimationFrame(vizAnimFrame);
    vizAnimFrame = null;
  }
}

// ============================================================
// Mode switching
// ============================================================
function setMode(mode) {
  const prevMode = currentMode;
  currentMode = mode;

  modeBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  elThemeSelector.classList.toggle("hidden", mode !== "visualizer");

  elModeNotice.classList.add("hidden");
  elModeNotice.textContent = "";

  if (mode === "video") {
    stopVizLoop();
    elPlaybackFrame.classList.remove("mode-audio", "mode-visualizer");
    elPlaybackFrame.classList.add("mode-video");

    if (AUDIO_ONLY_EXTS.has(fileExt)) {
      showNotice("Audio file — no video track available");
    }

  } else if (mode === "audio") {
    stopVizLoop();
    elPlaybackFrame.classList.remove("mode-video", "mode-visualizer");
    elPlaybackFrame.classList.add("mode-audio");

  } else if (mode === "visualizer") {
    const ok = ensureAudioContext();
    if (!ok) {
      showNotice("Could not initialize audio — browser may not support Web Audio API");
      currentMode = prevMode;
      modeBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.mode === prevMode));
      return;
    }

    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    elPlaybackFrame.classList.remove("mode-video", "mode-audio");
    elPlaybackFrame.classList.add("mode-visualizer");
    startVizLoop();
  }

  syncMarkersHeight();
}

function setTheme(theme) {
  currentTheme = theme;
  themeBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

function showNotice(msg) {
  elModeNotice.textContent = msg;
  elModeNotice.classList.remove("hidden");
}

modeBtns.forEach(btn => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

themeBtns.forEach(btn => {
  btn.addEventListener("click", () => setTheme(btn.dataset.theme));
});

// ============================================================
// Existing player logic
// ============================================================

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

  fileExt = (current.ext || "").toLowerCase();

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

  const defaultMode = current.defaultMode || "video";
  setMode(defaultMode);

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

// --- Markers panel: height sync ---
const elMarkersScroll = document.getElementById("markers-scroll");
const elMarkersToggle = document.getElementById("markersToggle");
let markersCollapsed = false;

function syncMarkersHeight() {
  if (markersCollapsed) return;
  let targetHeight;
  if (currentMode === "audio") {
    targetHeight = window.innerHeight * 0.5;
  } else {
    targetHeight = elPlaybackFrame.getBoundingClientRect().height;
  }
  if (targetHeight > 0) {
    elMarkersScroll.style.maxHeight = targetHeight + "px";
  }
}

const resizeObserver = new ResizeObserver(() => syncMarkersHeight());
resizeObserver.observe(elPlaybackFrame);
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

  const markerEls = elMarkers.querySelectorAll(".marker");
  markerEls.forEach((el, i) => {
    el.classList.toggle("active", i === idx);
  });

  if (idx === -1) {
    if (markers.length > 0) {
      renderPreparedState();
    } else {
      elNowPlayingStrip.classList.add("hidden");
    }
    return;
  }

  elNowPlayingStrip.classList.remove("hidden");

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

// --- Cleanup on unload ---
window.addEventListener("beforeunload", () => {
  stopVizLoop();
  if (audioCtx) {
    audioCtx.close().catch(() => {});
  }
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