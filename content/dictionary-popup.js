/**
 * Dictionary lookup popup near the current text selection.
 */
if (globalThis.WSDictionaryPopup?.destroy) {
  try { globalThis.WSDictionaryPopup.destroy(); } catch { /* stale instance */ }
}
globalThis.WSDictionaryPopup = (() => {
  let popupEl = null;
  let cachedRect = null;
  let outsideClickHandler = null;
  let keydownHandler = null;
  let cacheHandler = null;
  let destroyed = false;
  let ignoreOutsideUntil = 0;

  function cacheSelectionRect() {
    if (destroyed) return;

    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return;

    try {
      cachedRect = sel.getRangeAt(0).getBoundingClientRect();
    } catch {
      /* ignore invalid range */
    }
  }

  function getSelectionRect() {
    const sel = window.getSelection();
    if (sel?.rangeCount && !sel.isCollapsed) {
      try {
        return sel.getRangeAt(0).getBoundingClientRect();
      } catch {
        /* ignore */
      }
    }
    return cachedRect;
  }

  function positionNearRect(el, rect, preferAbove = true) {
    const margin = 8;
    el.style.left = '0';
    el.style.top = '0';
    el.hidden = false;

    const elRect = el.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - elRect.width / 2;
    left = Math.max(margin, Math.min(window.innerWidth - elRect.width - margin, left));

    let top;
    if (preferAbove) {
      top = rect.top - elRect.height - margin;
      if (top < margin) {
        top = rect.bottom + margin;
      }
    } else {
      top = rect.bottom + margin;
      if (top + elRect.height > window.innerHeight - margin) {
        top = rect.top - elRect.height - margin;
      }
    }

    el.style.left = `${left}px`;
    el.style.top = `${Math.max(margin, top)}px`;
  }

  function buildPopup() {
    popupEl = document.createElement('div');
    popupEl.className = 'ws-dict-popup';
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

  function show(entry, rect, settings = {}) {
    if (destroyed || !entry) return;

    if (!popupEl) buildPopup();

    if (settings && globalThis.WSAnnotations?.applyColors) {
      WSAnnotations.applyColors(settings);
    }

    popupEl.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'ws-dict-popup-title';
    title.textContent = entry.word;

    popupEl.append(title);

    if (entry.groupId || entry.tags?.length) {
      const meta = document.createElement('div');
      meta.className = 'ws-dict-popup-meta';

      if (entry.groupId || entry.groupName) {
        const folder = document.createElement('span');
        folder.className = 'ws-dict-popup-folder';
        folder.textContent = entry.groupName || 'Общие';
        meta.append(folder);
      }

      if (entry.tags?.length) {
        const tags = document.createElement('div');
        tags.className = 'ws-dict-popup-tags';
        for (const tag of entry.tags) {
          const chip = document.createElement('span');
          chip.className = 'ws-dict-popup-tag';
          chip.textContent = tag;
          tags.append(chip);
        }
        meta.append(tags);
      }

      popupEl.append(meta);
    }

    const body = document.createElement('div');
    body.className = 'ws-dict-popup-text';
    body.textContent = entry.description || 'Описание не задано.';

    popupEl.append(body);

    const anchor = rect || getSelectionRect() || {
      left: window.innerWidth / 2 - 50,
      top: window.innerHeight / 2 - 10,
      width: 100,
      height: 20,
      bottom: window.innerHeight / 2 + 10,
      right: window.innerWidth / 2 + 50
    };

    positionNearRect(popupEl, anchor);

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

  function init() {
    if (cacheHandler || destroyed) return;

    cacheHandler = cacheSelectionRect;
    document.addEventListener('mouseup', cacheHandler, true);
    document.addEventListener('keyup', cacheHandler, true);
    document.addEventListener('contextmenu', cacheHandler, true);
    document.addEventListener('selectionchange', cacheHandler);
  }

  function destroy() {
    destroyed = true;
    close();

    if (cacheHandler) {
      document.removeEventListener('mouseup', cacheHandler, true);
      document.removeEventListener('keyup', cacheHandler, true);
      document.removeEventListener('contextmenu', cacheHandler, true);
      document.removeEventListener('selectionchange', cacheHandler);
      cacheHandler = null;
    }

    cachedRect = null;
    popupEl?.remove();
    popupEl = null;
  }

  return {
    init,
    show,
    close,
    destroy,
    getSelectionRect
  };
})();
