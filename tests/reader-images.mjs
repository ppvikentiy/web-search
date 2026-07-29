/**
 * Tests for reader image URL normalization.
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://example.com/article',
  runScripts: 'outside-only'
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;

const script = fs.readFileSync(path.join(root, 'content/reader-extract.js'), 'utf8');
vm.runInContext(script, window);

const { normalizeContentUrls, fixMediaElements } = window.WSReaderExtract;
const BASE = 'https://news.example.com/posts/123';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const lazyHtml = `
  <p>Text</p>
  <img class="lazy" data-src="/images/photo.jpg" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
  <img data-original="https://cdn.example.com/other.png">
`;

const normalized = normalizeContentUrls(lazyHtml, BASE);
assert(normalized.includes('https://news.example.com/images/photo.jpg'), 'lazy data-src should become absolute src');
assert(normalized.includes('referrerpolicy="no-referrer"'), 'images should have no-referrer policy');
assert(!normalized.includes('data:image/gif'), 'placeholder data URLs should be replaced');

const srcsetHtml = '<img srcset="/img/a.jpg 1x, /img/b.jpg 2x">';
const srcsetResult = normalizeContentUrls(srcsetHtml, BASE);
assert(srcsetResult.includes('https://news.example.com/img/a.jpg 1x'), 'srcset URLs should be absolute');
assert(srcsetResult.includes('https://news.example.com/img/b.jpg 2x'), 'srcset second URL should be absolute');

const container = window.document.createElement('div');
container.innerHTML = '<img data-src="/live.jpg">';
fixMediaElements(container, BASE);
assert(
  container.querySelector('img').getAttribute('src') === 'https://news.example.com/live.jpg',
  'fixMediaElements should resolve lazy src on live DOM'
);

console.log('reader-images: all tests passed');
