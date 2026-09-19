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

  function bytesToBase64(bytes) {
    const normalized = normalizeZipBytes(bytes);
    if (!normalized?.byteLength) return '';
    const chunkSize = 0x8000;
    const parts = [];
    for (let i = 0; i < normalized.length; i += chunkSize) {
      parts.push(String.fromCharCode.apply(null, normalized.subarray(i, i + chunkSize)));
    }
    return btoa(parts.join(''));
  }

  function base64ToBytes(base64) {
    if (typeof base64 !== 'string' || !base64) return null;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  return { normalizeZipBytes, isZipBytes, bytesToBase64, base64ToBytes };
})();

var WSArchiveBytes = globalThis.WSArchiveBytes;
