/** Shared URL helpers for content scripts and reader extraction. */
globalThis.WSUrlUtils = globalThis.WSUrlUtils ?? (() => {
  function resolveUrl(url, baseUrl) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('#')) {
      return null;
    }
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return null;
    }
  }

  function extractUrlsFromCss(text, baseUrl, out = new Set()) {
    if (!text) return out;
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
    return out;
  }

  function isJavaScriptResource(url, contentType = '') {
    const lowerUrl = String(url || '').toLowerCase().split(/[?#]/)[0];
    const lowerType = String(contentType || '').toLowerCase();
    if (lowerType.includes('javascript') || lowerType.includes('ecmascript')) return true;
    return /\.m?js$/i.test(lowerUrl);
  }

  return { resolveUrl, extractUrlsFromCss, isJavaScriptResource };
})();

var WSUrlUtils = globalThis.WSUrlUtils;
