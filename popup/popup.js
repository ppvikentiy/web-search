const CONTENT_SCRIPT_VERSION = '1.0.3';

const CONTENT_FILES = [
  'lib/defaults.js',
  'lib/icons.js',
  'lib/word-boundary.js',
  'lib/dom-utils.js',
  'lib/user-dictionary.js',
  'lib/readability.js',
  'lib/dompurify.min.js',
  'lib/jsqr.min.js',
  'lib/qr-utils.js',
  'content/morphology.js',
  'content/dom-search.js',
  'content/annotations.js',
  'content/annotation-pill.js',
  'lib/citation-formats.js',
  'lib/literature-export.js',
  'lib/annotation-export.js',
  'content/annotation-note.js',
  'content/dictionary-popup.js',
  'content/qr-decode.js',
  'content/search-sidebar.js',
  'content/reader-extract.js',
  'content/archive-collect.js',
  'content/content.js'
];

const CSS_FILES = [
  'lib/icons.css',
  'content/highlights.css',
  'content/annotations.css',
  'content/dictionary.css',
  'content/qr-decode.css',
  'content/sidebar.css'
];

const $ = (id) => document.getElementById(id);

const els = {
  query: $('query'),
  counter: $('counter'),
  status: $('status'),
  pageSite: $('page-site'),
  pageTitle: $('page-title'),
  btnSearch: $('btn-search'),
  btnClear: $('btn-clear'),
  btnPrev: $('btn-prev'),
  btnNext: $('btn-next'),
  btnDock: $('btn-dock'),
  btnReader: $('btn-reader'),
  btnReaderExit: $('btn-reader-exit'),
  btnSettings: $('btn-settings'),
  btnFindSelection: $('btn-find-selection'),
  btnQrPage: $('btn-qr-page'),
  btnArchive: $('btn-archive-offline'),
  qrPanel: $('qr-panel'),
  qrImage: $('qr-image'),
  qrUrl: $('qr-url'),
  btnQrCopy: $('btn-qr-copy'),
  btnQrDownload: $('btn-qr-download'),
  optCase: $('opt-case'),
  optWhole: $('opt-whole'),
  optMorph: $('opt-morph'),
  optAnnotationMode: $('opt-annotation-mode'),
  annotationStatus: $('annotation-status')
};

let activeTabId = null;
let activeTabUrl = '';
let isReaderTabActive = false;
let appSettings = null;
let searchActiveOnPage = false;
let annotationModeOnPage = false;
let qrPanelVisible = false;
let qrDataUrl = '';

function getDefaults() {
  return globalThis.WS_DEFAULTS || {};
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function formatSite(url) {
  if (!url) return '—';
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function updatePageInfo(tab) {
  const site = formatSite(tab?.url);
  const title = tab?.title?.trim() || '—';

  if (els.pageSite) {
    els.pageSite.textContent = site;
    els.pageSite.title = tab?.url || site;
  }

  if (els.pageTitle) {
    els.pageTitle.textContent = title;
    els.pageTitle.title = title;
  }
}

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, TOP_FRAME);
    return response?.ok && response?.version === CONTENT_SCRIPT_VERSION;
  } catch {
    return false;
  }
}

function isContextInvalidated(err) {
  const msg = err?.message || String(err || '');
  return msg.includes('Extension context invalidated');
}

function isConnectionError(err) {
  const msg = err?.message || String(err || '');
  return msg.includes('Receiving end does not exist')
    || msg.includes('Could not establish connection')
    || msg.includes('The message port closed');
}

function shouldRetryMessage(err) {
  return isContextInvalidated(err) || isConnectionError(err);
}

const TOP_FRAME = { frameId: 0 };

async function injectStyles(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: CSS_FILES
    });
  } catch {
    /* styles may already be injected */
  }
}

async function injectContentScript(tabId) {
  await injectStyles(tabId);
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_FILES
  });
}

async function ensureContentScript(tabId) {
  await injectStyles(tabId);
  if (await pingContentScript(tabId)) return true;

  try {
    await injectContentScript(tabId);
    return await pingContentScript(tabId);
  } catch {
    setStatus('Нельзя искать на этой странице (системная или защищённая вкладка).', true);
    return false;
  }
}

function isReaderTab(url) {
  return Boolean(url?.includes('/reader/reader.html'));
}

