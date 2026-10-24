// MV3 service workers reject importScripts paths that contain '..'.
// Use extension-root absolute paths instead.
importScripts(
  '/lib/defaults.js',
  '/lib/settings-storage.js',
  '/lib/injection-manifest.js'
);

const READER_PAYLOAD_PREFIX = 'reader-payload:';

const frameNonces = new Map();

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
    id: 'ws-open-reader',
    title: 'Открыть в читателе',
    contexts: ['page']
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

    installingContextMenus = null;
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

const TOP_FRAME = { frameId: 0 };

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, TOP_FRAME);
    return response?.ok && response?.version === WS_CONTENT_SCRIPT_VERSION;
  } catch {
    return false;
  }
}

async function injectStyles(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: WS_CSS_FILES
    });
  } catch {
    /* styles may already be injected */
  }
}

async function ensureContentScript(tabId) {
  await injectStyles(tabId);

  if (await pingContentScript(tabId)) {
    return true;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: WS_CONTENT_FILES
    });

    return await pingContentScript(tabId);
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
      frameNonces.delete(tabId);
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab may already be closed */
      }
    }
  }
}

function getFrameNonce(tabId) {
  if (tabId == null) return null;
  if (!frameNonces.has(tabId)) {
    const nonce = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    frameNonces.set(tabId, nonce);
  }
  return frameNonces.get(tabId);
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

    const stored = await WSSettingsStorage.get(WS_DEFAULTS);
    const wholeWord = stored.wholeWord ?? true;

    try {
      await sendToTab(tab.id, {
        type: 'SEARCH',
        query,
        options: {
          caseSensitive: stored.caseSensitive ?? true,
          wholeWord,
          useMorphology: (stored.useMorphology ?? false) || stored.phraseMode === 'morph',
          phraseMode: stored.phraseMode || 'exact',
          matchMode: wholeWord ? 'whole' : 'substring'
        }
      }, info.frameId ?? 0);
    } catch (err) {
      console.error('[web-search] context menu search failed:', err);
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
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  frameNonces.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    frameNonces.delete(tabId);
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
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GET_FRAME_NONCE') {
    sendResponse({ ok: true, nonce: getFrameNonce(sender.tab?.id) });
    return true;
  }

  return false;
});
