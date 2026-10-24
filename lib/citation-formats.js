/** Bibliographic citation presets for web sources. */
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

  function parsePublishedDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (iso) {
      const year = Number(iso[1]);
      const month = Number(iso[2]);
      const day = Number(iso[3]);
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
        return { date, precision: 'day' };
      }
    }

    const yearOnly = raw.match(/^(19|20)\d{2}$/);
    if (yearOnly) {
      return { date: new Date(Number(yearOnly[0]), 0, 1), precision: 'year' };
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime()) && /[a-zа-я]/i.test(raw)) {
      return { date: parsed, precision: 'day' };
    }

    const yearInText = raw.match(/\b(19|20)\d{2}\b/);
    if (yearInText && raw.length <= 32) {
      return { date: new Date(Number(yearInText[0]), 0, 1), precision: 'year' };
    }

    return null;
  }

  function formatPublishedRu(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = parsePublishedDate(raw);
    if (!parsed) return raw;
    if (parsed.precision === 'year') return String(parsed.date.getFullYear());
    const day = String(parsed.date.getDate()).padStart(2, '0');
    const month = String(parsed.date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${parsed.date.getFullYear()}`;
  }

  function looksLikeSurnameInitials(name) {
    return /^\p{L}[\p{L}'’-]*\s+\p{L}\.(?:\s*\p{L}\.)*$/u.test(name);
  }

  function isPatronymic(token) {
    const word = String(token || '').replace(/\.+$/u, '');
    return /(?:ович|евич|ёвич|ич|овна|евна|ёвна|ична|инична|оглы|кызы|гызы)$/iu.test(word);
  }

  function stripRole(name) {
    return String(name || '').replace(/\s*,\s*(?:редактор|корреспондент|обозреватель|колумнист|автор|journalist|staff writer|reporter|editor|correspondent|writer)(?:\s.*)?$/i, '').trim();
  }

  function splitAuthors(author) {
    const cleaned = stripRole(String(author || '').replace(/\s+/g, ' ').trim());
    if (!cleaned) return [];

    let parts = cleaned.split(/\s*;\s*|\s+(?:and|и)\s+|\s+&\s+/i).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 1 && cleaned.includes(',')) {
      const commaParts = cleaned.split(/\s*,\s*/).filter(Boolean);
      const words = (part) => part.split(/\s+/).filter(Boolean).length;
      if (commaParts.length >= 2 && commaParts.every((part) => words(part) >= 2)) {
        parts = commaParts;
      } else if (commaParts.length >= 3 && commaParts.every((part) => words(part) === 1)) {
        parts = commaParts;
      }
    }

    return parts.map(stripRole).filter(Boolean);
  }

  function parsePerson(name) {
    if (looksLikeSurnameInitials(name)) {
      const tokens = name.split(/\s+/);
      return { surname: tokens[0], given: tokens.slice(1).join(' ') };
    }

    if (name.includes(',')) {
      const [surname, ...rest] = name.split(',');
      return { surname: surname.trim(), given: rest.join(',').trim() };
    }

    const tokens = name.split(/\s+/).filter(Boolean);
    if (tokens.length === 1) return { surname: tokens[0], given: '' };

    if (tokens.length >= 3 && isPatronymic(tokens[tokens.length - 1])) {
      return { surname: tokens[0], given: tokens.slice(1).join(' ') };
    }
    if (tokens.length >= 3 && isPatronymic(tokens[1])) {
      return { surname: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(' ') };
    }

    return { surname: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(' ') };
  }

  function formatInitials(given) {
    return given.split(/\s+/).filter(Boolean).map((part) => {
      if (/^\p{L}\.$/u.test(part)) return part;
      return `${part[0].toUpperCase()}.`;
    }).join(' ');
  }

  function formatGostAuthor(name) {
    if (looksLikeSurnameInitials(name)) return name;
    const { surname, given } = parsePerson(name);
    if (!given) return surname;
    return `${surname} ${formatInitials(given)}`;
  }

  function formatApaAuthor(name) {
    const person = parsePerson(name);
    if (!person.given) return person.surname;
    return `${person.surname}, ${formatInitials(person.given)}`;
  }

  function formatMlaAuthor(name, index) {
    const { surname, given } = parsePerson(name);
    if (!given) return surname;
    if (index === 0) return `${surname}, ${given}`;
    return `${given} ${surname}`;
  }

  function joinAuthors(authors, formatOne, style) {
    if (!authors.length) return '';
    if (style === 'mla') {
      if (authors.length >= 3) return `${formatOne(authors[0], 0)}, et al`;
      if (authors.length === 2) return `${formatOne(authors[0], 0)}, and ${formatOne(authors[1], 1)}`;
      return formatOne(authors[0], 0);
    }
    if (style === 'chicago') {
      if (authors.length >= 3) return `${authors[0]} et al.`;
      if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
      return authors[0];
    }
    const formatted = authors.map((name, index) => formatOne(name, index));
    if (formatted.length === 1) return formatted[0];
    if (style === 'apa') {
      if (formatted.length === 2) return `${formatted[0]}, & ${formatted[1]}`;
      return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`;
    }
    return formatted.join(', ');
  }

  function withPeriod(text) {
    if (!text) return '';
    return /[.!?…]$/u.test(text) ? text : `${text}.`;
  }

  function formatApaDate(published) {
    if (!published) return '';
    const year = published.date.getFullYear();
    if (published.precision === 'year') return String(year);
    const month = MONTHS_EN[published.date.getMonth()];
    return `${year}, ${month} ${published.date.getDate()}`;
  }

  function formatMlaDate(published) {
    if (!published) return '';
    const year = published.date.getFullYear();
    if (published.precision === 'year') return String(year);
    const month = MONTHS_EN_SHORT[published.date.getMonth()];
    return `${published.date.getDate()} ${month} ${year}`;
  }

  function formatChicagoDate(published) {
    if (!published) return '';
    const year = published.date.getFullYear();
    if (published.precision === 'year') return String(year);
    const month = MONTHS_EN[published.date.getMonth()];
    return `${month} ${published.date.getDate()}, ${year}`;
  }

  function cleanTitle(title, siteName, url) {
    let text = stripTrailingPeriod(title).replace(/\s+[—–|-]\s+Читатель$/u, '').trim();
    const suffixes = [];
    if (siteName) suffixes.push(siteName);
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '');
      if (host) suffixes.push(host);
    } catch {
      /* keep the title as written */
    }

    suffixes.forEach((suffix) => {
      if (!suffix || suffix.length < 2) return;
      const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const next = text.replace(new RegExp(`\\s*[|—–\\-:/]\\s*${escaped}\\s*$`, 'i'), '').trim();
      if (next) text = next;
    });

    return text || stripTrailingPeriod(title);
  }

  function parseSourceMeta(data = {}) {
    const date = normalizeDate(data.date || new Date());
    const url = String(data.url || '').trim();
    const explicitSite = stripTrailingPeriod(data.site || data.siteName || '');
    const siteName = explicitSite || getSiteName(url, data.title || '');
    const title = cleanTitle(data.title || siteName, siteName, url);
    const authors = splitAuthors(data.author || data.byline || '').filter((name) => {
      const key = name.toLowerCase();
      return key !== siteName.toLowerCase() && key !== title.toLowerCase();
    });
    const published = parsePublishedDate(data.published || data.publishedTime || '');
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const monthIndex = date.getMonth();

    return {
      url,
      title,
      siteName,
      authors,
      authorGost: joinAuthors(authors, formatGostAuthor, 'gost'),
      authorApa: joinAuthors(authors, formatApaAuthor, 'apa'),
      authorMla: joinAuthors(authors, formatMlaAuthor, 'mla'),
      authorChicago: joinAuthors(authors, (name) => name, 'chicago'),
      published,
      publishedYear: published ? String(published.date.getFullYear()) : '',
      accessDateGost: `${day}.${month}.${year}`,
      accessDateApa: `${MONTHS_EN[monthIndex]} ${date.getDate()}, ${year}`,
      accessDateMla: `${date.getDate()} ${MONTHS_EN_SHORT[monthIndex]} ${year}`,
      accessDateChicago: `${MONTHS_EN[monthIndex]} ${date.getDate()}, ${year}`
    };
  }

  function formatGost(meta) {
    const access = `(дата обращения: ${meta.accessDateGost})`;
    const author = meta.authorGost ? `${withPeriod(meta.authorGost)} ` : '';
    const year = meta.publishedYear ? ` – ${meta.publishedYear}.` : '';
    return `${author}${meta.title} [Электронный ресурс] // ${meta.siteName}.${year} – URL: ${meta.url} ${access}.`;
  }

  function formatApa7(meta) {
    const dated = meta.published ? formatApaDate(meta.published) : 'n.d.';
    if (meta.authorApa) {
      const tail = meta.published
        ? `${meta.siteName}. ${meta.url}`
        : `${meta.siteName}. Retrieved ${meta.accessDateApa}, from ${meta.url}`;
      return `${meta.authorApa} (${dated}). ${meta.title}. ${tail}`;
    }
    if (meta.published) {
      return `${meta.title}. (${dated}). ${meta.siteName}. ${meta.url}`;
    }
    return `${meta.title}. (n.d.). ${meta.siteName}. Retrieved ${meta.accessDateApa}, from ${meta.url}`;
  }

  function formatMla9(meta) {
    const author = meta.authorMla ? `${withPeriod(meta.authorMla)} ` : '';
    const when = meta.published
      ? formatMlaDate(meta.published)
      : `accessed ${meta.accessDateMla}`;
    return `${author}"${meta.title}." ${meta.siteName}, ${when}, ${meta.url}.`;
  }

  function formatChicago(meta) {
    const author = meta.authorChicago ? `${meta.authorChicago}, ` : '';
    if (meta.published) {
      return `${author}"${meta.title}," ${meta.siteName}, ${formatChicagoDate(meta.published)}, ${meta.url}.`;
    }
    const opener = meta.authorChicago ? author : `${meta.siteName}, `;
    const site = meta.authorChicago ? `${meta.siteName}, ` : '';
    return `${opener}"${meta.title}," ${site}accessed ${meta.accessDateChicago}, ${meta.url}.`;
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
    formatPublishedRu,
    getPresetLabel
  };
})();

var WSCitationFormats = globalThis.WSCitationFormats;
