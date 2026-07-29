// MV3 service workers reject importScripts paths that contain '..'.
// Use extension-root absolute paths instead.
importScripts(
  '/lib/defaults.js',
  '/lib/fflate.min.js',
  '/lib/archive-bytes.js',
  '/lib/offline-archive.js',
  '/lib/archive-journal.js',
  '/lib/archive-cache.js'
);

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
  'lib/tokens.css',
  'lib/icons.css',
  'content/highlights.css',
  'content/annotations.css',
  'content/dictionary.css',
  'content/qr-decode.css',
  'content/sidebar.css'
];

const READER_PAYLOAD_PREFIX = 'reader-payload:';
const OFFSCREEN_URL = 'offscreen/offscreen.html';

const injectedTabs = new Set();
let creatingOffscreen = null;

function readerPayloadKey(id) {
  return `${READER_PAYLOAD_PREFIX}${id}`;
}

function isRestrictedTabUrl(url) {
  if (!url) return true;
  return url.startsWith('chrome://')
    || url.startsWith('edge://')
    || url.startsWith('about:')
    || url.startsWith('chrome-extension://')
    || url.startsWith('moz-extension://');
}

async function cleanupOldReaderPayloads(keepKey) {
  await Promise.allSettled([
    cleanupArea(chrome.storage.session, keepKey),
    cleanupArea(chrome.storage.local, keepKey)
  ]);
}

async function cleanupArea(area, keepKey) {
  try {
    const all = await area.get(null);
    const keys = Object.keys(all).filter(
      (key) => key.startsWith(READER_PAYLOAD_PREFIX) && key !== keepKey
    );
    if (keys.length) await area.remove(keys);
  } catch { /* ignore */ }
}

async function saveReaderPayload(key, payload) {
  let sessionError = null;

  try {
    await chrome.storage.session.set({ [key]: payload });
    return;
  } catch (err) {
    sessionError = err;
  }

  try {
    await chrome.storage.local.set({ [key]: payload });
    return;
  } catch (localErr) {
    const msg = localErr?.message || sessionError?.message || 'Storage quota exceeded';
    throw new Error(msg);
  }
}

function isReaderTabUrl(url) {
  return Boolean(url?.includes('/reader/reader.html'));
}

async function syncDictionaryContextMenu(annotationModeEnabled) {
  try {
    await chrome.contextMenus.update('ws-dictionary-lookup', {
      enabled: !annotationModeEnabled
    });
  } catch {
    /* menu may not exist yet */
  }
}

async function initDictionaryContextMenuState() {
  const session = await chrome.storage.session.get({ annotationModeEnabled: false });
  await syncDictionaryContextMenu(Boolean(session.annotationModeEnabled));
}

const CONTEXT_MENU_ITEMS = [
  {
    id: 'ws-search-selection',
    title: 'Найти на странице',
    contexts: ['selection']
  },
  {
    id: 'ws-annotate-selection',
    title: 'Аннотировать',
    contexts: ['selection']
  },
  {
    id: 'ws-dictionary-lookup',
    title: 'Найти в словаре',
    contexts: ['selection']
  },
  {
    id: 'ws-open-reader',
    title: 'Открыть в читателе',
    contexts: ['page']
  },
  {
    id: 'ws-decode-qr',
    title: 'Сканировать QR-код',
    contexts: ['image']
  }
];

let installingContextMenus = null;

async function upsertContextMenuItem(item) {
  const props = {
    title: item.title,
    contexts: item.contexts
  };

  try {
    await chrome.contextMenus.update(item.id, props);
    return;
  } catch {
    /* item does not exist yet */
  }

  try {
    await chrome.contextMenus.create(item);
  } catch (err) {
    const msg = err?.message || String(err);
    if (/duplicate id|already exists/i.test(msg)) {
      await chrome.contextMenus.update(item.id, props);
      return;
    }
    throw err;
  }
}

async function installContextMenus() {
  if (installingContextMenus) {
    return installingContextMenus;
  }

  installingContextMenus = (async () => {
    for (const item of CONTEXT_MENU_ITEMS) {
      try {
        await upsertContextMenuItem(item);
      } catch (err) {
        console.error(`[web-search] context menu item "${item.id}" failed:`, err?.message || err);
      }
    }

    try {
      await initDictionaryContextMenuState();
    } catch (err) {
      console.error('[web-search] context menu state sync failed:', err?.message || err);
    } finally {
      installingContextMenus = null;
    }
  })();

  return installingContextMenus;
}

