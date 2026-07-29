/** Normalize binary archive payloads from messages, IndexedDB, or file reads. */
globalThis.WSArchiveBytes = globalThis.WSArchiveBytes ?? (() => {
  function normalizeZipBytes(raw) {
    if (!raw) return null;

    if (raw instanceof Uint8Array) {
      return raw.slice();
    }

    if (raw instanceof ArrayBuffer) {
      return new Uint8Array(raw);
    }

    if (ArrayBuffer.isView(raw)) {
      return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    }

    if (Array.isArray(raw)) {
      return new Uint8Array(raw);
    }

    if (typeof raw === 'object') {
      if (raw.type === 'Buffer' && Array.isArray(raw.data)) {
        return new Uint8Array(raw.data);
      }

      const keys = Object.keys(raw)
        .filter((key) => /^\d+$/.test(key))
        .map(Number)
        .sort((a, b) => a - b);

      if (keys.length) {
        const bytes = new Uint8Array(keys.length);
        for (let i = 0; i < keys.length; i += 1) {
          bytes[i] = Number(raw[keys[i]]) & 0xff;
        }
        return bytes;
      }
    }

    return null;
  }

  function isZipBytes(bytes) {
    return bytes instanceof Uint8Array
      && bytes.byteLength >= 4
      && bytes[0] === 0x50
      && bytes[1] === 0x4b;
  }

  function toArrayBuffer(bytes) {
    const normalized = normalizeZipBytes(bytes);
    if (!normalized?.byteLength) return null;
    if (normalized.byteOffset === 0 && normalized.byteLength === normalized.buffer.byteLength) {
      return normalized.buffer;
    }
    return normalized.slice().buffer;
  }

  return { normalizeZipBytes, isZipBytes, toArrayBuffer };
})();

var WSArchiveBytes = globalThis.WSArchiveBytes;