async function sendToReader(type, payload = {}) {
  if (!activeTabId) return null;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, targetTabId: activeTabId, ...payload }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        setStatus(err.message, true);
        resolve(null);
        return;
      }
      if (response?.error) {
        const messages = {
          'Extension context invalidated': 'Расширение перезагружено — обновите страницу.',
          'Unknown message type': 'Неизвестная команда.',
          not_top_frame: 'Действие недоступно во вложенном фрейме.'
        };
        setStatus(messages[response.error] || response.error, true);
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

async function sendToActiveTab(type, payload = {}, { retry = true, ensure = true } = {}) {
  if (isReaderTabActive) {
    return sendToReader(type, payload);
  }
  return sendToContent(type, payload, { retry, ensure });
}

function updateReaderUI() {
  const readerMode = isReaderTabActive;
  document.body.classList.toggle('reader-tab-mode', readerMode);

  if (els.btnReader) els.btnReader.hidden = readerMode;
  if (els.btnReaderExit) els.btnReaderExit.hidden = !readerMode;
  if (els.btnDock) els.btnDock.hidden = readerMode;
  if (els.btnArchive) els.btnArchive.hidden = readerMode;

  if (readerMode) {
    setStatus('Поиск и аннотации — в панели рядом с «К оригиналу».');
  }
}

async function openReader() {
  const ready = await ensureContentScript(activeTabId);
  if (!ready) return;

  const state = await sendToContent('READER_OPEN');
  if (!state) return;

  if (state.ok === false) {
    setStatus(state.message || 'Не удалось открыть читатель.', true);
    return;
  }

  setStatus('Читатель открыт в новой вкладке.');
  window.close();
}

async function exitReaderFromPopup() {
  const state = await sendToReader('READER_EXIT');
  if (state?.ok) {
    window.close();
  }
}

async function sendToContent(type, payload = {}, { retry = true, ensure = false } = {}) {
  if (!activeTabId) return null;

  if (ensure) {
    const ready = await ensureContentScript(activeTabId);
    if (!ready) return null;
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTabId, { type, ...payload }, TOP_FRAME);
    if (response?.error) {
      if (retry && shouldRetryMessage({ message: response.error })) {
        const ready = await ensureContentScript(activeTabId);
        if (ready) return sendToContent(type, payload, { retry: false });
      }
      setStatus(response.error, true);
      return null;
    }
    return response;
  } catch (err) {
    if (retry && shouldRetryMessage(err)) {
      const ready = await ensureContentScript(activeTabId);
      if (ready) return sendToContent(type, payload, { retry: false });
    }
    setStatus(err.message || 'Ошибка связи со страницей', true);
    return null;
  }
}

function setStatus(text, isError = false) {
  if (!els.status) return;
  els.status.textContent = text || '';
  els.status.classList.toggle('error', isError);
}

function updateAnnotationStatus(state) {
  if (!state) return;
  annotationModeOnPage = Boolean(state.annotationMode);
  els.optAnnotationMode.checked = annotationModeOnPage;

  const total = state.annotationTotal ?? 0;
  const current = state.annotationCurrent ?? 0;

  if (annotationModeOnPage) {
    els.annotationStatus.textContent = total
      ? `Аннотаций: ${current} из ${total}`
      : 'Режим активен — выделите текст на странице';
  } else {
    els.annotationStatus.textContent = total
      ? `На странице ${total} аннотаций (режим выключен)`
      : '';
  }
}

function applySettingsToForm() {
  if (!appSettings) return;
  if (els.optCase) els.optCase.checked = appSettings.caseSensitive ?? true;
  if (els.optWhole) els.optWhole.checked = appSettings.wholeWord ?? true;
  if (els.optMorph) els.optMorph.checked = appSettings.useMorphology ?? false;
}

function readSettingsFromForm() {
  return {
    caseSensitive: els.optCase.checked,
    wholeWord: els.optWhole.checked,
    useMorphology: els.optMorph.checked,
    matchMode: els.optWhole.checked ? 'whole' : 'substring'
  };
}

function getSearchOptions() {
  const settings = appSettings || getDefaults();
  const query = els.query.value.trim();
  const isPhrase = /\s/.test(query);
  const phraseMode = settings.phraseMode || 'exact';
  return {
    caseSensitive: settings.caseSensitive ?? true,
    wholeWord: isPhrase ? false : (settings.wholeWord ?? true),
    useMorphology: (settings.useMorphology ?? false) || phraseMode === 'morph',
    phraseMode: isPhrase ? phraseMode : 'exact',
    matchMode: settings.matchMode || 'whole'
  };
}

function updateClearButton() {
  const show = Boolean(els.query.value) || searchActiveOnPage;
  els.btnClear.hidden = !show;
}

function updateUI(state) {
  if (!state) return;

  if (state.query !== undefined) {
    els.query.value = state.query;
  }

  const total = state.total ?? 0;
  const current = state.currentIndex ?? -1;
  const displayCurrent = total && current >= 0 ? current + 1 : 0;

  searchActiveOnPage = Boolean(state.searchActive);
  els.counter.textContent = `${displayCurrent} из ${total}`;
  els.btnPrev.disabled = total === 0;
  els.btnNext.disabled = total === 0;
  updateClearButton();
  updateAnnotationStatus(state);

  if (total === 0 && state.query) {
    setStatus('Совпадений не найдено.');
  } else if (total > 0) {
    setStatus('');
  } else if (!state.query) {
    setStatus('');
  }
}