chrome.runtime.onInstalled.addListener(() => {
  installContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  installContextMenus();
});

installContextMenus();

async function ensureOffscreenDocument() {
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);

  creatingOffscreen = (async () => {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });

    if (!existing.length) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['BLOBS'],
        justification: 'Decode QR codes and download offline page archives'
      });
    }
  })();

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function fetchImageBuffer(srcUrl) {
  const response = await fetch(srcUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const mimeType = response.headers.get('content-type') || 'image/png';
  const buffer = await response.arrayBuffer();
  return { buffer, mimeType };
}

async function decodeQrViaOffscreen(srcUrl) {
  const { buffer, mimeType } = await fetchImageBuffer(srcUrl);
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'QR_DECODE_BLOB',
      buffer,
      mimeType
    }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (response?.ok && response.data) {
        resolve(response.data);
        return;
      }
      reject(new Error(response?.error || 'not_found'));
    });
  });
}

const TOP_FRAME = { frameId: 0 };

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, TOP_FRAME);
    return response?.ok && response?.version === CONTENT_SCRIPT_VERSION;
  } catch {
    return false;
  }
}

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

async function ensureContentScript(tabId) {
  await injectStyles(tabId);

  if (await pingContentScript(tabId)) {
    injectedTabs.add(tabId);
    return true;
  }
  injectedTabs.delete(tabId);

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: CONTENT_FILES
    });

    const alive = await pingContentScript(tabId);
    if (alive) injectedTabs.add(tabId);
    return alive;
  } catch (err) {
    console.error('[web-search] injection failed:', err);
    return false;
  }
}

async function sendToTab(tabId, message, frameId = 0) {
  const ready = await ensureContentScript(tabId);
  if (!ready) {
    throw new Error('Не удалось подключиться к странице');
  }
  return chrome.tabs.sendMessage(tabId, message, { frameId });
}

async function sendDictionaryLookup(tab, info) {
  const text = (info.selectionText || '').trim();
  if (!text) return;

  const session = await chrome.storage.session.get({ annotationModeEnabled: false });
  if (session.annotationModeEnabled) return;

  const payload = { type: 'DICTIONARY_LOOKUP', text };

  if (isReaderTabUrl(tab.url)) {
    return chrome.runtime.sendMessage({ ...payload, targetTabId: tab.id });
  }

  return sendToTab(tab.id, payload, info.frameId ?? 0);
}

async function openReaderTab(id, payload, sourceTabId) {
  if (!id || !payload) {
    throw new Error('Нет данных статьи');
  }

  const key = readerPayloadKey(id);
  const fullPayload = { ...payload, id, sourceTabId: sourceTabId ?? null };

  await cleanupOldReaderPayloads(key);
  await saveReaderPayload(key, fullPayload);

  const url = chrome.runtime.getURL(`reader/reader.html?id=${encodeURIComponent(id)}`);
  await chrome.tabs.create({ url });
  return { ok: true };
}

async function exitReaderTab(sourceTabId, readerTabId) {
  if (sourceTabId) {
    try {
      await chrome.tabs.update(sourceTabId, { active: true });
    } catch {
      /* source tab may be closed */
    }
  }

  if (readerTabId) {
    try {
      await chrome.tabs.remove(readerTabId);
    } catch {
      /* reader tab may already be closed */
    }
  }

  return { ok: true };
}

const READER_EXTRACT_TIMEOUT_MS = 28000;

function waitForTabComplete(tabId, timeoutMs = READER_EXTRACT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('timeout'));
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        finish(resolve);
      }
    };

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        finish(resolve);
        return;
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    }).catch((err) => {
      finish(reject, err);
    });
  });
}

async function extractArticleFromUrl(url) {
  if (!url || isRestrictedTabUrl(url)) {
    return { ok: false, error: 'invalid_url', message: 'Недопустимый адрес ссылки.' };
  }

  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    await waitForTabComplete(tabId);
    const response = await sendToTab(tabId, { type: 'READER_EXTRACT' });
    if (!response) {
      return { ok: false, error: 'extract_failed', message: 'Не удалось извлечь статью.' };
    }
    return response;
  } catch (err) {
    if (err.message === 'timeout') {
      return {
        ok: false,
        error: 'timeout',
        message: 'Страница загружается слишком долго.'
      };
    }
    return {
      ok: false,
      error: 'extract_failed',
      message: err.message || 'Не удалось извлечь статью.'
    };
  } finally {
    if (tabId != null) {
      injectedTabs.delete(tabId);
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab may already be closed */
      }
    }
  }
}

