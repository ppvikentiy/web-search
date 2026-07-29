/** Export reader article layout to .md */
globalThis.WSReaderExport = globalThis.WSReaderExport ?? (() => {
  function formatDate(value) {
    if (!value) return '';
    try {
      return new Date(value).toLocaleDateString('ru-RU');
    } catch {
      return String(value);
    }
  }

  function formatSite(url) {
    if (!url) return '';
    try {
      return new URL(url).hostname || url;
    } catch {
      return url;
    }
  }

  function buildFilename(title, ext) {
    const slug = (title || 'article')
      .trim()
      .slice(0, 60)
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'article';

    const now = new Date();
    const datePart = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');

    return `${slug}_${datePart}.${ext}`;
  }

  function buildMetaLine(payload = {}) {
    const parts = [];
    if (payload.byline) parts.push(payload.byline);
    const date = formatDate(payload.publishedTime);
    if (date) parts.push(date);
    if (payload.siteName) parts.push(payload.siteName);
    else if (payload.sourceUrl) parts.push(formatSite(payload.sourceUrl));
    return parts.join(' · ');
  }

  function buildMetaMarkdown(payload = {}) {
    const lines = [];
    const meta = buildMetaLine(payload);
    if (meta) lines.push(`*${meta}*`);
    if (payload.sourceUrl) {
      const label = payload.siteName || formatSite(payload.sourceUrl) || payload.sourceUrl;
      lines.push(`Источник: [${label}](${payload.sourceUrl})`);
    }
    if (payload.excerpt) lines.push('', `> ${payload.excerpt}`);
    return lines.join('\n');
  }

  function buildAnnotationsMarkdown(annotations = []) {
    if (!annotations.length) return '';

    const blocks = annotations.map((item) => {
      const text = (item.text || '').replace(/\s+/g, ' ').trim();
      const lines = [`> ${text}`];
      if (item.note) lines.push('', `Заметка: ${item.note}`);
      lines.push('', '---');
      return lines.join('\n');
    });

    return ['', '## Аннотации', '', ...blocks].join('\n');
  }

  function unwrapMarks(root, selector, replacementTag = 'span') {
    root.querySelectorAll(selector).forEach((mark) => {
      const replacement = document.createElement(replacementTag);
      while (mark.firstChild) {
        replacement.appendChild(mark.firstChild);
      }
      mark.replaceWith(replacement);
    });
  }

  function removeUiArtifacts(root) {
    root.querySelectorAll(
      '.ws-ann-note-editor, .ws-ann-popover, .ws-ann-menu, .ws-dict-popup, [data-ws-mark-id]'
    ).forEach((el) => el.remove());
  }

  function prepareExportRoot(articleEl, { includeAnnotations = false } = {}) {
    if (!articleEl) return null;

    const clone = articleEl.cloneNode(true);
    removeUiArtifacts(clone);
    unwrapMarks(clone, 'mark[data-ws-mark-id]');

    if (!includeAnnotations) {
      unwrapMarks(clone, 'mark.ws-annotation');
    }

    return clone;
  }

  function createTurndown() {
    if (typeof TurndownService === 'undefined') {
      throw new Error('TurndownService недоступен');
    }

    const service = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    });

    if (typeof turndownPluginGfm !== 'undefined' && turndownPluginGfm.gfm) {
      service.use(turndownPluginGfm.gfm);
    }

    return service;
  }

  function htmlToMarkdown(html) {
    const turndown = createTurndown();
    return turndown.turndown(html || '').trim();
  }

  function buildMarkdown(payload = {}, contentHtml = '', options = {}) {
    const { includeAnnotations = false, annotations = [] } = options;
    const title = (payload.title || 'Без заголовка').trim();
    const parts = [`# ${title}`];

    const meta = buildMetaMarkdown(payload);
    if (meta) parts.push('', meta);

    const body = htmlToMarkdown(contentHtml);
    if (body) parts.push('', body);

    if (includeAnnotations) {
      parts.push(buildAnnotationsMarkdown(annotations));
    }

    return `${parts.join('\n').trim()}\n`;
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadMarkdown(data) {
    const { payload = {}, articleEl, includeAnnotations = false, annotations = [] } = data;
    const clone = prepareExportRoot(articleEl, { includeAnnotations });
    const contentHtml = clone?.querySelector('.ws-reader-content')?.innerHTML
      || clone?.innerHTML
      || '';
    const markdown = buildMarkdown(payload, contentHtml, { includeAnnotations, annotations });
    const filename = buildFilename(payload.title, 'md');
    downloadBlob(markdown, filename, 'text/markdown;charset=utf-8');
    return { ok: true, filename };
  }

  async function download(data) {
    return downloadMarkdown(data);
  }

  async function copyToClipboard(text) {
    const value = String(text || '');
    if (!value) throw new Error('Нет текста для копирования');
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return { ok: true };
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    if (!ok) throw new Error('Не удалось скопировать в буфер обмена');
    return { ok: true };
  }

  function buildPlainText(payload = {}, articleEl) {
    const title = (payload.title || 'Без заголовка').trim();
    const contentEl = articleEl?.querySelector?.('.ws-reader-content') || articleEl;
    const body = (contentEl?.innerText || contentEl?.textContent || '').trim();
    const meta = buildMetaLine(payload);
    const parts = [title];
    if (meta) parts.push(meta);
    if (body) parts.push('', body);
    return parts.join('\n').trim();
  }

  async function copyPlainText({ articleEl, payload }) {
    const text = buildPlainText(payload, articleEl);
    return copyToClipboard(text);
  }

  async function copyMarkdown({ articleEl, payload, includeAnnotations = false, annotations = [] }) {
    const clone = prepareExportRoot(articleEl, { includeAnnotations });
    const contentHtml = clone?.querySelector('.ws-reader-content')?.innerHTML
      || clone?.innerHTML
      || '';
    const markdown = buildMarkdown(payload, contentHtml, { includeAnnotations, annotations });
    return copyToClipboard(markdown);
  }

  return {
    buildFilename,
    buildMetaLine,
    buildMetaMarkdown,
    buildMarkdown,
    buildPlainText,
    buildAnnotationsMarkdown,
    prepareExportRoot,
    htmlToMarkdown,
    copyToClipboard,
    copyPlainText,
    copyMarkdown,
    download,
    downloadMarkdown
  };
})();

var WSReaderExport = globalThis.WSReaderExport;
