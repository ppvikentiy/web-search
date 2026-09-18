/** Journal of downloaded offline page archives (metadata only). */
globalThis.WSArchiveJournal = globalThis.WSArchiveJournal ?? (() => {
  const STORAGE_KEY = 'archiveJournal';
  const MAX_ENTRIES = 100;

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `archive-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  async function list() {
    const stored = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
    const entries = stored[STORAGE_KEY];
    return Array.isArray(entries) ? entries.slice().sort((a, b) => b.savedAt - a.savedAt) : [];
  }

  async function add(entry, maxEntries = MAX_ENTRIES) {
    const entries = await list();
    const record = {
      id: entry.id || generateId(),
      title: entry.title || 'Без названия',
      url: entry.url || '',
      savedAt: entry.savedAt || Date.now(),
      filename: entry.filename || 'page.zip',
      sizeBytes: entry.sizeBytes || 0,
      warnings: Array.isArray(entry.warnings) ? entry.warnings.slice(0, 20) : [],
      downloadId: entry.downloadId ?? null
    };
    entries.unshift(record);
    const trimmed = entries.slice(0, Math.max(1, maxEntries));
    await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
    return record;
  }

  async function get(id) {
    const entries = await list();
    return entries.find((item) => item.id === id) || null;
  }

  async function remove(id) {
    const entries = await list();
    const next = entries.filter((item) => item.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return { ok: true };
  }

  async function stats() {
    const entries = await list();
    const totalBytes = entries.reduce((sum, item) => sum + (item.sizeBytes || 0), 0);
    return { count: entries.length, totalBytes };
  }

  async function clearAll() {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    return { ok: true };
  }

  return { list, get, add, remove, stats, clearAll, STORAGE_KEY };
})();

var WSArchiveJournal = globalThis.WSArchiveJournal;
