/** IndexedDB cache for offline archive ZIP bytes (enables in-browser viewing). */
globalThis.WSArchiveCache = globalThis.WSArchiveCache ?? (() => {
  const DB_NAME = 'wsArchiveCache';
  const DB_VERSION = 1;
  const STORE = 'archives';
  const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
        }
      };
    });
  }

  function txStore(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async function listMeta() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const store = txStore(db, 'readonly');
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const rows = (request.result || []).map(({ id, savedAt, sizeBytes }) => ({
          id,
          savedAt: savedAt || 0,
          sizeBytes: sizeBytes || 0
        }));
        resolve(rows);
      };
    });
  }

  async function evictIfNeeded(incomingBytes) {
    const rows = await listMeta();
    let total = rows.reduce((sum, row) => sum + (row.sizeBytes || 0), 0) + incomingBytes;
    if (total <= MAX_TOTAL_BYTES) return;

    rows.sort((a, b) => a.savedAt - b.savedAt);
    const db = await openDb();

    for (const row of rows) {
      if (total <= MAX_TOTAL_BYTES) break;
      await new Promise((resolve, reject) => {
        const request = txStore(db, 'readwrite').delete(row.id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
      total -= row.sizeBytes || 0;
    }
  }

  async function put(id, zipBytes, meta = {}) {
    const bytes = WSArchiveBytes?.normalizeZipBytes?.(zipBytes) ?? (
      zipBytes instanceof Uint8Array ? zipBytes.slice() : new Uint8Array(zipBytes || [])
    );
    if (!id || !bytes?.byteLength) return false;
    await evictIfNeeded(bytes.byteLength);

    const db = await openDb();
    const record = {
      id,
      zipBytes: bytes,
      savedAt: meta.savedAt || Date.now(),
      sizeBytes: bytes.byteLength,
      title: meta.title || '',
      filename: meta.filename || ''
    };

    return new Promise((resolve, reject) => {
      const request = txStore(db, 'readwrite').put(record);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  async function get(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = txStore(db, 'readonly').get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const record = request.result || null;
        if (!record?.zipBytes) {
          resolve(record);
          return;
        }
        const zipBytes = WSArchiveBytes?.normalizeZipBytes?.(record.zipBytes);
        resolve(zipBytes ? { ...record, zipBytes } : record);
      };
    });
  }

  async function remove(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = txStore(db, 'readwrite').delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  async function clearAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = txStore(db, 'readwrite').clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  return { put, get, remove, clearAll, listMeta, MAX_TOTAL_BYTES };
})();

var WSArchiveCache = globalThis.WSArchiveCache;
