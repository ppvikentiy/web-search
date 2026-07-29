/**
 * Unit tests for reader article export (.md).
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const ARTICLE_HTML = `
  <header class="ws-reader-header">
    <h1 id="ws-reader-title">Тестовая статья</h1>
    <p id="ws-reader-meta" class="ws-reader-meta">Автор · example.com</p>
  </header>
  <div id="ws-reader-content" class="ws-reader-content">
    <p>Первый абзац с <strong>важным</strong> текстом.</p>
    <h2>Подзаголовок</h2>
    <p>Второй абзац.</p>
  </div>
`;

const dom = new JSDOM(
  `<!DOCTYPE html><html lang="ru"><head></head><body>
    <article class="ws-reader-article">${ARTICLE_HTML}</article>
  </body></html>`,
  {
    url: 'chrome-extension://fake-ext-id/reader/reader.html?id=test-export',
    runScripts: 'outside-only'
  }
);

const { window } = dom;
const { document } = window;

function loadScript(relativePath) {
  const code = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInContext(code, window);
}

loadScript('lib/defaults.js');
loadScript('lib/turndown.bundle.min.js');
loadScript('lib/turndown-plugin-gfm.js');
loadScript('lib/reader-export.js');

const payload = {
  title: 'Тестовая статья',
  byline: 'Автор',
  siteName: 'Example',
  publishedTime: '2026-07-19T12:00:00.000Z',
  sourceUrl: 'https://example.com/article-test',
  excerpt: 'Краткое описание статьи.'
};

const articleEl = document.querySelector('.ws-reader-article');

let passed = 0;
let failed = 0;

function step(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

console.log('\n=== Reader export tests ===\n');

step('buildFilename slugifies cyrillic title', () => {
  const name = window.WSReaderExport.buildFilename('Пример статьи для экспорта', 'md');
  if (!name.endsWith('.md')) throw new Error(`expected .md extension, got ${name}`);
  if (!/^\p{L}[\p{L}\p{N}-]*_\d{4}-\d{2}-\d{2}\.md$/u.test(name)) {
    throw new Error(`unexpected filename shape: ${name}`);
  }
});

step('buildMarkdown includes title, metadata and body', () => {
  const html = articleEl.querySelector('.ws-reader-content').innerHTML;
  const md = window.WSReaderExport.buildMarkdown(payload, html);
  if (!md.startsWith('# Тестовая статья')) throw new Error('missing title');
  if (!md.includes('[Example](https://example.com/article-test)')) throw new Error('missing source link');
  if (!md.includes('**важным**')) throw new Error('missing converted emphasis');
  if (!md.includes('## Подзаголовок')) throw new Error('missing heading');
});

step('annotations section appears only when requested', () => {
  const html = articleEl.querySelector('.ws-reader-content').innerHTML;
  const annotations = [{ text: 'Цитата из статьи', note: 'Моя заметка' }];

  const without = window.WSReaderExport.buildMarkdown(payload, html, { includeAnnotations: false });
  if (without.includes('## Аннотации')) throw new Error('annotations section should be absent');

  const withAnn = window.WSReaderExport.buildMarkdown(payload, html, {
    includeAnnotations: true,
    annotations
  });
  if (!withAnn.includes('## Аннотации')) throw new Error('annotations heading missing');
  if (!withAnn.includes('> Цитата из статьи')) throw new Error('annotation quote missing');
  if (!withAnn.includes('Заметка: Моя заметка')) throw new Error('annotation note missing');
});

step('prepareExportRoot removes search marks and optionally annotations', () => {
  articleEl.querySelector('.ws-reader-content').innerHTML += ' <mark data-ws-mark-id="1">find</mark>';
  articleEl.querySelector('.ws-reader-content').innerHTML += ' <mark class="ws-annotation">note</mark>';

  const cleaned = window.WSReaderExport.prepareExportRoot(articleEl, { includeAnnotations: false });
  if (cleaned.querySelector('[data-ws-mark-id]')) throw new Error('search mark not removed');
  if (cleaned.querySelector('mark.ws-annotation')) throw new Error('annotation mark should be unwrapped');

  const withAnn = window.WSReaderExport.prepareExportRoot(articleEl, {
    includeAnnotations: true
  });
  if (!withAnn.querySelector('mark.ws-annotation')) {
    throw new Error('annotation mark should be kept when includeAnnotations is true');
  }

  articleEl.querySelector('.ws-reader-content').innerHTML = `
    <p>Первый абзац с <strong>важным</strong> текстом.</p>
    <h2>Подзаголовок</h2>
    <p>Второй абзац.</p>
  `;
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
