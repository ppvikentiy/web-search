/** Format and download annotation quotes to .txt or .md files */
globalThis.WSAnnotationExport = globalThis.WSAnnotationExport ?? (() => {
  function formatDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  const PREVIOUS_TXT = '{text}\n\nИсточник: {url}\nДата сохранения: {date}';
  const PREVIOUS_MD = '> {text}\n\n{note}\n\n— [{title}]({url}), {date}';

  function getTemplate(settings) {
    const format = settings?.annotationSaveFormat === 'md' ? 'md' : 'txt';
    const stored = format === 'md'
      ? settings?.annotationSaveTemplateMd
      : settings?.annotationSaveTemplateTxt;
    const fallback = format === 'md'
      ? WS_DEFAULTS.annotationSaveTemplateMd
      : WS_DEFAULTS.annotationSaveTemplateTxt;
    const template = stored || fallback;
    if (format === 'md' && template.trim() === PREVIOUS_MD) {
      return `> {text}\n\n{note}\n\n— {author}, [{title}]({url}), {site}, {published}, {date}`;
    }
    if (format !== 'md' && template.trim() === PREVIOUS_TXT) {
      return WS_DEFAULTS.annotationSaveTemplateTxt;
    }
    return template;
  }

  function tidyLine(line) {
    let text = line.replace(/[ \t]{2,}/g, ' ');
    if (/^[^:\n]{1,40}:\s*$/.test(text.trim())) return '';
    text = text
      .replace(/,(?:\s*,)+/g, ',')
      .replace(/^—\s*,\s*/g, '— ')
      .replace(/\s+,/g, ',')
      .replace(/,\s*$/g, '')
      .replace(/\[\s*\]\(\s*\)/g, '')
      .replace(/\(\s*\)/g, '')
      .trim();
    if (text === '—') return '';
    return text;
  }

  function applyTemplate(template, values) {
    const filled = template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
    const lines = filled.split('\n').map(tidyLine);
    const compacted = [];
    lines.forEach((line) => {
      if (!line.trim() && (!compacted.length || !compacted[compacted.length - 1].trim())) return;
      compacted.push(line);
    });
    return compacted.join('\n').trim();
  }

  function formatAnnotation(data, settings) {
    const template = getTemplate(settings);
    const values = {
      text: data.text || '',
      note: data.note || '',
      url: data.url || '',
      title: data.title || '',
      author: data.author || '',
      site: data.site || '',
      published: globalThis.WSCitationFormats?.formatPublishedRu
        ? WSCitationFormats.formatPublishedRu(data.published)
        : (data.published || ''),
      date: formatDate(data.date || new Date())
    };

    return applyTemplate(template, values);
  }

  function buildFilename(text, ext) {
    const slug = (text || 'annotation')
      .trim()
      .slice(0, 40)
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'annotation';

    const now = new Date();
    const datePart = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');

    return `${slug}_${datePart}.${ext}`;
  }

  function downloadAnnotation(data, settings) {
    const format = settings?.annotationSaveFormat === 'md' ? 'md' : 'txt';
    const content = formatAnnotation(data, settings);
    const mime = format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = buildFilename(data.text, format);
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return {
    formatAnnotation,
    buildFilename,
    downloadAnnotation
  };
})();

var WSAnnotationExport = globalThis.WSAnnotationExport;