async function loadSettings() {
  const defaults = getDefaults();
  const stored = await chrome.storage.sync.get(defaults);
  appSettings = { ...defaults, ...stored };
  applySettingsToForm();
}

async function saveBasicSettings() {
  const basic = readSettingsFromForm();
  appSettings = { ...(appSettings || getDefaults()), ...basic };
  await chrome.storage.sync.set(basic);
  return sendToActiveTab('UPDATE_SETTINGS');
}

async function getPageSelection() {
  if (!activeTabId) return '';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTabId, allFrames: true },
      func: () => window.getSelection()?.toString()?.trim() || ''
    });
    return results.map((r) => r.result).find(Boolean) || '';
  } catch {
    return '';
  }
}

async function runSearch() {
  const query = els.query.value.trim();
  if (!query) {
    setStatus('Введите слово или фразу.', true);
    return;
  }

  const options = getSearchOptions();
  const state = await sendToActiveTab('SEARCH', { query, options });
  updateUI(state);
}

async function searchSelection() {
  const text = await getPageSelection();
  if (!text) {
    setStatus('Выделите текст на странице.', true);
    return;
  }

  els.query.value = text;
  updateClearButton();
  await runSearch();
}

async function navigate(direction) {
  const state = await sendToActiveTab(direction);
  updateUI(state);
}

async function clearSearch() {
  els.query.value = '';
  searchActiveOnPage = false;
  updateClearButton();

  const state = await sendToActiveTab('CLEAR');
  updateUI(state);
  setStatus('');
  els.query.focus();
}

async function toggleAnnotationMode() {
  const enabled = els.optAnnotationMode.checked;
  await chrome.storage.session.set({ annotationModeEnabled: enabled });
  const state = await sendToActiveTab('ANNOTATION_MODE_TOGGLE', { enabled });
  updateUI(state);
}

function truncateUrl(url, max = 64) {
  if (!url || url.length <= max) return url || '';
  return `${url.slice(0, max - 1)}…`;
}

async function togglePageQr() {
  if (qrPanelVisible) {
    els.qrPanel.hidden = true;
    qrPanelVisible = false;
    els.btnQrPage?.classList.remove('active');
    return;
  }

  if (isRestrictedTabUrl(activeTabUrl)) {
    setStatus('QR недоступен на этой странице.', true);
    return;
  }

  const url = activeTabUrl?.trim();
  if (!url) {
    setStatus('Нет URL для QR-кода.', true);
    return;
  }

  try {
    qrDataUrl = await globalThis.WSQr.generateDataUrl(url, 180);
    els.qrImage.src = qrDataUrl;
    els.qrUrl.textContent = truncateUrl(url);
    els.qrUrl.title = url;
    els.qrPanel.hidden = false;
    qrPanelVisible = true;
    els.btnQrPage?.classList.add('active');
    setStatus('');
  } catch (err) {
    setStatus(err.message || 'Не удалось создать QR-код.', true);
  }
}

async function copyPageUrl() {
  const url = activeTabUrl?.trim();
  if (!url) return;

  try {
    await navigator.clipboard.writeText(url);
    setStatus('Ссылка скопирована.');
  } catch {
    setStatus('Не удалось скопировать ссылку.', true);
  }
}

function downloadQrPng() {
  if (!qrDataUrl) return;

  const link = document.createElement('a');
  link.href = qrDataUrl;
  link.download = 'page-qr.png';
  link.click();
}

function openSettings() {
  const fallbackUrl = chrome.runtime.getURL('settings/settings.html');
  chrome.runtime.openOptionsPage(() => {
    if (chrome.runtime.lastError) {
      chrome.tabs.create({ url: fallbackUrl });
    }
  });
  window.close();
}

function formatArchiveStage(stage) {
  const labels = {
    prepare: 'Подготовка страницы…',
    collect: 'Сбор содержимого…',
    build: 'Создание архива…',
    download: 'Скачивание…',
    done: 'Готово'
  };
  return labels[stage] || stage;
}

