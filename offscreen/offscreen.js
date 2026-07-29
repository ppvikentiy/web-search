/**
 * Offscreen document for QR decode and blob downloads.
 */
function rawBufferToBytes(raw) {
  if (!raw) return null;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (typeof raw.byteLength === 'number') return new Uint8Array(raw);
  if (Array.isArray(raw)) return Uint8Array.from(raw);
  if (typeof raw === 'object') {
    const keys = Object.keys(raw).filter((key) => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b);
    if (keys.length) {
      const bytes = new Uint8Array(keys.length);
      for (let i = 0; i < keys.length; i++) bytes[i] = Number(raw[keys[i]]) & 0xff;
      return bytes;
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'QR_DECODE_BLOB') {
    (async () => {
      try {
        const buffer = message.buffer;
        if (!buffer) {
          sendResponse({ ok: false, error: 'Нет данных изображения' });
          return;
        }

        const mimeType = message.mimeType || 'image/png';
        const blob = new Blob([buffer], { type: mimeType });
        const data = await globalThis.WSQr.decodeFromBlob(blob);

        if (data) {
          sendResponse({ ok: true, data });
        } else {
          sendResponse({ ok: false, error: 'not_found' });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Ошибка декодирования' });
      }
    })();
    return true;
  }

  if (message.type === 'CREATE_BLOB_URL') {
    try {
      let bytes = null;

      if (typeof message.base64 === 'string' && message.base64) {
        const binary = atob(message.base64);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } else {
        bytes = rawBufferToBytes(message.zipBytes ?? message.buffer);
      }

      if (!bytes || !bytes.length) {
        sendResponse({ ok: false, error: 'invalid_buffer' });
        return true;
      }

      const blob = new Blob([bytes], {
        type: message.mimeType || 'application/octet-stream'
      });
      const objectUrl = URL.createObjectURL(blob);
      sendResponse({ ok: true, objectUrl });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || 'blob_failed' });
    }
    return true;
  }

  if (message.type === 'REVOKE_BLOB_URL') {
    try {
      if (message.objectUrl) URL.revokeObjectURL(message.objectUrl);
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || 'revoke_failed' });
    }
    return true;
  }

  return false;
});
