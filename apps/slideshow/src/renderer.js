'use strict';

// ── State ──
let images = [];       // [{ name, path }]
let current = 0;
let playing = false;
let timer = null;
let drawerOpen = false;

// ── Elements ──
const dropScreen   = document.getElementById('drop-screen');
const appEl        = document.getElementById('app');
const slideImg     = document.getElementById('slide-img');
const controls     = document.getElementById('controls');
const drawer       = document.getElementById('drawer');
const fileList     = document.getElementById('file-list');
const fileCount    = document.getElementById('file-count');
const counter      = document.getElementById('counter');
const playBtn      = document.getElementById('play-btn');
const intervalInput= document.getElementById('interval-input');
const filenameEl   = document.getElementById('filename');
const openBtn      = document.getElementById('open-btn');
const shuffleBtn   = document.getElementById('shuffle-btn');
const drawerBtn    = document.getElementById('drawer-btn');
const fsBtn        = document.getElementById('fs-btn');

// ── Load images ──
async function loadFolder(folderPath) {
  const files = await window.api.readFolder(folderPath);
  if (!files.length) return;
  images = files;
  current = 0;
  buildFileList();
  dropScreen.style.display = 'none';
  appEl.style.display = 'block';
  show();
  goFullscreen();
}

// ── Show current image ──
function show() {
  if (!images.length) return;
  const img = images[current];
  slideImg.src = `file://${img.path}`;
  counter.textContent = `${current + 1} / ${images.length}`;
  highlightFileItem(current);
  showFilename(img.name);
}

// ── File list ──
function buildFileList() {
  fileList.innerHTML = '';
  fileCount.textContent = `${images.length} image${images.length !== 1 ? 's' : ''}`;
  images.forEach((img, i) => {
    const el = document.createElement('div');
    el.className = 'file-item';
    el.textContent = img.name;
    el.title = img.name;
    el.addEventListener('click', () => { current = i; show(); });
    fileList.appendChild(el);
  });
}

function highlightFileItem(index) {
  document.querySelectorAll('.file-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
  const active = fileList.children[index];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

// ── Filename display: toggle off/always ──
let filenameMode = false; // default: off
const filenameBtn = document.getElementById('filename-btn');

function applyFilenameMode() {
  filenameEl.classList.toggle('always', filenameMode);
  if (!filenameMode) filenameEl.style.opacity = '0';
  else filenameEl.style.opacity = '';
  filenameBtn.classList.toggle('active', filenameMode);
}

function toggleFilenameMode() {
  filenameMode = !filenameMode;
  applyFilenameMode();
  if (filenameMode && images.length) showFilename(images[current].name);
}

filenameBtn.addEventListener('click', toggleFilenameMode);
applyFilenameMode();

// ── Filename ──
function showFilename(name) {
  filenameEl.textContent = name;
  if (!filenameMode) return;
  filenameEl.classList.add('always');
  filenameEl.style.opacity = '';
}

// ── Navigation ──
function prev() { current = (current - 1 + images.length) % images.length; show(); }
function next() { current = (current + 1) % images.length; show(); }

// ── Play/Pause ──
function togglePlay() {
  if (!images.length) return;
  playing = !playing;
  document.getElementById('icon-play').style.display = playing ? 'none' : 'block';
  document.getElementById('icon-pause').style.display = playing ? 'block' : 'none';
  playBtn.classList.toggle('active', playing);
  if (playing) {
    timer = setInterval(next, intervalInput.value * 1000);
  } else {
    clearInterval(timer);
    timer = null;
  }
}

function restartTimer() {
  if (playing) {
    clearInterval(timer);
    timer = setInterval(next, intervalInput.value * 1000);
  }
}

// ── Shuffle ──
function shuffle() {
  if (!images.length) return;
  const currentImg = images[current];
  for (let i = images.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [images[i], images[j]] = [images[j], images[i]];
  }
  current = images.findIndex(img => img.path === currentImg.path);
  buildFileList();
  show();
}

// ── Drawer ──
function toggleDrawer() {
  drawerOpen = !drawerOpen;
  drawer.classList.toggle('open', drawerOpen);
  drawerBtn.classList.toggle('active', drawerOpen);
}

// ── Fullscreen ──
function goFullscreen() {
  document.documentElement.requestFullscreen().catch(() => {});
}
function toggleFullscreen() {
  if (!document.fullscreenElement) goFullscreen();
  else document.exitFullscreen();
}
document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  document.getElementById('icon-expand').style.display = isFs ? 'none' : 'block';
  document.getElementById('icon-compress').style.display = isFs ? 'block' : 'none';
  fsBtn.classList.toggle('active', isFs);
});

// ── Auto-hide controls ──
let hideTimer;
function showControls() {
  controls.classList.remove('hidden');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!drawerOpen) controls.classList.add('hidden');
  }, 3000);
}
document.addEventListener('mousemove', showControls);
controls.addEventListener('mouseenter', () => clearTimeout(hideTimer));
controls.addEventListener('mouseleave', () => {
  hideTimer = setTimeout(() => {
    if (!drawerOpen) controls.classList.add('hidden');
  }, 3000);
});

// ── Drag & Drop folder ──
document.addEventListener('dragover', e => {
  e.preventDefault();
  dropScreen.classList.add('drag-over');
});
document.addEventListener('dragleave', () => dropScreen.classList.remove('drag-over'));
document.addEventListener('drop', async e => {
  e.preventDefault();
  dropScreen.classList.remove('drag-over');
  const item = e.dataTransfer.items[0];
  if (!item) return;
  const entry = item.webkitGetAsEntry();
  if (entry && entry.isDirectory) {
    loadFolder(e.dataTransfer.files[0].path);
  } else if (entry && entry.isFile) {
    // dropped a file — use its directory
    const filePath = e.dataTransfer.files[0].path;
    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
    loadFolder(folderPath);
  }
});

// ── Event listeners ──
openBtn.addEventListener('click', async () => {
  const folder = await window.api.openFolderDialog();
  if (folder) loadFolder(folder);
});

document.getElementById('prev-btn').addEventListener('click', prev);
document.getElementById('next-btn').addEventListener('click', next);
playBtn.addEventListener('click', togglePlay);
shuffleBtn.addEventListener('click', shuffle);
drawerBtn.addEventListener('click', toggleDrawer);
fsBtn.addEventListener('click', toggleFullscreen);
intervalInput.addEventListener('change', restartTimer);

// ── Keyboard ──
document.addEventListener('keydown', e => {
  if (!images.length) return;
  switch(e.key) {
    case 'ArrowRight': case 'ArrowDown': next(); restartTimer(); break;
    case 'ArrowLeft':  case 'ArrowUp':   prev(); restartTimer(); break;
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 'd': case 'D': toggleDrawer(); break;
    case 'n': case 'N': toggleFilenameMode(); break;
    case 'Escape': if (drawerOpen) toggleDrawer(); break;
  }
});

// ── Click image to advance ──
slideImg.addEventListener('click', () => { next(); restartTimer(); });
