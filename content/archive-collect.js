/**
 * Collect page HTML and resource URLs; scroll for lazy content before snapshot.
 */
globalThis.WSArchiveCollect = globalThis.WSArchiveCollect ?? (() => {
  const OVERLAY_ID = 'ws-archive-prepare-overlay';
  const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-url', 'data-image', 'data-lazy'];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getSettings() {
    return {
      scrollStepDelayMs: WS_DEFAULTS.archiveScrollStepDelayMs ?? 400,
      prepareTimeoutMs: WS_DEFAULTS.archivePrepareTimeoutMs ?? 45000
    };
  }

  function showOverlay(message) {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483646',
        'display:flex',
        'align-items:flex-end',
        'justify-content:center',
        'pointer-events:none',
        'padding:24px'
      ].join(';');
      overlay.innerHTML = [
        '<div style="',
        'background:rgba(20,20,30,0.92);color:#fff;padding:12px 18px;border-radius:12px;',
        'font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.25);',
        '">',
        '<span id="ws-archive-prepare-text"></span>',
        '</div>'
      ].join('');
      document.documentElement.appendChild(overlay);
    }
    const text = overlay.querySelector('#ws-archive-prepare-text');
    if (text) text.textContent = message;
    overlay.hidden = false;
  }

  function hideOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
  }

  function isPlaceholderSrc(src) {
    if (!src) return true;
    if (src === 'about:blank') return true;
    if (src.startsWith('data:')) return false;
    return /placeholder|1x1|pixel|blank\.(gif|png|webp)/i.test(src);
  }

  function promoteLazyImages() {
    document.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src');
      if (!isPlaceholderSrc(src)) return;
      for (const attr of LAZY_SRC_ATTRS) {
        const lazy = img.getAttribute(attr);
        if (lazy && !lazy.startsWith('data:')) {
          img.setAttribute('src', lazy);
          break;
        }
      }
    });
  }

  async function waitForImage(img, timeoutMs = 8000) {
    if (img.complete && img.naturalWidth > 0) return;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        img.removeEventListener('load', finish);
        img.removeEventListener('error', finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      img.addEventListener('load', finish, { once: true });
      img.addEventListener('error', finish, { once: true });
    });
  }

  async function waitForLazyAssets(deadline) {
    promoteLazyImages();
    const imgs = [...document.querySelectorAll('img')];
    const pending = imgs.filter((img) => {
      const src = img.currentSrc || img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return false;
      return !img.complete || img.naturalWidth === 0;
    });

    await Promise.all(pending.map(async (img) => {
      if (Date.now() > deadline) return;
      await waitForImage(img, Math.min(8000, deadline - Date.now()));
    }));
  }

  async function scrollPass(stepDelayMs, deadline) {
    const step = Math.max(120, Math.floor(window.innerHeight * 0.85));
    let lastHeight = 0;

    while (Date.now() < deadline) {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (window.scrollY >= maxScroll - 2 && document.documentElement.scrollHeight === lastHeight) {
        break;
      }
      lastHeight = document.documentElement.scrollHeight;
      window.scrollBy(0, step);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await sleep(stepDelayMs);
      promoteLazyImages();
    }
  }

  async function preparePageForArchive() {
    const { scrollStepDelayMs, prepareTimeoutMs } = getSettings();
    const deadline = Date.now() + prepareTimeoutMs;
    const originalScrollY = window.scrollY;

    showOverlay('Подготовка страницы для сохранения…');

    try {
      await scrollPass(scrollStepDelayMs, deadline);
      await waitForLazyAssets(deadline);

      if (Date.now() < deadline) {
        const beforeHeight = document.documentElement.scrollHeight;
        await scrollPass(Math.min(scrollStepDelayMs, 250), deadline);
        if (document.documentElement.scrollHeight > beforeHeight) {
          await waitForLazyAssets(deadline);
        }
      }

      window.scrollTo(0, originalScrollY);
      return { ok: true };
    } catch (err) {
      window.scrollTo(0, originalScrollY);
      return { ok: false, error: err?.message || 'prepare_failed' };
    } finally {
      hideOverlay();
    }
  }

  function resolveUrl(url, baseUrl) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) {
      return null;
    }
    if (url.startsWith('#')) return null;
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return null;
    }
  }

  function extractUrlsFromCss(text, baseUrl, out) {
    if (!text) return;
    const importRe = /@import\s+(?:url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"])/gi;
    const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    let match;
    while ((match = importRe.exec(text))) {
      const resolved = resolveUrl(match[1] || match[2], baseUrl);
      if (resolved) out.add(resolved);
    }
    while ((match = urlRe.exec(text))) {
      const resolved = resolveUrl(match[1], baseUrl);
      if (resolved) out.add(resolved);
    }
  }

  function collectResourceUrls(root, baseUrl) {
    const urls = new Set();

    root.querySelectorAll('link[rel="stylesheet"], link[rel="preload"][as="style"]').forEach((el) => {
      const href = resolveUrl(el.getAttribute('href'), baseUrl);
      if (href) urls.add(href);
    });

    root.querySelectorAll('script[src]').forEach((el) => {
      const src = resolveUrl(el.getAttribute('src'), baseUrl);
      if (src) urls.add(src);
    });

    root.querySelectorAll('img[src], img[srcset], source[src], source[srcset], video[src], audio[src]').forEach((el) => {
      const src = resolveUrl(el.getAttribute('src'), baseUrl);
      if (src) urls.add(src);
      const srcset = el.getAttribute('srcset');
      if (srcset) {
        srcset.split(',').forEach((part) => {
          const url = part.trim().split(/\s+/)[0];
          const resolved = resolveUrl(url, baseUrl);
          if (resolved) urls.add(resolved);
        });
      }
    });

    root.querySelectorAll('link[rel*="icon"]').forEach((el) => {
      const href = resolveUrl(el.getAttribute('href'), baseUrl);
      if (href) urls.add(href);
    });

    root.querySelectorAll('style').forEach((el) => extractUrlsFromCss(el.textContent, baseUrl, urls));
    root.querySelectorAll('[style]').forEach((el) => extractUrlsFromCss(el.getAttribute('style'), baseUrl, urls));

    return [...urls];
  }

  function cleanupClone(root) {
    root.querySelectorAll([
      '#ws-archive-prepare-overlay',
      '#ws-reader-pill',
      '.ws-sidebar-root',
      '.ws-ann-note-editor',
      '.ws-ann-popover',
      '.ws-ann-menu',
      '.ws-dict-popup',
      'mark.ws-match',
      'mark.ws-annotation'
    ].join(',')).forEach((el) => el.remove());
  }

  function collectPageSnapshot() {
    const baseUrl = location.href.split('#')[0];
    const clone = document.documentElement.cloneNode(true);
    cleanupClone(clone);

    const doctype = document.doctype
      ? `<!DOCTYPE ${document.doctype.name}${document.doctype.publicId ? ` PUBLIC "${document.doctype.publicId}"` : ''}${document.doctype.systemId ? ` "${document.doctype.systemId}"` : ''}>`
      : '<!DOCTYPE html>';

    const html = `${doctype}\n${clone.outerHTML}`;
    const resourceUrls = collectResourceUrls(clone, baseUrl);

    return {
      ok: true,
      data: {
        html,
        baseUrl,
        title: (document.title || '').trim(),
        url: baseUrl,
        resourceUrls
      }
    };
  }

  return {
    preparePageForArchive,
    collectPageSnapshot,
    collectResourceUrls,
    resolveUrl
  };
})();

var WSArchiveCollect = globalThis.WSArchiveCollect;
