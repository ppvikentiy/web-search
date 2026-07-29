/** Copy and download bibliographic references using citation presets. */
globalThis.WSLiteratureExport = globalThis.WSLiteratureExport ?? (() => {
  function getPreset(settings) {
    return settings?.literatureCitationPreset || WS_DEFAULTS.literatureCitationPreset || 'gost';
  }

  function formatLiterature(data, settings) {
    return WSCitationFormats.formatBibliography(getPreset(settings), data);
  }

  async function copyLiterature(data, settings) {
    const text = formatLiterature(data, settings);

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
    const siteName = WSCitationFormats.parseSourceMeta(data).siteName;
    const slug = siteName
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
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = buildFilename(data);
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return {
    formatLiterature,
    copyLiterature,
    downloadLiterature,
    buildFilename
  };
})();

var WSLiteratureExport = globalThis.WSLiteratureExport;
