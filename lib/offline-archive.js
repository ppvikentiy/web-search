/** Build offline ZIP archives from page HTML and fetched subresources. */
globalThis.WSOfflineArchive = globalThis.WSOfflineArchive ?? (() => {
  const README = [
    'Офлайн-копия страницы, сохранённая расширением «Поиск слов на странице».',
    '',
    'Как открыть:',
    '1. Распакуйте этот ZIP-архив.',
    '2. Откройте файл index.html в браузере.',
    '',
    'Примечание: часть скриптов или внешних ресурсов могла не сохраниться из-за ограничений сайта.'
  ].join('\n');

  function getLimits(settings = {}) {
    return {
      maxPageBytes: settings.archiveMaxPageBytes ?? WS_DEFAULTS.archiveMaxPageBytes ?? 80 * 1024 * 1024,
      maxResourceBytes: settings.archiveMaxResourceBytes ?? WS_DEFAULTS.archiveMaxResourceBytes ?? 15 * 1024 * 1024,
      maxResources: settings.archiveMaxResources ?? WS_DEFAULTS.archiveMaxResources ?? 500
    };
  }

  function extensionFromUrl(url, contentType = '') {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/(\.[a-z0-9]{1,8})$/i);
      if (match) return match[1].toLowerCase();
    } catch { /* ignore */ }
    if (contentType.includes('css')) return '.css';
    if (contentType.includes('javascript')) return '.js';
    if (contentType.includes('png')) return '.png';
    if (contentType.includes('jpeg')) return '.jpg';
    if (contentType.includes('svg')) return '.svg';
    if (contentType.includes('woff2')) return '.woff2';
    if (contentType.includes('woff')) return '.woff';
    if (contentType.includes('json')) return '.json';
    return '';
  }

  function kindFolder(url, contentType = '') {
    const lower = url.toLowerCase();
    if (contentType.includes('css') || lower.endsWith('.css')) return 'styles';
    if (contentType.includes('javascript') || lower.endsWith('.js')) return 'scripts';
    if (contentType.includes('font') || /\.(woff2?|ttf|otf|eot)$/i.test(lower)) return 'fonts';
    if (/\.(png|jpe?g|gif|webp|svg|avif|ico)$/i.test(lower) || contentType.startsWith('image/')) return 'images';
    return 'files';
  }

  function hashString(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function assetPath(url, contentType, index) {
    const ext = extensionFromUrl(url, contentType) || '.bin';
    const folder = kindFolder(url, contentType);
    return `assets/${folder}/${String(index).padStart(3, '0')}-${hashString(url).slice(0, 8)}${ext}`;
  }

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

  function extractUrlsFromCss(text, baseUrl) {
    const urls = new Set();
    if (!text) return urls;
    const patterns = [
      /@import\s+(?:url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"])/gi,
      /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi
    ];
    for (const re of patterns) {
      let match;
      while ((match = re.exec(text))) {
        const resolved = resolveUrl(match[1] || match[2], baseUrl);
        if (resolved) urls.add(resolved);
      }
    }
    return urls;
  }

  function replaceUrlsInText(text, baseUrl, mapping) {
    if (!text) return text;
    return text.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (full, raw) => {
      const resolved = resolveUrl(raw, baseUrl);
      if (!resolved || !mapping[resolved]) return full;
      return `url("${mapping[resolved]}")`;
    });
  }

  function replaceAttrUrls(html, attrName, baseUrl, mapping) {
    const re = new RegExp(`(${attrName}\\s*=\\s*)(["'])(.*?)\\2`, 'gi');
    return html.replace(re, (full, prefix, quote, value) => {
      if (attrName.toLowerCase() === 'srcset') {
        const next = value.split(',').map((part) => {
          const trimmed = part.trim();
          const spaceIdx = trimmed.search(/\s/);
          const urlPart = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
          const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
          const resolved = resolveUrl(urlPart, baseUrl);
          if (resolved && mapping[resolved]) {
            return `${mapping[resolved]}${descriptor}`;
          }
          return trimmed;
        }).join(', ');
        return `${prefix}${quote}${next}${quote}`;
      }
      const resolved = resolveUrl(value, baseUrl);
      if (resolved && mapping[resolved]) {
        return `${prefix}${quote}${mapping[resolved]}${quote}`;
      }
      return full;
    });
  }

  function rewriteHtml(html, baseUrl, mapping) {
    let next = html;
    next = replaceAttrUrls(next, 'href', baseUrl, mapping);
    next = replaceAttrUrls(next, 'src', baseUrl, mapping);
    next = replaceAttrUrls(next, 'srcset', baseUrl, mapping);
    next = next.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (full, open, css, close) => {
      return `${open}${replaceUrlsInText(css, baseUrl, mapping)}${close}`;
    });
    next = next.replace(/\sstyle=(["'])([\s\S]*?)\1/gi, (full, quote, css) => {
      return ` style=${quote}${replaceUrlsInText(css, baseUrl, mapping)}${quote}`;
    });
    return next;
  }

  async function fetchResource(url, limits, warnings) {
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return { ok: false, skip: true };
    }

    try {
      const response = await fetch(url, { credentials: 'include', redirect: 'follow' });
      if (!response.ok) {
        warnings.push(`HTTP ${response.status}: ${url}`);
        return { ok: false };
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > limits.maxResourceBytes) {
        warnings.push(`Слишком большой файл (${buffer.byteLength} B): ${url}`);
        return { ok: false };
      }
      const contentType = response.headers.get('content-type') || '';
      return {
        ok: true,
        bytes: new Uint8Array(buffer),
        contentType
      };
    } catch (err) {
      warnings.push(`Не загружен: ${url} (${err?.message || 'fetch error'})`);
      return { ok: false };
    }
  }

  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let index = 0;

    async function run() {
      while (index < items.length) {
        const current = index++;
        results[current] = await worker(items[current], current);
      }
    }

    const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
    await Promise.all(runners);
    return results;
  }

  function buildFilename(title) {
    const slug = (title || 'page')
      .trim()
      .slice(0, 60)
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'page';
    const now = new Date();
    const datePart = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
    return `${slug}_${datePart}.zip`;
  }

  async function buildZip(snapshot, settings = {}) {
    if (typeof fflate === 'undefined' || !fflate.zipSync || !fflate.strToU8) {
      throw new Error('fflate недоступен');
    }

    const limits = getLimits(settings);
    const warnings = [];
    const baseUrl = snapshot.baseUrl || snapshot.url || '';
    const queue = [...new Set(snapshot.resourceUrls || [])];
    const fetched = new Map();
    let totalBytes = 0;
    let assetIndex = 0;

    while (queue.length && fetched.size < limits.maxResources) {
      const batch = queue.splice(0, limits.maxResources - fetched.size);
      await mapWithConcurrency(batch, 6, async (url) => {
        if (fetched.has(url)) return;
        const result = await fetchResource(url, limits, warnings);
        if (!result.ok) {
          fetched.set(url, null);
          return;
        }
        totalBytes += result.bytes.byteLength;
        if (totalBytes > limits.maxPageBytes) {
          warnings.push('Превышен общий лимит размера архива');
          fetched.set(url, null);
          return;
        }

        fetched.set(url, {
          bytes: result.bytes,
          contentType: result.contentType
        });

        if (result.contentType.includes('css') || url.toLowerCase().endsWith('.css')) {
          const cssText = new TextDecoder('utf-8').decode(result.bytes);
          for (const nested of extractUrlsFromCss(cssText, url)) {
            if (!fetched.has(nested) && !queue.includes(nested)) queue.push(nested);
          }
        }
      });
    }

    const mapping = {};
    const storedAssets = new Map();

    for (const [url, item] of fetched.entries()) {
      if (!item) continue;
      const path = assetPath(url, item.contentType, assetIndex++);
      mapping[url] = path;
      let bytes = item.bytes;
      if (item.contentType.includes('css') || url.toLowerCase().endsWith('.css')) {
        const cssText = new TextDecoder('utf-8').decode(bytes);
        bytes = fflate.strToU8(replaceUrlsInText(cssText, url, mapping));
      }
      storedAssets.set(path, bytes);
    }

    const rewrittenHtml = rewriteHtml(snapshot.html || '', baseUrl, mapping);
    const zipEntries = {
      'index.html': fflate.strToU8(rewrittenHtml),
      'README.txt': fflate.strToU8(README)
    };

    for (const [path, bytes] of storedAssets.entries()) {
      zipEntries[path] = bytes;
    }

    const zipBytes = fflate.zipSync(zipEntries, { level: 9 });
    return {
      ok: true,
      zipBytes,
      filename: buildFilename(snapshot.title),
      sizeBytes: zipBytes.byteLength,
      warnings
    };
  }

  return {
    buildZip,
    buildFilename,
    rewriteHtml,
    extractUrlsFromCss,
    assetPath
  };
})();

var WSOfflineArchive = globalThis.WSOfflineArchive;
