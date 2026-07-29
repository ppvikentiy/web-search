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

  function getTemplate(settings) {
    const format = settings?.annotationSaveFormat === 'md' ? 'md' : 'txt';
    if (format === 'md') {
      return settings?.annotationSaveTemplateMd || WS_DEFAULTS.annotationSaveTemplateMd;
    }
    return settings?.annotationSaveTemplateTxt || WS_DEFAULTS.annotationSaveTemplateTxt;
  }

  function formatAnnotation(data, settings) {
    const template = getTemplate(settings);
    const values = {
      text: data.text || '',
      note: data.note || '',
      url: data.url || '',
      title: data.title || '',
      date: formatDate(data.date || new Date())
    };

    return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
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
