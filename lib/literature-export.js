/** Copy and download bibliographic references using citation presets. */
globalThis.WSLiteratureExport = globalThis.WSLiteratureExport ?? (() => {
  function getPreset(settings) {
    return settings?.literatureCitationPreset || WS_DEFAULTS.literatureCitationPreset || 'gost';
  }

  function wrapQuote(text) {
    const quote = String(text || '').trim();
    if (!quote) return '';
    if (quote.startsWith('«') && quote.endsWith('»')) return quote;
    return `«${quote}»`;
  }

  function formatLiterature(data, settings) {
    const citation = WSCitationFormats.formatBibliography(getPreset(settings), data);
    const quote = wrapQuote(data?.text || '');
    const note = String(data?.note || '').trim();
    const parts = [citation];
    if (quote) parts.push('', quote);
    if (note) parts.push('', note);
    return parts.join('\n');
  }

  async function copyLiterature(data, settings) {
    const text = WSCitationFormats.formatBibliography(getPreset(settings), data);

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.documentElement.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function buildFilename(data) {
    const meta = WSCitationFormats.parseSourceMeta(data);
    const source = String(data?.text || meta.title || meta.siteName || 'literature');
    const slug = source
      .trim()
      .slice(0, 40)
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'literature';

    const now = data?.date instanceof Date ? data.date : new Date(data?.date || Date.now());
    const datePart = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');

    return `${slug}_${datePart}.txt`;
  }

  function downloadLiterature(data, settings) {
    const content = formatLiterature(data, settings);
    const blob = new Blob(['\uFEFF', content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = buildFilename(data);
    a.rel = 'noopener';
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return {
    formatLiterature,
    copyLiterature,
    downloadLiterature,
    buildFilename
  };
})();

var WSLiteratureExport = globalThis.WSLiteratureExport;
