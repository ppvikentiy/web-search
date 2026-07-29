/**
 * Unit tests for reader copy helpers.
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const dom = new JSDOM(
  `<!DOCTYPE html><html lang="ru"><head></head><body>
    <article class="ws-reader-article">
      <div class="ws-reader-content">
        <p>Текст <strong>статьи</strong>.</p>
      </div>
    </article>
  </body></html>`,
  { url: 'chrome-extension://fake/reader/reader.html', runScripts: 'outside-only' }
);

const { window } = dom;

function loadScript(relativePath) {
  vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), window);
}

loadScript('lib/defaults.js');
loadScript('lib/turndown.bundle.min.js');
loadScript('lib/turndown-plugin-gfm.js');
loadScript('lib/reader-export.js');

const payload = {
  title: 'Заголовок',
  byline: 'Автор',
  sourceUrl: 'https://example.com/post'
};

const articleEl = window.document.querySelector('.ws-reader-article');

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

console.log('\n=== Reader copy tests ===\n');

step('buildPlainText includes title and body', () => {
  const text = window.WSReaderExport.buildPlainText(payload, articleEl);
  if (!text.startsWith('Заголовок')) throw new Error('missing title');
  if (!text.includes('Текст статьи')) throw new Error('missing body text');
});

step('buildMarkdown still available for copyMarkdown', () => {
  const html = articleEl.querySelector('.ws-reader-content').innerHTML;
  const md = window.WSReaderExport.buildMarkdown(payload, html);
  if (!md.includes('# Заголовок')) throw new Error('missing markdown title');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
