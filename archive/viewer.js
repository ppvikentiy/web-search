const params = new URLSearchParams(location.search);
const entryId = params.get('id') || '';

const els = {
  title: document.getElementById('viewer-title'),
  subtitle: document.getElementById('viewer-subtitle'),
  loading: document.getElementById('viewer-loading'),
  prompt: document.getElementById('viewer-prompt'),
  promptDesc: document.getElementById('viewer-prompt-desc'),
  error: document.getElementById('viewer-error'),
  errorText: document.getElementById('viewer-error-text'),
  frame: document.getElementById('viewer-frame'),
  fileInput: document.getElementById('viewer-file-input'),
  pickFile: document.getElementById('viewer-pick-file'),
  openOriginal: document.getElementById('viewer-open-original'),
  back: document.getElementById('viewer-back'),
  retry: document.getElementById('viewer-retry')
};

let currentBlobUrls = null;
let journalEntry = null;

function runtimeMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function setView(state) {
  els.loading.hidden = state !== 'loading';
  els.prompt.hidden = state !== 'prompt';
  els.error.hidden = state !== 'error';
  els.frame.hidden = state !== 'frame';
}

function showError(message) {
  els.errorText.textContent = message;
  setView('error');
}

function cleanupRender() {
  if (currentBlobUrls) {
    WSArchiveViewer.revokeBlobUrls(currentBlobUrls);
    currentBlobUrls = null;
  }
}

function renderZipBytes(zipBytes) {
  cleanupRender();
  const rendered = WSArchiveViewer.renderArchive(zipBytes);
  currentBlobUrls = rendered.blobUrls;
  els.frame.srcdoc = rendered.html;
  setView('frame');
}

async function loadJournalEntry() {
  if (!entryId) return null;
  const response = await runtimeMessage('ARCHIVE_JOURNAL_GET', { id: entryId });
  return response?.entry || null;
}

async function loadFromCache() {
  if (!entryId) return null;

  try {
    const record = await WSArchiveCache.get(entryId);
    const zipBytes = WSArchiveBytes.normalizeZipBytes(record?.zipBytes);
    if (!zipBytes?.byteLength) return null;
    return { zipBytes, title: record.title, filename: record.filename };
  } catch {
    return null;
  }
}

function applyCacheMeta(cached) {
  if (!cached) return;
  const title = cached.title || cached.filename || 'Офлайн-страница';
  els.title.textContent = title;
  document.title = `${title} — архив`;
  if (cached.filename) els.subtitle.textContent = cached.filename;
}

function applyEntryMeta(entry) {
  journalEntry = entry;
  if (!entry) return;

  els.title.textContent = entry.title || 'Офлайн-страница';
  document.title = `${entry.title || 'Офлайн-страница'} — архив`;

  const parts = [];
  if (entry.filename) parts.push(entry.filename);
  if (entry.url) parts.push(entry.url);
  els.subtitle.textContent = parts.join(' · ');

  if (entry.url) {
    els.openOriginal.hidden = false;
    els.openOriginal.onclick = () => {
      chrome.tabs.create({ url: entry.url });
    };
  }
}

async function initViewer() {
  setView('loading');

  try {
    const entry = await loadJournalEntry();
    applyEntryMeta(entry);

    const cached = await loadFromCache();
    if (cached) {
      applyCacheMeta(cached);
      renderZipBytes(cached.zipBytes);
      els.pickFile.hidden = false;
      return;
    }

    if (entry?.filename) {
      els.promptDesc.textContent = `Кэш недоступен. Выберите файл «${entry.filename}» из папки загрузок.`;
    }

    els.pickFile.hidden = false;
    setView('prompt');
  } catch (err) {
    showError(err.message || 'Не удалось загрузить архив');
  }
}

async function handleFile(file) {
  if (!file) return;
  setView('loading');

  try {
    const buffer = await file.arrayBuffer();
    const zipBytes = WSArchiveBytes.normalizeZipBytes(buffer);
    if (!zipBytes?.byteLength) {
      showError('Пустой файл архива');
      return;
    }
    if (!WSArchiveBytes.isZipBytes(zipBytes)) {
      showError('Повреждённый архив: файл не является ZIP');
      return;
    }
    renderZipBytes(zipBytes);
  } catch (err) {
    showError(err.message || 'Не удалось открыть архив');
  }
}

els.fileInput?.addEventListener('change', () => {
  const file = els.fileInput.files?.[0];
  if (file) handleFile(file);
});

els.pickFile?.addEventListener('click', () => {
  els.fileInput?.click();
});

els.retry?.addEventListener('click', () => {
  initViewer().catch((err) => showError(err.message));
});

els.back?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

window.addEventListener('pagehide', cleanupRender);

initViewer().catch((err) => showError(err.message));
