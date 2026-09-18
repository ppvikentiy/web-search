/**
 * Persistent annotation records with LRU eviction and URL normalization.
 */
globalThis.WSAnnotationStorage = globalThis.WSAnnotationStorage ?? (() => {
  const PREFIX = 'annotations:';
  const INDEX_KEY = 'annotationsIndex';
  const MAX_PAGES = 300;
  const MAX_BYTES = 5 * 1024 * 1024;
  const TRACKING_PARAMS = new Set([
    'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
    'yclid', 'ysclid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi',
    'igshid', 'twclid', 'msclkid', 'ttclid'
  ]);

  function normalizePageUrl(rawUrl) {
    const value = String(rawUrl || '').split('#')[0];
    if (!value) return '';
    try {
      const parsed = new URL(value);
      const keys = [...parsed.searchParams.keys()];
      for (const key of keys) {
        const lower = key.toLowerCase();
        if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) {
          parsed.searchParams.delete(key);
        }
      }
      return parsed.href;
    } catch {
      return value;
    }
  }

  function storageKey(url) {
    return `${PREFIX}${normalizePageUrl(url)}`;
  }

  function estimateSize(value) {
    try {
      return new Blob([JSON.stringify(value)]).size;
    } catch {
      return JSON.stringify(value || '').length * 2;
    }
  }

  async function readIndex() {
    const stored = await chrome.storage.local.get({ [INDEX_KEY]: {} });
    const index = stored[INDEX_KEY];
    return index && typeof index === 'object' ? index : {};
  }

  async function writeIndex(index) {
    await chrome.storage.local.set({ [INDEX_KEY]: index });
  }

  async function evictIfNeeded(index, incomingKey, incomingBytes) {
    const entries = Object.entries(index).map(([key, meta]) => ({
      key,
      updatedAt: meta?.updatedAt || 0,
      size: meta?.size || 0
    }));

    let total = entries.reduce((sum, row) => sum + (row.size || 0), 0) + incomingBytes;
    const existing = index[incomingKey];
    if (existing) total -= existing.size || 0;

    entries.sort((a, b) => a.updatedAt - b.updatedAt);
    const toRemove = [];

    for (const row of entries) {
      if (row.key === incomingKey) continue;
      const overPages = entries.length - toRemove.length >= MAX_PAGES;
      const overBytes = total > MAX_BYTES;
      if (!overPages && !overBytes) break;
      toRemove.push(row.key);
      total -= row.size || 0;
    }

    if (toRemove.length) {
      await chrome.storage.local.remove(toRemove);
      for (const key of toRemove) {
        delete index[key];
      }
    }
  }

  async function persist(url, payload) {
    const key = storageKey(url);
    const record = { ...payload, url: normalizePageUrl(url), updatedAt: payload.updatedAt || Date.now() };
    const size = estimateSize(record);
    const index = await readIndex();
    await evictIfNeeded(index, key, size);
    await chrome.storage.local.set({ [key]: record });
    index[key] = { updatedAt: record.updatedAt, size };
    await writeIndex(index);
    return key;
  }

  async function load(url) {
    const normalizedKey = storageKey(url);
    const rawKey = `${PREFIX}${String(url || '').split('#')[0]}`;
    const stored = await chrome.storage.local.get([normalizedKey, rawKey]);
    return stored[normalizedKey] || stored[rawKey] || null;
  }

  async function remove(url) {
    const key = storageKey(url);
    const rawKey = `${PREFIX}${String(url || '').split('#')[0]}`;
    await chrome.storage.local.remove([key, rawKey]);
    const index = await readIndex();
    delete index[key];
    delete index[rawKey];
    await writeIndex(index);
  }

  async function stats() {
    const index = await readIndex();
    const pages = Object.keys(index).length;
    const totalBytes = Object.values(index).reduce((sum, meta) => sum + (meta?.size || 0), 0);
    return { pages, totalBytes };
  }

  async function clearAll() {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((key) => key.startsWith(PREFIX) || key === INDEX_KEY);
    if (keys.length) {
      await chrome.storage.local.remove(keys);
    }
    return { ok: true, removed: keys.length };
  }

  return {
    PREFIX,
    INDEX_KEY,
    MAX_PAGES,
    MAX_BYTES,
    normalizePageUrl,
    storageKey,
    persist,
    load,
    remove,
    stats,
    clearAll
  };
})();

var WSAnnotationStorage = globalThis.WSAnnotationStorage;
