'use strict';

// ── State ──
let tracks = [];
let originalOrder = [];
let current = 0;
let selectedIndices = new Set();
let lastClickedIndex = -1;
let isShuffled = false;
let metaCache = {};
let dragSrcIndex = -1;

// ── Elements ──
const dropScreen   = document.getElementById('drop-screen');
const appEl        = document.getElementById('app');
const audio        = document.getElementById('audio');
const fileList     = document.getElementById('file-list');
const fileCount    = document.getElementById('file-count');
const trackTitle   = document.getElementById('track-title');
const trackArtist  = document.getElementById('track-artist');
const albumArt     = document.getElementById('album-art');
const albumThumb   = document.getElementById('album-thumb');
const seekEl       = document.getElementById('seek');
const timeCur      = document.getElementById('time-cur');
const timeDur      = document.getElementById('time-dur');
const playBtn      = document.getElementById('play-btn');
const volume       = document.getElementById('volume');
const openBtn      = document.getElementById('open-btn');
const shuffleBtn   = document.getElementById('shuffle-btn');
const unshuffleBtn = document.getElementById('unshuffle-btn');
const clearBtn     = document.getElementById('clear-btn');
const canvas       = document.getElementById('visualizer');
const ctx          = canvas.getContext('2d');

// ── Audio context + analyser ──
let audioCtx, analyser, source;

function setupAnalyser() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.8;
  source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
}

// ── Visualizer ──
function resizeCanvas() {
  canvas.width = canvas.offsetWidth * window.devicePixelRatio;
  canvas.height = canvas.offsetHeight * window.devicePixelRatio;
}

function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);
  resizeCanvas();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!analyser) return;
  const bufLen = analyser.frequencyBinCount;
  const data = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(data);
  const barCount = 40;
  const gap = 2 * window.devicePixelRatio;
  const barW = (W - gap * (barCount - 1)) / barCount;
  for (let i = 0; i < barCount; i++) {
    const idx = Math.floor(i * bufLen / barCount);
    const val = data[idx] / 255;
    const barH = Math.max(2, val * H * 0.85);
    const x = i * (barW + gap);
    const y = H - barH;
    const grad = ctx.createLinearGradient(0, y, 0, H);
    grad.addColorStop(0, `rgba(255,255,255,${0.15 + val * 0.6})`);
    grad.addColorStop(1, `rgba(255,255,255,0.04)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 2);
    ctx.fill();
  }
}

// ── Load folder ──
async function loadFolder(folderPath) {
  const files = await window.api.readFolder(folderPath);
  if (!files.length) return;
  tracks = files;
  originalOrder = [...files];
  isShuffled = false;
  unshuffleBtn.style.display = 'none';
  metaCache = {};
  current = 0;
  selectedIndices.clear();
  lastClickedIndex = -1;
  updateClearBtn();
  buildList();
  prefetchAllMetadata();
  dropScreen.style.display = 'none';
  appEl.style.display = 'flex';
  loadTrack(0);
  drawVisualizer();
}

// ── Load track ──
async function loadTrack(index) {
  current = index;
  selectedIndices.clear();
  lastClickedIndex = -1;
  const track = tracks[index];
  audio.src = `file://${track.path}`;
  audio.load();

  trackTitle.textContent = track.name.replace(/\.[^.]+$/, '');
  trackArtist.textContent = '';
  albumArt.classList.remove('visible');
  albumThumb.classList.remove('visible');
  timeDur.textContent = '0:00';
  seekEl.value = 0;
  updateProgress(0);
  refreshList({ scrollToPlaying: true });

  let meta = metaCache[track.path];
  if (!meta) {
    meta = await window.api.readMetadata(track.path);
    metaCache[track.path] = meta;
    updateListItemMeta(index, meta);
  }

  if (meta.title) trackTitle.textContent = meta.title;
  if (meta.artist) trackArtist.textContent = meta.artist + (meta.album ? ` — ${meta.album}` : '');
  if (meta.duration) timeDur.textContent = formatTime(meta.duration);

  if (meta.albumArt) {
    albumArt.src = albumThumb.src = meta.albumArt;
    albumArt.classList.add('visible');
    albumThumb.classList.add('visible');
  } else {
    albumArt.src = albumThumb.src = '';
  }

  audio.play().then(() => {
    setupAnalyser();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    setPlaying(true);
  }).catch(() => {});
}

async function prefetchAllMetadata() {
  const currentTracks = [...tracks];
  await Promise.all(currentTracks.map(async (t, i) => {
    if (metaCache[t.path]) return;
    const meta = await window.api.readMetadata(t.path);
    metaCache[t.path] = meta;
    // Index may have changed due to reordering; find current index by path
    const idx = tracks.findIndex(x => x.path === t.path);
    if (idx !== -1) updateListItemMeta(idx, meta);
  }));
  fillMissingDurationsFromAudio();
}

function fillMissingDurationsFromAudio() {
  const list = tracks.filter(t => {
    const meta = metaCache[t.path];
    return meta && meta.duration == null;
  });
  if (!list.length) return;
  let index = 0;
  function next() {
    if (index >= list.length) return;
    const t = list[index++];
    if (!metaCache[t.path] || metaCache[t.path].duration != null) {
      next();
      return;
    }
    const temp = new Audio();
    temp.preload = 'metadata';
    temp.src = `file://${t.path}`;
    temp.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(temp.duration) && temp.duration > 0 && metaCache[t.path]?.duration == null) {
        metaCache[t.path].duration = temp.duration;
        const idx = tracks.findIndex(x => x.path === t.path);
        if (idx !== -1) updateListItemMeta(idx, metaCache[t.path]);
      }
      temp.src = '';
      next();
    }, { once: true });
    temp.addEventListener('error', () => {
      temp.src = '';
      next();
    }, { once: true });
  }
  next();
}

