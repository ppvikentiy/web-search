/** Helpers to render offline ZIP archives in the browser. */
globalThis.WSArchiveViewer = globalThis.WSArchiveViewer ?? (() => {
  const MIME = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain'
  };

  function mimeForPath(path) {
    const lower = path.toLowerCase();
    for (const [ext, mime] of Object.entries(MIME)) {
      if (lower.endsWith(ext)) return mime;
    }
    return 'application/octet-stream';
  }

  function unzipArchive(zipBytes) {
    if (typeof fflate === 'undefined' || !fflate.unzipSync) {
      throw new Error('fflate недоступен');
    }
    const input = WSArchiveBytes?.normalizeZipBytes?.(zipBytes) ?? (
      zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes || [])
    );
    if (!input?.byteLength) {
      throw new Error('Пустой или повреждённый архив');
    }
    if (WSArchiveBytes?.isZipBytes && !WSArchiveBytes.isZipBytes(input)) {
      throw new Error('Повреждённый архив: файл не является ZIP');
    }
    try {
      return fflate.unzipSync(input);
    } catch (err) {
      throw new Error('Повреждённый архив: не удалось распаковать ZIP');
    }
  }

  function rewriteHtmlPaths(html, blobUrls) {
    let result = html;
    const paths = Object.keys(blobUrls).sort((a, b) => b.length - a.length);
    for (const path of paths) {
      const url = blobUrls[path];
      result = result.split(path).join(url);
      result = result.split(encodeURI(path)).join(url);
      const normalized = path.replace(/^\.\//, '');
      if (normalized !== path) {
        result = result.split(normalized).join(url);
      }
    }
    return result;
  }

  function buildBlobUrlMap(files) {
    const blobUrls = {};
    for (const [path, bytes] of Object.entries(files)) {
      if (path === 'README.txt' || !bytes?.byteLength) continue;
      const mime = mimeForPath(path);
      blobUrls[path] = URL.createObjectURL(new Blob([bytes], { type: mime }));
    }
    return blobUrls;
  }

  function renderArchive(zipBytes) {
    const files = unzipArchive(zipBytes);
    const indexBytes = files['index.html'];
    if (!indexBytes) {
      throw new Error('В архиве нет index.html');
    }

    const blobUrls = buildBlobUrlMap(files);
    const html = rewriteHtmlPaths(new TextDecoder('utf-8').decode(indexBytes), blobUrls);

    return {
      html,
      blobUrls,
      fileCount: Object.keys(files).length
    };
  }

  function revokeBlobUrls(blobUrls) {
    for (const url of Object.values(blobUrls || {})) {
      URL.revokeObjectURL(url);
    }
  }

  return {
    renderArchive,
    revokeBlobUrls,
    unzipArchive,
    mimeForPath
  };
})();

var WSArchiveViewer = globalThis.WSArchiveViewer;
