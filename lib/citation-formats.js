/** Bibliographic citation presets for web sources (no author). */
globalThis.WSCitationFormats = globalThis.WSCitationFormats ?? (() => {
  const CITATION_PRESETS = [
    { id: 'gost', label: 'ГОСТ (электронный ресурс)' },
    { id: 'apa7', label: 'APA 7' },
    { id: 'mla9', label: 'MLA 9' },
    { id: 'chicago', label: 'Chicago (footnotes)' }
  ];

  const MONTHS_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const MONTHS_EN_SHORT = [
    'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June',
    'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'
  ];

  function normalizeDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  function stripTrailingPeriod(text) {
    return String(text || '').trim().replace(/[.…]+$/u, '');
  }

  function getSiteName(url, fallbackTitle = '') {
    if (!url) return fallbackTitle || 'Unknown site';

    try {
      const hostname = new URL(url).hostname.replace(/^www\./i, '');
      return hostname || fallbackTitle || url;
    } catch {
      return fallbackTitle || url;
    }
  }

  function parseSourceMeta(data = {}) {
    const date = normalizeDate(data.date || new Date());
    const url = String(data.url || '').trim();
    const title = stripTrailingPeriod(data.title || getSiteName(url));
    const siteName = getSiteName(url, title);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const monthIndex = date.getMonth();

    return {
      url,
      title,
      siteName,
      accessDateGost: `${day}.${month}.${year}`,
      accessDateApa: `${MONTHS_EN[monthIndex]} ${date.getDate()}, ${year}`,
      accessDateMla: `${date.getDate()} ${MONTHS_EN_SHORT[monthIndex]} ${year}`,
      accessDateChicago: `${MONTHS_EN[monthIndex]} ${date.getDate()}, ${year}`
    };
  }

  function formatGost(meta) {
    return `${meta.title} : [Электронный ресурс] // ${meta.siteName}. – ${meta.url} (дата обращения: ${meta.accessDateGost}).`;
  }

  function formatApa7(meta) {
    return `${meta.title}. (n.d.). ${meta.siteName}. Retrieved ${meta.accessDateApa}, from ${meta.url}`;
  }

  function formatMla9(meta) {
    return `"${meta.title}." ${meta.siteName}, accessed ${meta.accessDateMla}, ${meta.url}.`;
  }

  function formatChicago(meta) {
    return `${meta.siteName}, "${meta.title}," accessed ${meta.accessDateChicago}, ${meta.url}.`;
  }

  const FORMATTERS = {
    gost: formatGost,
    apa7: formatApa7,
    mla9: formatMla9,
    chicago: formatChicago
  };

  function getPresetLabel(preset) {
    return CITATION_PRESETS.find((item) => item.id === preset)?.label || preset;
  }

  function formatBibliography(preset, data) {
    const formatter = FORMATTERS[preset] || FORMATTERS.gost;
    const meta = parseSourceMeta(data);
    return formatter(meta);
  }

  return {
    CITATION_PRESETS,
    parseSourceMeta,
    formatBibliography,
    getPresetLabel
  };
})();

var WSCitationFormats = globalThis.WSCitationFormats;