// ── Build full list (also handles drag/drop reordering) ──
function buildList() {
  fileList.innerHTML = '';
  updateFileCountText();

  tracks.forEach((t, i) => {
    const el = createTrackEl(t, i);
    fileList.appendChild(el);
  });
  refreshList();
}

function createTrackEl(t, i) {
  const el = document.createElement('div');
  el.className = 'track-item';
  el.draggable = true;
  el.dataset.index = i;

  const name = t.name.replace(/\.[^.]+$/, '');
  el.innerHTML = `
    <span class="track-num">${i + 1}</span>
    <span class="track-playing"><span></span><span></span><span></span></span>
    <div class="track-meta">
      <div class="track-name">${name}</div>
      <div class="track-sub"></div>
    </div>
    <span class="track-dur"></span>
  `;

  // single click = select
  el.addEventListener('click', (e) => {
    const idx = parseInt(el.dataset.index);
    if (e.shiftKey && lastClickedIndex >= 0) {
      // range select
      const lo = Math.min(lastClickedIndex, idx);
      const hi = Math.max(lastClickedIndex, idx);
      if (!e.metaKey && !e.ctrlKey) selectedIndices.clear();
      for (let j = lo; j <= hi; j++) selectedIndices.add(j);
    } else if (e.metaKey || e.ctrlKey) {
      // toggle
      if (selectedIndices.has(idx)) selectedIndices.delete(idx);
      else selectedIndices.add(idx);
    } else {
      // single select (toggle off if already sole selection)
      if (selectedIndices.size === 1 && selectedIndices.has(idx)) {
        selectedIndices.clear();
      } else {
        selectedIndices.clear();
        selectedIndices.add(idx);
      }
    }
    lastClickedIndex = idx;
    updateClearBtn();
    refreshList();
  });

  // double click = play
  el.addEventListener('dblclick', () => {
    loadTrack(parseInt(el.dataset.index));
  });

  // ── Drag to reorder ──
  el.addEventListener('dragstart', (e) => {
    dragSrcIndex = parseInt(el.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcIndex);
    setTimeout(() => el.classList.add('dragging'), 0);
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    document.querySelectorAll('.track-item.drag-over').forEach(x => x.classList.remove('drag-over'));
  });

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.track-item.drag-over').forEach(x => x.classList.remove('drag-over'));
    el.classList.add('drag-over');
  });

  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag-over');
    const destIndex = parseInt(el.dataset.index);
    if (dragSrcIndex === destIndex) return;

    const movingTrack = tracks[dragSrcIndex];
    tracks.splice(dragSrcIndex, 1);
    const insertAt = dragSrcIndex < destIndex ? destIndex : destIndex;
    tracks.splice(insertAt, 0, movingTrack);

    // update current pointer
    if (dragSrcIndex === current) current = insertAt;
    else if (dragSrcIndex < current && insertAt >= current) current--;
    else if (dragSrcIndex > current && insertAt <= current) current++;

    selectedIndices.clear();
    selectedIndices.add(insertAt);
    lastClickedIndex = insertAt;
    updateClearBtn();
    buildList();
    tracks.forEach((t, i) => { if (metaCache[t.path]) updateListItemMeta(i, metaCache[t.path]); });
  });

  return el;
}

// ── Refresh visual state without rebuilding DOM ──
function refreshList(opts = {}) {
  Array.from(fileList.children).forEach((el, i) => {
    el.dataset.index = i;
    el.classList.toggle('playing', i === current);
    el.classList.toggle('paused', i === current && audio.paused);
    el.classList.toggle('selected', selectedIndices.has(i));
    el.querySelector('.track-num').textContent = i + 1;
  });
  // Only scroll to playing track when explicitly requested (e.g. after loadTrack), not on
  // every selection change — otherwise single-click scrolls the list and double-click hits the wrong track.
  if (opts.scrollToPlaying) {
    const playingEl = fileList.children[current];
    if (playingEl) playingEl.scrollIntoView({ block: 'nearest' });
  }
}

