/**
 * Extract article content via Readability and open reader tab.
 */
globalThis.WSReaderExtract = (() => {
  const SESSION_PREFIX = 'reader-payload:';

  function sessionKey(id) {
    return `${SESSION_PREFIX}${id}`;
  }

  function generateId() {
    return `ws-reader-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  const LAZY_SRC_ATTRS = [
    'data-src',
    'data-original',
    'data-lazy-src',
    'data-url',
    'data-image',
    'data-lazy'
  ];

  function resolveContentUrl(url, baseUrl) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return null;
    }
  }

  function normalizeSrcset(srcset, baseUrl) {
    return srcset.split(',').map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;

      const spaceIdx = trimmed.search(/\s/);
      const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
      const resolved = resolveContentUrl(url, baseUrl);
      return resolved ? `${resolved}${descriptor}` : trimmed;
    }).join(', ');
  }

  function isPlaceholderSrc(src) {
    if (!src) return true;
    if (src === 'about:blank') return true;
    if (src.startsWith('data:')) return true;
    return /placeholder|1x1|pixel|blank\.(gif|png|webp)/i.test(src);
  }

  /** Fix lazy-loaded and relative media URLs so images work in the reader tab. */
  function fixMediaElements(root, baseUrl) {
    root.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src');
      if (isPlaceholderSrc(src)) {
        for (const attr of LAZY_SRC_ATTRS) {
          const resolved = resolveContentUrl(img.getAttribute(attr), baseUrl);
          if (resolved) {
            img.setAttribute('src', resolved);
            break;
          }
        }
      } else {
        const resolved = resolveContentUrl(src, baseUrl);
        if (resolved) img.setAttribute('src', resolved);
      }

      const srcset = img.getAttribute('srcset');
      if (srcset && !srcset.includes('data:')) {
        img.setAttribute('srcset', normalizeSrcset(srcset, baseUrl));
      } else if (!srcset) {
        const lazySrcset = img.getAttribute('data-srcset');
        if (lazySrcset && !lazySrcset.includes('data:')) {
          img.setAttribute('srcset', normalizeSrcset(lazySrcset, baseUrl));
        }
      }

      img.setAttribute('referrerpolicy', 'no-referrer');
      img.removeAttribute('loading');
    });

    root.querySelectorAll('source, video, audio').forEach((el) => {
      const src = el.getAttribute('src');
      if (src) {
        const resolved = resolveContentUrl(src, baseUrl);
        if (resolved) el.setAttribute('src', resolved);
      }

      const srcset = el.getAttribute('srcset');
      if (srcset && !srcset.includes('data:')) {
        el.setAttribute('srcset', normalizeSrcset(srcset, baseUrl));
      }

      const poster = el.getAttribute('poster');
      if (poster) {
        const resolved = resolveContentUrl(poster, baseUrl);
        if (resolved) el.setAttribute('poster', resolved);
      }

      el.setAttribute('referrerpolicy', 'no-referrer');
    });

    root.querySelectorAll('picture source[srcset*="data:"]').forEach((el) => {
      el.removeAttribute('srcset');
    });
  }

  function normalizeContentUrls(html, baseUrl) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;

    fixMediaElements(wrapper, baseUrl);

    wrapper.querySelectorAll('a[href]').forEach((el) => {
      const href = el.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      const resolved = resolveContentUrl(href, baseUrl);
      if (resolved) el.setAttribute('href', resolved);
    });

    return wrapper.innerHTML;
  }

  /** Remove inline data URLs — they blow up storage quotas. */
  function shrinkContentHtml(html, baseUrl) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;

    fixMediaElements(wrapper, baseUrl);

    wrapper.querySelectorAll('img[src^="data:"]').forEach((img) => {
      img.removeAttribute('src');
      if (!img.getAttribute('alt')) {
        img.setAttribute('alt', 'Изображение');
      }
    });

    wrapper.querySelectorAll('[srcset]').forEach((el) => {
      const srcset = el.getAttribute('srcset') || '';
      if (srcset.includes('data:')) {
        el.removeAttribute('srcset');
      }
    });

    wrapper.querySelectorAll('source[src^="data:"], video[src^="data:"], audio[src^="data:"]').forEach((el) => {
      el.remove();
    });

    return wrapper.innerHTML;
  }

  function extractArticle() {
    if (typeof Readability === 'undefined') {
      return { ok: false, error: 'readability_unavailable' };
    }

    const documentClone = document.cloneNode(true);
    try {
      documentClone.querySelectorAll('script, noscript, iframe').forEach((el) => el.remove());
    } catch { /* ignore */ }

    const reader = new Readability(documentClone, {
      charThreshold: 100,
      keepClasses: false
    });
    const article = reader.parse();

    if (!article?.content?.trim()) {
      return { ok: false, error: 'not_article' };
    }

    let contentHtml = article.content;
    if (typeof DOMPurify !== 'undefined') {
      contentHtml = DOMPurify.sanitize(contentHtml);
    }
    const baseUrl = location.href;
    contentHtml = normalizeContentUrls(contentHtml, baseUrl);
    contentHtml = shrinkContentHtml(contentHtml, baseUrl);

    return {
      ok: true,
      data: {
        sourceUrl: location.href.split('#')[0],
        title: (article.title || document.title || '').trim(),
        byline: (article.byline || '').trim(),
        siteName: (article.siteName || '').trim(),
        publishedTime: (article.publishedTime || '').trim(),
        excerpt: (article.excerpt || '').trim(),
        contentHtml,
        dir: article.dir || ''
      }
    };
  }

  async function openReaderTab() {
    const result = extractArticle();
    if (!result.ok) return result;

    const id = generateId();
    const payload = {
      id,
      ...result.data,
      createdAt: Date.now()
    };

    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_READER_TAB', id, payload }, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: 'open_failed', message: err.message });
            return;
          }
          if (!response?.ok) {
            resolve({
              ok: false,
              error: response?.error || 'open_failed',
              message: response?.message || 'Не удалось открыть читатель.'
            });
            return;
          }
          resolve({ ok: true, ...(response || {}) });
        });
      } catch (err) {
        resolve({ ok: false, error: 'open_failed', message: err?.message || String(err) });
      }
    });
  }

  async function loadPayload(id) {
    const key = sessionKey(id);

    try {
      const sessionStored = await chrome.storage.session.get(key);
      if (sessionStored[key]) return sessionStored[key];
    } catch { /* session unavailable */ }

    try {
      const localStored = await chrome.storage.local.get(key);
      return localStored[key] || null;
    } catch {
      return null;
    }
  }

  async function deletePayload(id) {
    const key = sessionKey(id);
    await Promise.allSettled([
      chrome.storage.session.remove(key),
      chrome.storage.local.remove(key)
    ]);
  }

  return {
    SESSION_PREFIX,
    sessionKey,
    extractArticle,
    openReaderTab,
    loadPayload,
    deletePayload,
    fixMediaElements,
    normalizeContentUrls
  };
})();
