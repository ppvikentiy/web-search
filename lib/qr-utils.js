/**
 * QR encode/decode helpers for popup, content scripts, and offscreen document.
 */
globalThis.WSQr = (() => {
  const URL_RE = /^(https?:\/\/|mailto:|tel:|sms:|geo:|ftp:\/\/|file:\/\/)/i;

  function looksLikeUrl(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (URL_RE.test(t)) return true;
    try {
      const u = new URL(t.startsWith('www.') ? `https://${t}` : t);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function normalizeUrl(text) {
    const t = String(text || '').trim();
    if (/^www\./i.test(t)) return `https://${t}`;
    return t;
  }

  function generateDataUrl(text, size = 256) {
    const payload = String(text || '').trim();
    if (!payload) throw new Error('Пустая строка для QR-кода');

    if (typeof QRCodeLib === 'undefined' || !QRCodeLib.toDataURL) {
      throw new Error('Библиотека QR-кода недоступна');
    }

    return QRCodeLib.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: size,
      color: { dark: '#000000', light: '#ffffff' }
    });
  }

  function decodeImageData(imageData) {
    if (typeof jsQR !== 'function') {
      throw new Error('Библиотека jsQR недоступна');
    }

    const result = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth'
    });

    return result?.data || null;
  }

  function decodeFromCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      return null;
    }

    return decodeImageData(imageData);
  }

  function waitForImage(img) {
    if (img.complete && img.naturalWidth > 0) {
      return Promise.resolve(img);
    }

    return new Promise((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        resolve(img);
      };
      const onError = () => {
        cleanup();
        reject(new Error('Не удалось загрузить изображение'));
      };
      const cleanup = () => {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
      };

      img.addEventListener('load', onLoad);
      img.addEventListener('error', onError);
    });
  }

  async function decodeFromImageElement(img, maxSize = 1024) {
    if (!img?.naturalWidth) {
      await waitForImage(img);
    }

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;

    const scale = Math.min(1, maxSize / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, cw, ch);
    return decodeFromCanvas(canvas);
  }

  async function decodeFromBlob(blob, maxSize = 1024) {
    if (!blob) return null;

    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob);
      try {
        const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
        const cw = Math.max(1, Math.round(bitmap.width * scale));
        const ch = Math.max(1, Math.round(bitmap.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;

        ctx.drawImage(bitmap, 0, 0, cw, ch);
        return decodeFromCanvas(canvas);
      } finally {
        bitmap.close?.();
      }
    }

    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      return await decodeFromImageElement(img, maxSize);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function urlsMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;

    try {
      return new URL(a).href === new URL(b).href;
    } catch {
      return a === b;
    }
  }

  function findImageBySrc(srcUrl) {
    if (!srcUrl) return null;

    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      if (urlsMatch(img.currentSrc || img.src, srcUrl)) return img;
      const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
      if (lazy && urlsMatch(lazy, srcUrl)) return img;
    }

    return null;
  }

  async function decodeFromSrcUrl(srcUrl, { fetchImage } = {}) {
    const img = findImageBySrc(srcUrl);
    if (img) {
      try {
        const data = await decodeFromImageElement(img);
        if (data) return data;
      } catch {
        /* try fetch fallback */
      }
    }

    if (typeof fetchImage === 'function') {
      const blob = await fetchImage(srcUrl);
      return decodeFromBlob(blob);
    }

    return null;
  }

  return {
    looksLikeUrl,
    normalizeUrl,
    generateDataUrl,
    decodeImageData,
    decodeFromCanvas,
    decodeFromImageElement,
    decodeFromBlob,
    decodeFromSrcUrl,
    findImageBySrc,
    urlsMatch
  };
})();