function updateListItemMeta(index, meta) {
  const el = fileList.children[index];
  if (!el) return;
  if (meta.title) el.querySelector('.track-name').textContent = meta.title;
  if (meta.artist) el.querySelector('.track-sub').textContent = meta.artist;
  if (meta.duration) el.querySelector('.track-dur').textContent = formatTime(meta.duration);
  updateFileCountText();
}

// ── Clear button label ──
function updateClearBtn() {
  clearBtn.innerHTML = clearBtn.innerHTML.replace(/Clear.*/, selectedIndices.size > 0 ? 'Clear Tracks' : 'Clear All');
  // rebuild inner text safely
  const svg = clearBtn.querySelector('svg');
  clearBtn.textContent = selectedIndices.size > 0 ? 'Clear Tracks' : 'Clear All';
  clearBtn.prepend(svg);
}

// ── Clear / delete ──
function resetPlayerUI() {
  audio.pause();
  audio.src = '';
  setPlaying(false);
  trackTitle.textContent = '–';
  trackArtist.textContent = '';
  albumArt.classList.remove('visible');
  albumThumb.classList.remove('visible');
  seekEl.value = 0;
  updateProgress(0);
  timeCur.textContent = '0:00';
  timeDur.textContent = '0:00';
}

function showDropScreen() {
  appEl.style.display = 'none';
  dropScreen.style.display = 'flex';
  tracks = [];
  originalOrder = [];
  isShuffled = false;
  unshuffleBtn.style.display = 'none';
  metaCache = {};
  current = 0;
  selectedIndices.clear();
  lastClickedIndex = -1;
}

function clearTracks() {
  if (selectedIndices.size > 0) {
    const toDelete = Array.from(selectedIndices).sort((a, b) => b - a);
    const playingRemoved = toDelete.includes(current);
    let newCurrent = current;
    toDelete.forEach(idx => {
      tracks.splice(idx, 1);
      if (idx < newCurrent) newCurrent--;
    });
    selectedIndices.clear();
    if (!tracks.length) {
      resetPlayerUI();
      showDropScreen();
      return;
    }
    if (playingRemoved) {
      current = Math.min(newCurrent, tracks.length - 1);
      resetPlayerUI();
      loadTrack(current);
    } else {
      current = Math.max(0, newCurrent);
    }
  } else {
    resetPlayerUI();
    showDropScreen();
    return;
  }
  updateClearBtn();
  buildList();
  tracks.forEach((t, i) => { if (metaCache[t.path]) updateListItemMeta(i, metaCache[t.path]); });
}

// ── Playback ──
function setPlaying(val) {
  document.getElementById('icon-play').style.display = val ? 'none' : 'block';
  document.getElementById('icon-pause').style.display = val ? 'block' : 'none';
  const playingEl = fileList.children[current];
  if (playingEl) playingEl.classList.toggle('paused', !val);
}

function togglePlay() {
  if (!tracks.length) return;
  if (audio.paused) {
    audio.play().then(() => { setupAnalyser(); audioCtx?.resume(); setPlaying(true); });
  } else {
    audio.pause(); setPlaying(false);
  }
}

