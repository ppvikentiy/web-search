/**
 * Minimal harness for pure functions. Run: node --test test/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function createSandbox() {
  const sandbox = {
    console,
    Set,
    Map,
    WeakMap,
    JSON,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    Uint8Array,
    ArrayBuffer,
    URL,
    TextDecoder,
    TextEncoder,
    Blob: class Blob {
      constructor(parts) {
        this._text = (parts || []).join('');
        this.size = this._text.length;
      }
    },
    btoa(data) {
      return Buffer.from(data, 'binary').toString('base64');
    },
    atob(data) {
      return Buffer.from(data, 'base64').toString('binary');
    },
    chrome: {
      runtime: { id: 'test', getURL: () => '' },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

function loadScript(sandbox, relPath) {
  const filename = path.join(ROOT, relPath);
  const code = fs.readFileSync(filename, 'utf8');
  vm.runInNewContext(code, sandbox, { filename: relPath });
  return sandbox;
}

function loadCore() {
  const sandbox = createSandbox();
  loadScript(sandbox, 'lib/defaults.js');
  loadScript(sandbox, 'lib/word-boundary.js');
  loadScript(sandbox, 'lib/url-utils.js');
  loadScript(sandbox, 'lib/archive-bytes.js');
  loadScript(sandbox, 'lib/offline-archive.js');
  loadScript(sandbox, 'content/morphology.js');
  loadScript(sandbox, 'content/dom-search.js');
  return sandbox;
}

test('word-boundary: whole-word match around cyrillic', () => {
  const s = loadCore();
  assert.equal(s.wsIsWordChar('к'), true);
  assert.equal(s.wsIsWordChar(' '), false);
  assert.equal(s.wsIsWholeWordMatch('кот сидел', 0, 3), true);
  assert.equal(s.wsIsWholeWordMatch('который', 0, 3), false);
  assert.equal(s.wsIsPhrase('кот кот'), true);
  assert.equal(s.wsIsPhrase('кот'), false);
  assert.equal(JSON.stringify(s.wsSplitWords('  кот   кот  ')), JSON.stringify(['кот', 'кот']));
});

test('morphology expands inflected and capitalized forms', async () => {
  const s = loadCore();
  await s.WSMorphology.loadDictionary();
  const forms = s.WSMorphology.expandWord('кот', 'basic');
  assert.equal(forms.has('кота'), true);
  assert.equal(forms.has('котом'), true);
  assert.equal(forms.has('Кота'), true);
  assert.equal(forms.has('КОТ'), true);

  const queryForms = s.WSMorphology.expandQuery('дом', { useMorphology: true, caseSensitive: true });
  assert.equal(queryForms.has('дома'), true);
  assert.equal(queryForms.has('Дома'), true);
});

test('phrase matcher finds inflected capitalized words', () => {
  const s = loadCore();
  const matcher = {
    wordFormSets: s.WSMorphology.getPhraseWordFormSets(['кот'], {
      useMorphology: true,
      caseSensitive: true,
      morphDepth: 'basic'
    }),
    options: { caseSensitive: true, wholeWord: true, phraseMode: 'exact' }
  };
  const matches = s.WSDomSearch.findPhraseMatchesInText('Кота видели во дворе', matcher);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].text, 'Кота');
});

test('morphology: normalize and -ия stem', () => {
  const s = loadCore();
  assert.equal(s.WSMorphology.normalize('Ёлка'), 'елка');
  const candidates = s.WSMorphology.generateLemmaCandidates('история');
  assert.equal(candidates.has('истори'), true);
  const forms = s.WSMorphology.expandQuery('дом', { useMorphology: false, caseSensitive: false });
  assert.equal(forms.has('дом'), true);
  assert.equal(forms.has('ДОМ'), true);
});

test('phrase matcher does not emit overlapping matches', () => {
  const s = loadCore();
  const matcher = {
    wordFormSets: [new Set(['кот']), new Set(['кот'])],
    options: { caseSensitive: true, wholeWord: false, phraseMode: 'exact' }
  };
  const matches = s.WSDomSearch.findPhraseMatchesInText('кот кот кот', matcher);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].start, 0);
  assert.equal(matches[0].length, 7);
  assert.equal(matches[0].text, 'кот кот');
});

test('url-utils resolve and css extraction', () => {
  const s = loadCore();
  assert.equal(s.WSUrlUtils.resolveUrl('/a.css', 'https://ex.com/p/'), 'https://ex.com/a.css');
  assert.equal(s.WSUrlUtils.resolveUrl('javascript:void(0)', 'https://ex.com'), null);
  assert.equal(s.WSUrlUtils.isJavaScriptResource('https://ex.com/app.js'), true);
  assert.equal(s.WSUrlUtils.isJavaScriptResource('https://ex.com/a.css'), false);
  const urls = s.WSUrlUtils.extractUrlsFromCss(
    'body{background:url("/img.png")} @import url("more.css");',
    'https://ex.com/'
  );
  assert.equal(urls.has('https://ex.com/img.png'), true);
  assert.equal(urls.has('https://ex.com/more.css'), true);
});

test('offline-archive rewriteHtml and assetPath', () => {
  const s = loadCore();
  const html = '<html><script src="https://ex.com/a.js"></script><img src="https://ex.com/p.png"></html>';
  const rewritten = s.WSOfflineArchive.rewriteHtml(html, 'https://ex.com/', {
    'https://ex.com/p.png': 'assets/images/000-abcd.png'
  });
  assert.equal(rewritten.includes('<script'), false);
  assert.equal(rewritten.includes('assets/images/000-abcd.png'), true);
  const pathName = s.WSOfflineArchive.assetPath('https://ex.com/style.css', 'text/css', 1);
  assert.match(pathName, /^assets\/styles\/001-.+\.css$/);
  assert.match(s.WSOfflineArchive.buildFilename('Hello World!'), /hello-world_\d{4}-\d{2}-\d{2}\.zip/);
});

test('archive-bytes normalize and zip magic', () => {
  const s = loadCore();
  const raw = { 0: 0x50, 1: 0x4b, 2: 0, 3: 1 };
  const bytes = s.WSArchiveBytes.normalizeZipBytes(raw);
  assert.equal(bytes instanceof Uint8Array, true);
  assert.equal(s.WSArchiveBytes.isZipBytes(bytes), true);
  const encoded = s.WSArchiveBytes.bytesToBase64(Uint8Array.from([1, 2, 3]));
  assert.deepEqual([...s.WSArchiveBytes.base64ToBytes(encoded)], [1, 2, 3]);
});
