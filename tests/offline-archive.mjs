/**
 * Unit tests for offline archive builder helpers.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const sandbox = {
  globalThis: {},
  console,
  TextDecoder,
  TextEncoder,
  fetch: async () => ({ ok: false, status: 404 }),
  URL,
  Math,
  Promise,
  Set,
  Map,
  Array,
  Object,
  String,
  Number,
  Error,
  Uint8Array
};

sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);

function loadScript(relativePath) {
  const code = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInContext(code, context);
}

loadScript('lib/defaults.js');
loadScript('lib/fflate.min.js');
loadScript('lib/offline-archive.js');

const WSOfflineArchive = sandbox.WSOfflineArchive;

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

async function stepAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

console.log('\n=== Offline archive tests ===\n');

step('assetPath groups by kind', () => {
  const cssPath = WSOfflineArchive.assetPath('https://example.com/style.css', 'text/css', 1);
  const imgPath = WSOfflineArchive.assetPath('https://example.com/a.png', 'image/png', 2);
  if (!cssPath.startsWith('assets/styles/')) throw new Error(`unexpected css path: ${cssPath}`);
  if (!imgPath.startsWith('assets/images/')) throw new Error(`unexpected img path: ${imgPath}`);
});

step('rewriteHtml replaces absolute asset urls', () => {
  const html = '<link rel="stylesheet" href="https://example.com/a.css"><img src="/pic.png">';
  const mapping = {
    'https://example.com/a.css': 'assets/styles/001.css',
    'https://example.com/pic.png': 'assets/images/002.png'
  };
  const out = WSOfflineArchive.rewriteHtml(html, 'https://example.com/page', mapping);
  if (!out.includes('href="assets/styles/001.css"')) throw new Error('stylesheet not rewritten');
  if (!out.includes('src="assets/images/002.png"')) throw new Error('image not rewritten');
});

await stepAsync('buildZip creates index.html and README entries', async () => {
  const originalFetch = sandbox.fetch;
  sandbox.fetch = async (url) => {
    if (url.includes('a.css')) {
      return {
        ok: true,
        headers: { get: () => 'text/css' },
        arrayBuffer: async () => new TextEncoder().encode('body { color: red; }').buffer
      };
    }
    return { ok: false, status: 404, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) };
  };

  const result = await WSOfflineArchive.buildZip({
    title: 'Пример',
    baseUrl: 'https://example.com/page',
    url: 'https://example.com/page',
    html: '<html><head><link rel="stylesheet" href="https://example.com/a.css"></head><body><p>Hi</p></body></html>',
    resourceUrls: ['https://example.com/a.css']
  });

  sandbox.fetch = originalFetch;

  if (!result.ok) throw new Error('buildZip failed');
  if (!result.filename.endsWith('.zip')) throw new Error('missing zip filename');
  if (!(result.zipBytes instanceof Uint8Array)) throw new Error('zipBytes missing');
  if (result.zipBytes[0] !== 0x50 || result.zipBytes[1] !== 0x4b) {
    throw new Error('zipBytes missing PK signature');
  }

  const files = sandbox.fflate.unzipSync(result.zipBytes);
  if (!files['index.html']) throw new Error('index.html missing in zip');
  if (!files['README.txt']) throw new Error('README missing in zip');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
