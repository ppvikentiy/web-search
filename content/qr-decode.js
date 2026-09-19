/**
 * QR decode from page images + result popup.
 */
if (globalThis.WSQrDecode?.destroy) {
  try { globalThis.WSQrDecode.destroy(); } catch { /* stale instance */ }
}

globalThis.WSQrDecode = (() => {
  let popupEl = null;
  let outsideClickHandler = null;
  let keydownHandler = null;
  let destroyed = false;
  let ignoreOutsideUntil = 0;
  let lastImageRect = null;

  function cacheImageRect(e) {
    if (destroyed) return;

    const target = e.target;
    if (!(target instanceof HTMLImageElement)) return;

    try {
      lastImageRect = target.getBoundingClientRect();
    } catch {
      /* ignore */
    }
  }

  function getAnchorRect() {
    if (lastImageRect) return lastImageRect;

    return {
      left: window.innerWidth / 2 - 50,
      top: window.innerHeight / 2 - 10,
      width: 100,
      height: 20,
      bottom: window.innerHeight / 2 + 10,
      right: window.innerWidth / 2 + 50
    };
  }

  function positionNearRect(el, rect) {
    const margin = 8;
    el.style.left = '0';
    el.style.top = '0';
    el.hidden = false;

    const elRect = el.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - elRect.width / 2;
    left = Math.max(margin, Math.min(window.innerWidth - elRect.width - margin, left));

    let top = rect.bottom + margin;
    if (top + elRect.height > window.innerHeight - margin) {
      top = rect.top - elRect.height - margin;
    }
    top = Math.max(margin, top);

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function buildPopup() {
    popupEl = document.createElement('div');
    popupEl.className = 'ws-qr-popup';
    popupEl.hidden = true;
    popupEl.setAttribute('role', 'dialog');
    popupEl.setAttribute('aria-modal', 'false');
    WSDomUtils.decorateExtensionUi?.(popupEl);
    document.documentElement.appendChild(popupEl);
  }

  function attachGlobalDismiss() {
    if (outsideClickHandler) return;

    outsideClickHandler = (e) => {
      if (Date.now() < ignoreOutsideUntil) return;
      if (popupEl?.contains(e.target)) return;
      close();
    };

    document.addEventListener('mousedown', outsideClickHandler, true);
  }

  function detachGlobalDismiss() {
    if (outsideClickHandler) {
      document.removeEventListener('mousedown', outsideClickHandler, true);
      outsideClickHandler = null;
    }
  }

  function attachKeydown() {
    if (keydownHandler) return;

    keydownHandler = (e) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('keydown', keydownHandler, true);
  }

  function detachKeydown() {
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }
  }

  function close() {
    if (popupEl) popupEl.hidden = true;
    detachGlobalDismiss();
    detachKeydown();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function showResult(data, anchorRect) {
    if (destroyed) return;

    if (!popupEl) buildPopup();

    popupEl.className = 'ws-qr-popup';
    popupEl.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'ws-qr-popup-title';
    title.textContent = 'QR-код';

    const body = document.createElement('div');
    body.className = 'ws-qr-popup-text';
    body.textContent = data;

    const actions = document.createElement('div');
    actions.className = 'ws-qr-popup-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'ws-qr-popup-btn ws-qr-popup-btn-secondary';
    copyBtn.textContent = 'Копировать';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(data);
      copyBtn.textContent = ok ? 'Скопировано' : 'Ошибка';
      setTimeout(() => { copyBtn.textContent = 'Копировать'; }, 1500);
    });

    actions.appendChild(copyBtn);

    if (globalThis.WSQr?.looksLikeUrl(data)) {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'ws-qr-popup-btn';
      openBtn.textContent = 'Открыть';
      openBtn.addEventListener('click', () => {
        const url = globalThis.WSQr.normalizeUrl(data);
        window.open(url, '_blank', 'noopener,noreferrer');
        close();
      });
      actions.appendChild(openBtn);
    }

    popupEl.append(title, body, actions);
    positionNearRect(popupEl, anchorRect || getAnchorRect());

    ignoreOutsideUntil = Date.now() + 400;
    detachGlobalDismiss();
    detachKeydown();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (destroyed || popupEl?.hidden) return;
        ignoreOutsideUntil = Date.now() + 250;
        attachGlobalDismiss();
        attachKeydown();
      });
    });
  }

  function showNotFound(anchorRect) {
    if (destroyed) return;

    if (!popupEl) buildPopup();

    popupEl.className = 'ws-qr-popup ws-qr-popup-error';
    popupEl.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'ws-qr-popup-title';
    title.textContent = 'QR-код';

    const body = document.createElement('div');
    body.className = 'ws-qr-popup-text';
    body.textContent = 'QR-код не найден на изображении.';

    popupEl.append(title, body);
    positionNearRect(popupEl, anchorRect || getAnchorRect());

    ignoreOutsideUntil = Date.now() + 400;
    detachGlobalDismiss();
    detachKeydown();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (destroyed || popupEl?.hidden) return;
        ignoreOutsideUntil = Date.now() + 250;
        attachGlobalDismiss();
        attachKeydown();
      });
    });
  }

  async function fetchImageViaExtension(srcUrl) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'QR_FETCH_IMAGE', srcUrl }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        const bytes = typeof response?.base64 === 'string'
          ? (globalThis.WSArchiveBytes?.base64ToBytes?.(response.base64) || null)
          : null;
        if (!bytes?.byteLength) {
          reject(new Error('Пустой ответ'));
          return;
        }

        resolve(new Blob([bytes], { type: response.mimeType || 'image/png' }));
      });
    });
  }

  async function decodeFromSrcUrl(srcUrl) {
    if (!srcUrl) return null;

    const img = globalThis.WSQr?.findImageBySrc(srcUrl);
    if (img) {
      try {
        const data = await globalThis.WSQr.decodeFromImageElement(img);
        if (data) return data;
      } catch {
        /* fetch fallback */
      }
    }

    try {
      const blob = await fetchImageViaExtension(srcUrl);
      const data = await globalThis.WSQr.decodeFromBlob(blob);
      if (data) return data;
    } catch {
      /* offscreen fallback */
    }

    return decodeViaOffscreen(srcUrl);
  }

  function decodeViaOffscreen(srcUrl) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'QR_DECODE_OFFSCREEN', srcUrl }, (response) => {
        const err = chrome.runtime.lastError;
        if (err || !response?.ok || !response?.data) {
          resolve(null);
          return;
        }
        resolve(response.data);
      });
    });
  }

  function init() {
    if (destroyed) return;
    document.addEventListener('contextmenu', cacheImageRect, true);
  }

  function destroy() {
    destroyed = true;
    close();
    document.removeEventListener('contextmenu', cacheImageRect, true);
    lastImageRect = null;
    popupEl?.remove();
    popupEl = null;
  }

  return {
    init,
    close,
    destroy,
    decodeFromSrcUrl,
    showResult,
    showNotFound
  };
})();