async function savePageOffline() {
  if (!activeTabId) return;

  if (isReaderTabActive) {
    setStatus('Сохранение недоступно во вкладке читателя.', true);
    return;
  }

  if (isRestrictedTabUrl(activeTabUrl)) {
    setStatus('Сохранение недоступно на этой странице.', true);
    return;
  }

  if (els.btnArchive) els.btnArchive.disabled = true;
  setStatus('Подготовка страницы…');

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'ARCHIVE_PAGE', tabId: activeTabId }, (result) => {
        const err = chrome.runtime.lastError;
        resolve(err ? { ok: false, message: err.message } : result);
      });
    });

    if (!response?.ok) {
      setStatus(response?.message || 'Не удалось сохранить страницу.', true);
      return;
    }

    const warnings = response.warnings?.length
      ? ` (${response.warnings.length} предупр.)`
      : '';
    setStatus(`Сохранено: ${response.filename}${warnings}`);
  } catch (err) {
    setStatus(err.message || 'Не удалось сохранить страницу.', true);
  } finally {
    if (els.btnArchive) els.btnArchive.disabled = false;
  }
}

async function dockToSidebar() {
  const tab = await getActiveTab();
  const pageInfo = {
    site: formatSite(tab?.url),
    title: tab?.title?.trim() || '—',
    url: tab?.url || ''
  };

  const state = await sendToContent('OPEN_SIDEBAR', { pageInfo }, { ensure: true });
  if (state && !state.error) {
    window.close();
  }
}

async function onOptionChange() {
  const state = await saveBasicSettings();
  if (state && els.query.value.trim()) {
    updateUI(state);
  }
}

function isRestrictedTabUrl(url) {
  if (isReaderTab(url)) return false;
  if (!url) return true;
  return url.startsWith('chrome://')
    || url.startsWith('edge://')
    || url.startsWith('about:')
    || url.startsWith('chrome-extension://')
    || url.startsWith('moz-extension://');
}

async function restorePageState() {
  if (!activeTabId) return;

  if (isReaderTabActive) {
    updateReaderUI();
    const state = await sendToReader('GET_STATE');
    updateUI(state);
    return;
  }

  if (isRestrictedTabUrl(activeTabUrl)) return;

  if (!(await pingContentScript(activeTabId))) {
    return;
  }

  const session = await chrome.storage.session.get({ annotationModeEnabled: false });
  if (els.optAnnotationMode) {
    els.optAnnotationMode.checked = Boolean(session.annotationModeEnabled);
  }

  const state = await sendToContent('GET_STATE');
  updateUI(state);
}

async function init() {
  try {
    WSIcons.hydrate(document);
  } catch (err) {
    console.error('[web-search] popup icons failed:', err);
  }

  try {
    await loadSettings();

    const tab = await getActiveTab();
    updatePageInfo(tab);

    if (!tab?.id) {
      setStatus('Нет активной вкладки.', true);
      return;
    }

    activeTabId = tab.id;
    activeTabUrl = tab.url || '';
    isReaderTabActive = isReaderTab(activeTabUrl);
    updateReaderUI();

    if (isRestrictedTabUrl(tab.url)) {
      setStatus('Поиск недоступен на системных страницах.', true);
      return;
    }

    restorePageState().catch((err) => {
      console.error('[web-search] popup restore failed:', err);
    });
  } catch (err) {
    setStatus(err.message || 'Ошибка инициализации', true);
  }
}

els.btnSearch?.addEventListener('click', runSearch);
els.btnFindSelection?.addEventListener('click', searchSelection);
els.btnQrPage?.addEventListener('click', togglePageQr);
els.btnQrCopy?.addEventListener('click', copyPageUrl);
els.btnQrDownload?.addEventListener('click', downloadQrPng);
els.btnClear?.addEventListener('click', clearSearch);
els.btnPrev?.addEventListener('click', () => navigate('PREV'));
els.btnNext?.addEventListener('click', () => navigate('NEXT'));
els.btnDock?.addEventListener('click', dockToSidebar);
els.btnReader?.addEventListener('click', openReader);
els.btnArchive?.addEventListener('click', savePageOffline);
els.btnReaderExit?.addEventListener('click', exitReaderFromPopup);
els.btnSettings?.addEventListener('click', openSettings);

els.query?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runSearch();
});

els.query?.addEventListener('input', updateClearButton);

[els.optCase, els.optWhole, els.optMorph].forEach((input) => {
  input?.addEventListener('change', onOptionChange);
});

els.optAnnotationMode?.addEventListener('change', toggleAnnotationMode);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'ARCHIVE_PROGRESS') return;
  if (message.tabId != null && message.tabId !== activeTabId) return;
  if (message.stage === 'done' && message.entry?.filename) return;
  if (message.stage) {
    setStatus(formatArchiveStage(message.stage));
  }
});

function startInit() {
  window.addEventListener('error', (event) => {
    setStatus(event.message || 'Ошибка интерфейса', true);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason?.message || String(event.reason || '');
    if (message) setStatus(message, true);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((err) => {
        setStatus(err.message || 'Ошибка инициализации', true);
      });
    });
  } else {
    init().catch((err) => {
      setStatus(err.message || 'Ошибка инициализации', true);
    });
  }
}

startInit();