function prevTrack() {
  if (!tracks.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  loadTrack((current - 1 + tracks.length) % tracks.length);
}

function nextTrack() {
  if (!tracks.length) return;
  loadTrack((current + 1) % tracks.length);
}

// ── Seek ──
function updateProgress(pct) {
  seekEl.style.background = `linear-gradient(to right, rgba(255,255,255,0.7) ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;
}

seekEl.addEventListener('input', () => {
  if (!audio.duration) return;
  audio.currentTime = (seekEl.value / 100) * audio.duration;
});

// When metadata has no duration, use the audio element's duration once loaded and backfill cache for total
audio.addEventListener('loadedmetadata', () => {
  if (!tracks.length || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const path = tracks[current]?.path;
  if (!path) return;
  const meta = metaCache[path];
  if (!meta) return;
  if (meta.duration != null) return;
  meta.duration = audio.duration;
  timeDur.textContent = formatTime(meta.duration);
  updateListItemMeta(current, meta);
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  seekEl.value = pct;
  updateProgress(pct);
  timeCur.textContent = formatTime(audio.currentTime);
  timeDur.textContent = '-' + formatTime(Math.max(0, audio.duration - audio.currentTime));
});

audio.addEventListener('ended', () => {
  if (current < tracks.length - 1) nextTrack();
  else { setPlaying(false); seekEl.value = 0; updateProgress(0); }
});

// ── Volume ──
volume.addEventListener('input', () => { audio.volume = volume.value; });

// ── Shuffle / Unshuffle ──
function shuffle() {
  if (!tracks.length) return;
  const cur = tracks[current];
  for (let i = tracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  }
  current = tracks.findIndex(t => t.path === cur.path);
  isShuffled = true;
  unshuffleBtn.style.display = '';
  selectedIndices.clear();
  updateClearBtn();
  buildList();
  tracks.forEach((t, i) => { if (metaCache[t.path]) updateListItemMeta(i, metaCache[t.path]); });
}

function unshuffle() {
  const cur = tracks[current];
  const deletedPaths = new Set(
    originalOrder.map(t => t.path).filter(p => !tracks.find(t => t.path === p))
  );
  tracks = originalOrder.filter(t => !deletedPaths.has(t.path));
  current = Math.max(0, tracks.findIndex(t => t.path === cur.path));
  isShuffled = false;
  unshuffleBtn.style.display = 'none';
  selectedIndices.clear();
  updateClearBtn();
  buildList();
  tracks.forEach((t, i) => { if (metaCache[t.path]) updateListItemMeta(i, metaCache[t.path]); });
}

// ── Helpers ──
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function formatTotalDuration(sec) {
  if (!sec || isNaN(sec) || sec <= 0) return '';
  const totalMin = Math.round(sec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins ? `${hrs} hr ${mins} min` : `${hrs} hr`;
}

function getTotalDuration() {
  let sec = 0;
  tracks.forEach(t => {
    const meta = metaCache[t.path];
    if (meta?.duration) sec += meta.duration;
  });
  return sec;
}

function updateFileCountText() {
  const n = tracks.length;
  const countStr = `${n} track${n !== 1 ? 's' : ''}`;
  const durStr = formatTotalDuration(getTotalDuration());
  fileCount.textContent = durStr ? `${countStr} · ${durStr}` : countStr;
}

// ── Events ──
openBtn.addEventListener('click', async () => {
  const folder = await window.api.openFolderDialog();
  if (folder) loadFolder(folder);
});

document.getElementById('prev-btn').addEventListener('click', prevTrack);
document.getElementById('next-btn').addEventListener('click', nextTrack);
playBtn.addEventListener('click', togglePlay);
shuffleBtn.addEventListener('click', shuffle);
unshuffleBtn.addEventListener('click', unshuffle);
clearBtn.addEventListener('click', clearTracks);

document.addEventListener('dragover', e => {
  // only intercept folder drops on drop screen
  if (appEl.style.display !== 'none') return;
  e.preventDefault();
  dropScreen.classList.add('drag-over');
});
document.addEventListener('dragleave', () => dropScreen.classList.remove('drag-over'));
document.addEventListener('drop', async e => {
  if (appEl.style.display !== 'none') return; // let track items handle their own drops
  e.preventDefault();
  dropScreen.classList.remove('drag-over');
  const entry = e.dataTransfer.items[0]?.webkitGetAsEntry();
  if (!entry) return;
  const filePath = e.dataTransfer.files[0].path;
  const folderPath = entry.isDirectory ? filePath : filePath.substring(0, filePath.lastIndexOf('/'));
  loadFolder(folderPath);
});

// Also allow dropping folder onto the app itself to reload
appEl.addEventListener('dragover', e => {
  const entry = e.dataTransfer.items[0]?.webkitGetAsEntry();
  if (entry && entry.isDirectory) { e.preventDefault(); }
});
appEl.addEventListener('drop', async e => {
  const entry = e.dataTransfer.items[0]?.webkitGetAsEntry();
  if (entry && entry.isDirectory) {
    e.preventDefault();
    loadFolder(e.dataTransfer.files[0].path);
  }
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'ArrowRight': if (!tracks.length) return; nextTrack(); break;
    case 'ArrowLeft': if (!tracks.length) return; prevTrack(); break;
    case 'ArrowUp': volume.value = Math.min(1, parseFloat(volume.value) + 0.05); audio.volume = volume.value; break;
    case 'ArrowDown': volume.value = Math.max(0, parseFloat(volume.value) - 0.05); audio.volume = volume.value; break;
    case 'Delete':
    case 'Backspace':
      if (selectedIndices.size > 0) clearTracks();
      break;
    case 'Escape':
      selectedIndices.clear();
      updateClearBtn();
      refreshList();
      break;
    case 'a':
    case 'A':
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        tracks.forEach((_, i) => selectedIndices.add(i));
        updateClearBtn();
        refreshList();
      }
      break;
  }
});

window.api.onMediaKey(key => {
  if (key === 'playpause') togglePlay();
  else if (key === 'next') nextTrack();
  else if (key === 'prev') prevTrack();
});

window.addEventListener('resize', resizeCanvas);