function broadcastArchiveProgress(payload) {
  try {
    chrome.runtime.sendMessage({ type: 'ARCHIVE_PROGRESS', ...payload }).catch(() => {});
  } catch { /* ignore */ }
}

async function offscreenRequest(message) {
  await ensureOffscreenDocument();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (response?.ok) resolve(response);
      else reject(new Error(response?.error || 'offscreen_failed'));
    });
  });
}

function waitForDownloadComplete(downloadId, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      finish(new Error('download_timeout'));
    }, timeoutMs);

    function onChanged(delta) {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') {
        finish();
      } else if (delta.state?.current === 'interrupted') {
        finish(new Error(delta.error?.current || 'download_interrupted'));
      }
    }

    chrome.downloads.onChanged.addListener(onChanged);

    chrome.downloads.search({ id: downloadId }).then((items) => {
      const item = items[0];
      if (!item) return;
      if (item.state === 'complete') finish();
      else if (item.state === 'interrupted') finish(new Error(item.error || 'download_interrupted'));
    }).catch(() => {});
  });
}

function bytesToBase64(bytes) {
  const normalized = WSArchiveBytes.normalizeZipBytes(bytes);
  if (!normalized?.byteLength) return '';
  const chunkSize = 0x8000;
  const parts = [];
  for (let i = 0; i < normalized.length; i += chunkSize) {
    parts.push(String.fromCharCode.apply(null, normalized.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(''));
}

async function downloadBlobViaOffscreen(bytes, filename, mimeType = 'application/zip') {
  const normalized = WSArchiveBytes.normalizeZipBytes(bytes);
  if (!normalized?.byteLength) {
    throw new Error('Пустой файл архива');
  }

  const { objectUrl } = await offscreenRequest({
    type: 'CREATE_BLOB_URL',
    base64: bytesToBase64(normalized),
    mimeType
  });

  let downloadId;
  try {
    downloadId = await chrome.downloads.download({
      url: objectUrl,
      filename,
      saveAs: false
    });
    await waitForDownloadComplete(downloadId);
  } finally {
    await offscreenRequest({ type: 'REVOKE_BLOB_URL', objectUrl }).catch(() => {});
  }

  return { downloadId };
}

async function archivePage(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (isRestrictedTabUrl(tab.url) || isReaderTabUrl(tab.url)) {
    return {
      ok: false,
      error: 'restricted',
      message: 'Сохранение недоступно для этой вкладки.'
    };
  }

  broadcastArchiveProgress({ tabId, stage: 'prepare' });
  const prepare = await sendToTab(tabId, { type: 'ARCHIVE_PREPARE' });
  if (!prepare?.ok) {
    return {
      ok: false,
      error: prepare?.error || 'prepare_failed',
      message: 'Не удалось подготовить страницу.'
    };
  }

  broadcastArchiveProgress({ tabId, stage: 'collect' });
  const collected = await sendToTab(tabId, { type: 'ARCHIVE_COLLECT' });
  if (!collected?.ok || !collected.data) {
    return {
      ok: false,
      error: collected?.error || 'collect_failed',
      message: 'Не удалось собрать страницу.'
    };
  }

  broadcastArchiveProgress({ tabId, stage: 'build' });
  const settings = await chrome.storage.sync.get(WS_DEFAULTS);
  const built = await WSOfflineArchive.buildZip(collected.data, settings);

  broadcastArchiveProgress({ tabId, stage: 'download' });
  const { downloadId } = await downloadBlobViaOffscreen(
    built.zipBytes,
    built.filename,
    'application/zip'
  );

  const entry = await WSArchiveJournal.add({
    title: collected.data.title,
    url: collected.data.url,
    filename: built.filename,
    sizeBytes: built.sizeBytes,
    warnings: built.warnings,
    downloadId
  }, settings.archiveJournalMaxEntries);

  await WSArchiveCache.put(entry.id, built.zipBytes, {
    savedAt: entry.savedAt,
    title: entry.title,
    filename: entry.filename
  }).catch(() => {});

  broadcastArchiveProgress({ tabId, stage: 'done', entry });
  return {
    ok: true,
    filename: built.filename,
    sizeBytes: built.sizeBytes,
    warnings: built.warnings,
    entry
  };
}

function normalizeArchiveUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

async function archivePageFromUrl(rawUrl) {
  const url = normalizeArchiveUrl(rawUrl);
  if (!url || isRestrictedTabUrl(url) || isReaderTabUrl(url)) {
    return {
      ok: false,
      error: 'invalid_url',
      message: 'Укажите корректный адрес страницы (http или https).'
    };
  }

  const settings = await chrome.storage.sync.get(WS_DEFAULTS);
  let tabId = null;

  try {
    broadcastArchiveProgress({ stage: 'loading' });
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    await waitForTabComplete(tabId, settings.archivePrepareTimeoutMs || WS_DEFAULTS.archivePrepareTimeoutMs);
    return await archivePage(tabId);
  } catch (err) {
    if (err?.message === 'timeout') {
      return {
        ok: false,
        error: 'timeout',
        message: 'Страница загружается слишком долго.'
      };
    }
    return {
      ok: false,
      error: 'archive_failed',
      message: err?.message || 'Не удалось сохранить страницу.'
    };
  } finally {
    if (tabId != null) {
      injectedTabs.delete(tabId);
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab may already be closed */
      }
    }
  }
}

function imageUrlFromContext(info) {
  if (info.srcUrl) return info.srcUrl;

  const linkUrl = info.linkUrl || '';
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)(\?|#|$)/i.test(linkUrl)) {
    return linkUrl;
  }

  return null;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'ws-open-reader') {
    if (isRestrictedTabUrl(tab.url)) return;

    try {
      await sendToTab(tab.id, { type: 'READER_OPEN' });
    } catch (err) {
      console.error('[web-search] context menu reader failed:', err);
    }
    return;
  }

  if (info.menuItemId === 'ws-search-selection') {
    const query = (info.selectionText || '').trim();
    if (!query) return;

    const stored = await chrome.storage.sync.get(WS_DEFAULTS);
    const isPhrase = /\s/.test(query);

    try {
      await sendToTab(tab.id, {
        type: 'SEARCH',
        query,
        options: {
          caseSensitive: stored.caseSensitive ?? true,
          wholeWord: isPhrase ? false : (stored.wholeWord ?? true),
          useMorphology: (stored.useMorphology ?? false) || stored.phraseMode === 'morph',
          phraseMode: isPhrase ? (stored.phraseMode || 'exact') : 'exact',
          matchMode: stored.matchMode || 'whole'
        }
      }, info.frameId ?? 0);
    } catch (err) {
      console.error('[web-search] context menu search failed:', err);
    }
    return;
  }

  if (info.menuItemId === 'ws-dictionary-lookup') {
    try {
      await sendDictionaryLookup(tab, info);
    } catch (err) {
      console.error('[web-search] context menu dictionary lookup failed:', err);
    }
    return;
  }

  if (info.menuItemId === 'ws-annotate-selection') {
    const text = (info.selectionText || '').trim();
    if (!text) return;

    try {
      await sendToTab(tab.id, {
        type: 'ANNOTATE_SELECTION',
        autoEnable: true,
        text
      }, info.frameId ?? 0);
    } catch (err) {
      console.error('[web-search] context menu annotate failed:', err);
    }
    return;
  }

  if (info.menuItemId === 'ws-decode-qr') {
    const srcUrl = imageUrlFromContext(info);
    if (!srcUrl) return;

    try {
      await sendToTab(tab.id, {
        type: 'QR_DECODE_IMAGE',
        srcUrl
      }, info.frameId ?? 0);
    } catch (err) {
      console.error('[web-search] context menu QR decode failed:', err);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    injectedTabs.delete(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ENSURE_CONTENT_SCRIPT') {
    ensureContentScript(message.tabId)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'FORWARD_TO_TAB') {
    sendToTab(message.tabId, message.payload)
      .then((response) => sendResponse(response))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'OPEN_READER_TAB') {
    openReaderTab(message.id, message.payload, sender.tab?.id)
      .then((response) => sendResponse(response))
      .catch((err) => sendResponse({
        ok: false,
        error: 'storage_failed',
        message: err?.message || 'Не удалось сохранить статью для чтения.'
      }));
    return true;
  }

  if (message.type === 'READER_EXIT') {
    if (message.targetTabId != null) {
      return false;
    }
    exitReaderTab(message.sourceTabId, message.readerTabId ?? sender.tab?.id)
      .then((response) => sendResponse(response))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'READER_EXTRACT_URL') {
    extractArticleFromUrl(message.url)
      .then((response) => sendResponse(response))
      .catch((err) => sendResponse({
        ok: false,
        error: 'extract_failed',
        message: err?.message || 'Не удалось извлечь статью.'
      }));
    return true;
  }

  if (message.type === 'ANNOTATION_MODE_CHANGED') {
    syncDictionaryContextMenu(Boolean(message.enabled))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'QR_FETCH_IMAGE') {
    fetchImageBuffer(message.srcUrl)
      .then(({ buffer, mimeType }) => sendResponse({ ok: true, buffer, mimeType }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'QR_DECODE_OFFSCREEN') {
    decodeQrViaOffscreen(message.srcUrl)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'ARCHIVE_PAGE') {
    archivePage(message.tabId)
      .then((response) => sendResponse(response))
      .catch((err) => sendResponse({
        ok: false,
        error: 'archive_failed',
        message: err?.message || 'Не удалось сохранить страницу.'
      }));
    return true;
  }

  if (message.type === 'ARCHIVE_PAGE_URL') {
    archivePageFromUrl(message.url)
      .then((response) => sendResponse(response))
      .catch((err) => sendResponse({
        ok: false,
        error: 'archive_failed',
        message: err?.message || 'Не удалось сохранить страницу.'
      }));
    return true;
  }

  if (message.type === 'ARCHIVE_JOURNAL_LIST') {
    WSArchiveJournal.list()
      .then((entries) => sendResponse({ ok: true, entries }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'ARCHIVE_JOURNAL_DELETE') {
    WSArchiveJournal.remove(message.id)
      .then(async (response) => {
        await WSArchiveCache.remove(message.id).catch(() => {});
        sendResponse(response);
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'ARCHIVE_JOURNAL_CLEAR') {
    Promise.all([
      WSArchiveJournal.clearAll(),
      WSArchiveCache.clearAll().catch(() => {})
    ])
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'ARCHIVE_JOURNAL_GET') {
    WSArchiveJournal.get(message.id)
      .then((entry) => sendResponse({ ok: !!entry, entry }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'ARCHIVE_GET_ZIP') {
    WSArchiveCache.get(message.id)
      .then((record) => {
        const zipBytes = WSArchiveBytes.normalizeZipBytes(record?.zipBytes);
        if (!zipBytes?.byteLength) {
          sendResponse({ ok: false, error: 'not_cached' });
          return;
        }
        sendResponse({
          ok: true,
          zipBytes,
          title: record.title,
          filename: record.filename
        });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'ARCHIVE_OPEN') {
    const viewerUrl = chrome.runtime.getURL(`archive/viewer.html?id=${encodeURIComponent(message.id || '')}`);
    chrome.tabs.create({ url: viewerUrl })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'ARCHIVE_OPEN_ZIP') {
    (async () => {
      const bytes = WSArchiveBytes.normalizeZipBytes(message.zipBytes ?? message.zipBuffer);
      if (!bytes?.byteLength) {
        sendResponse({ ok: false, error: 'Пустой файл архива' });
        return;
      }
      if (!WSArchiveBytes.isZipBytes(bytes)) {
        sendResponse({ ok: false, error: 'Повреждённый архив: файл не является ZIP' });
        return;
      }

      const id = message.id || `pick-${crypto.randomUUID()}`;
      const filename = message.filename || 'page.zip';
      await WSArchiveCache.put(id, bytes, {
        savedAt: Date.now(),
        title: filename.replace(/\.zip$/i, '') || 'Офлайн-страница',
        filename
      });

      const viewerUrl = chrome.runtime.getURL(`archive/viewer.html?id=${encodeURIComponent(id)}`);
      await chrome.tabs.create({ url: viewerUrl });
      sendResponse({ ok: true, id });
    })().catch((err) => sendResponse({ ok: false, error: err?.message || 'Не удалось открыть архив' }));
    return true;
  }

  if (message.type === 'ARCHIVE_JOURNAL_STATS') {
    WSArchiveJournal.stats()
      .then((stats) => sendResponse({ ok: true, stats }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});
