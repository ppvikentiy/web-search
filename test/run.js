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
  loadScript(sandbox, 'lib/query-parser.js');
  loadScript(sandbox, 'lib/url-utils.js');
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

function queryShape(parsed) {
  return parsed.branches.map((branch) => ({
    required: branch.required.map((phrase) => phrase.map((atom) => atom.value)),
    banned: branch.banned.map((phrase) => phrase.map((atom) => atom.value))
  }));
}

function searchOptions(overrides = {}) {
  return {
    caseSensitive: true,
    wholeWord: true,
    matchMode: 'whole',
    useMorphology: false,
    phraseMode: 'exact',
    morphDepth: 'basic',
    ...overrides
  };
}

function matchTexts(sandbox, query, text, options) {
  const matcher = sandbox.WSDomSearch.compileMatcher(query, searchOptions(options));
  if (!matcher) return '[]';
  return JSON.stringify(sandbox.WSDomSearch.findCompiledMatches(text, matcher).map((match) => match.text));
}

test('query parser: phrase, or, and, quotes, exclusion and grouping', () => {
  const s = loadCore();
  const shape = (query) => JSON.stringify(queryShape(s.WSQueryParser.parse(query)));

  assert.equal(shape('кот сидел'), JSON.stringify([
    { required: [['кот', 'сидел']], banned: [] }
  ]));
  assert.equal(shape('кот | пёс'), JSON.stringify([
    { required: [['кот']], banned: [] },
    { required: [['пёс']], banned: [] }
  ]));
  assert.equal(shape('кот & пёс'), JSON.stringify([
    { required: [['кот'], ['пёс']], banned: [] }
  ]));
  assert.equal(shape('"точная фраза"'), JSON.stringify([
    { required: [['точная', 'фраза']], banned: [] }
  ]));
  assert.equal(s.WSQueryParser.parse('"точная фраза"').branches[0].required[0][0].quoted, true);
  assert.equal(shape('кот -пёс'), JSON.stringify([
    { required: [['кот']], banned: [['пёс']] }
  ]));
  assert.equal(shape('(кот | кошка) сидел'), JSON.stringify([
    { required: [['кот', 'сидел']], banned: [] },
    { required: [['кошка', 'сидел']], banned: [] }
  ]));
  assert.equal(shape('кот -(пёс | лиса)'), JSON.stringify([
    { required: [['кот']], banned: [['пёс'], ['лиса']] }
  ]));
  assert.equal(s.WSQueryParser.parse('кол*').branches[0].required[0][0].wildcard, true);
  assert.equal(shape('кот - пёс'), JSON.stringify([
    { required: [['кот']], banned: [['пёс']] }
  ]));
  assert.equal(shape('кот|пёс'), JSON.stringify([
    { required: [['кот']], banned: [] },
    { required: [['пёс']], banned: [] }
  ]));
});

test('compiled query matches alternatives, exclusion, wildcards and yo', () => {
  const s = loadCore();
  assert.equal(matchTexts(s, 'кот | пёс', 'пёс и кот'), JSON.stringify(['пёс', 'кот']));
  assert.equal(matchTexts(s, 'кот & пёс', 'пёс и кот'), JSON.stringify(['пёс', 'кот']));
  assert.equal(matchTexts(s, 'кот & пёс', 'только кот'), '[]');
  assert.equal(matchTexts(s, 'кот -пёс', 'кот и пёс'), '[]');
  assert.equal(matchTexts(s, 'кот -пёс', 'кот сидел'), JSON.stringify(['кот']));
  assert.equal(matchTexts(s, '(кот | пёс) сидел', 'здесь пёс сидел'), JSON.stringify(['пёс сидел']));
  assert.equal(matchTexts(s, 'кот сидел', 'кот, сидел', { phraseMode: 'flexible' }), JSON.stringify(['кот, сидел']));
  assert.equal(matchTexts(s, 'кот сидел', 'кот, сидел'), '[]');
  assert.equal(matchTexts(s, 'кол*', 'колокол и укол'), JSON.stringify(['колокол']));
  assert.equal(matchTexts(s, 'елка', 'В лесу ёлка'), JSON.stringify(['ёлка']));
  assert.equal(matchTexts(s, 'елка', 'В лесу Елка'), '[]');
  assert.equal(
    matchTexts(s, '"кот"', 'кота видели', { useMorphology: true, wholeWord: true, matchMode: 'whole' }),
    '[]'
  );
  assert.equal(
    matchTexts(s, 'кот', 'кота видели', { useMorphology: true, wholeWord: true, matchMode: 'whole' }),
    JSON.stringify(['кота'])
  );
  assert.equal(matchTexts(s, 'кот', 'который'), '[]');
  assert.equal(matchTexts(s, 'кот сидел', 'котик сидел'), '[]');
  assert.equal(matchTexts(s, '«елка»', 'ёлка'), JSON.stringify(['ёлка']));
});

test('search segments join inline text and keep blocks apart', () => {
  const s = loadCore();
  s.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 };
  loadScript(s, 'lib/dom-utils.js');

  const TEXT = 3;
  const EL = 1;
  function text(value, parent) {
    return { nodeType: TEXT, nodeValue: value, parentElement: parent, parentNode: parent };
  }
  function el(tag, children) {
    const node = {
      nodeType: EL,
      tagName: tag.toUpperCase(),
      childNodes: [],
      parentElement: null,
      isContentEditable: false
    };
    for (const child of children) {
      const item = typeof child === 'string' ? text(child, node) : child;
      item.parentElement = node;
      item.parentNode = node;
      node.childNodes.push(item);
    }
    return node;
  }

  const config = { excludeTags: [], excludeSelectors: [] };
  const inline = el('p', [el('b', ['кот']), ' ', el('i', ['сидел'])]);
  const joined = s.WSDomSearch.collectSearchSegments(inline, config);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].text, 'кот сидел');

  const glued = el('p', [el('b', ['кот']), el('i', ['сидел'])]);
  assert.equal(s.WSDomSearch.collectSearchSegments(glued, config)[0].text, 'котсидел');

  const blocks = el('div', [el('p', ['кот']), el('p', ['сидел'])]);
  const parts = s.WSDomSearch.collectSearchSegments(blocks, config);
  assert.equal(JSON.stringify(parts.map((part) => part.text)), JSON.stringify(['кот', 'сидел']));

  const matcher = s.WSDomSearch.compileMatcher('кот сидел', searchOptions());
  const found = s.WSDomSearch.findCompiledMatches(joined[0].text, matcher);
  assert.equal(found.length, 1);
  const pieces = s.WSDomSearch.locateMatchPieces(joined[0], found[0]);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].text, 'кот');
  assert.equal(pieces[1].text, 'сидел');

  const hyphen = el('p', ['пере\u00adнос']);
  assert.equal(s.WSDomSearch.collectSearchSegments(hyphen, config)[0].text, 'перенос');
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

function loadCitation() {
  const sandbox = createSandbox();
  loadScript(sandbox, 'lib/defaults.js');
  loadScript(sandbox, 'lib/page-meta.js');
  loadScript(sandbox, 'lib/citation-formats.js');
  loadScript(sandbox, 'lib/literature-export.js');
  loadScript(sandbox, 'lib/annotation-export.js');
  return sandbox;
}

function metaEl(attrs) {
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    textContent: attrs.text || ''
  };
}

function fakeDoc({ title = '', metas = [], scripts = [] } = {}) {
  return {
    title,
    querySelectorAll(selector) {
      if (selector === 'meta') return metas;
      if (selector === 'script[type="application/ld+json"]') return scripts;
      return [];
    }
  };
}

test('page meta: schema.org author, date and site win over meta tags', () => {
  const s = loadCitation();
  const doc = fakeDoc({
    title: 'Вкладка',
    metas: [
      metaEl({ name: 'author', content: 'Чужой Автор' }),
      metaEl({ property: 'og:site_name', content: 'Из меты' })
    ],
    scripts: [
      metaEl({
        text: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: 'Заголовок из схемы',
          datePublished: '2024-03-15',
          author: [
            { '@type': 'Person', name: 'By Иван Иванов' },
            { name: 'Мария Петрова' }
          ],
          publisher: { '@type': 'Organization', name: 'Example' }
        })
      })
    ]
  });

  const meta = s.WSPageMeta.extract(doc);
  assert.equal(meta.author, 'Иван Иванов, Мария Петрова');
  assert.equal(meta.published, '2024-03-15');
  assert.equal(meta.site, 'Example');
  assert.equal(meta.title, 'Заголовок из схемы');
});

test('page meta: falls back to meta tags', () => {
  const s = loadCitation();
  const doc = fakeDoc({
    title: 'Заголовок вкладки',
    metas: [
      metaEl({ name: 'author', content: 'https://example.com/jane' }),
      metaEl({ name: 'citation_author', content: 'Jane Doe' }),
      metaEl({ property: 'article:published_time', content: '2020' }),
      metaEl({ property: 'og:site_name', content: 'Example Journal' })
    ]
  });

  const meta = s.WSPageMeta.extract(doc);
  assert.equal(meta.author, 'Jane Doe');
  assert.equal(meta.published, '2020');
  assert.equal(meta.site, 'Example Journal');
  assert.equal(meta.title, 'Заголовок вкладки');
});

test('bibliography: undated page without an author keeps the previous form', () => {
  const s = loadCitation();
  const data = {
    url: 'https://example.com/article',
    title: 'Название статьи',
    date: new Date(2026, 6, 8)
  };

  assert.equal(
    s.WSCitationFormats.formatBibliography('gost', data),
    'Название статьи [Электронный ресурс] // example.com. – URL: https://example.com/article (дата обращения: 08.07.2026).'
  );
  assert.equal(
    s.WSCitationFormats.formatBibliography('apa7', data),
    'Название статьи. (n.d.). example.com. Retrieved July 8, 2026, from https://example.com/article'
  );
});

test('bibliography: author, site and publication date fill every preset', () => {
  const s = loadCitation();
  const data = {
    url: 'https://example.com/article',
    title: 'Название статьи',
    author: 'Иван Иванов, Мария Петрова',
    site: 'Example',
    published: '2024-03-15',
    date: new Date(2026, 6, 8)
  };

  assert.equal(
    s.WSCitationFormats.formatBibliography('gost', data),
    'Иванов И., Петрова М. Название статьи [Электронный ресурс] // Example. – 2024. – URL: https://example.com/article (дата обращения: 08.07.2026).'
  );
  assert.equal(
    s.WSCitationFormats.formatBibliography('apa7', data),
    'Иванов, И., & Петрова, М. (2024, March 15). Название статьи. Example. https://example.com/article'
  );
  assert.equal(
    s.WSCitationFormats.formatBibliography('mla9', data),
    'Иванов, Иван, and Мария Петрова. "Название статьи." Example, 15 Mar. 2024, https://example.com/article.'
  );
  assert.equal(
    s.WSCitationFormats.formatBibliography('chicago', data),
    'Иван Иванов and Мария Петрова, "Название статьи," Example, March 15, 2024, https://example.com/article.'
  );
});

test('bibliography: Russian full name keeps the surname, and the site is not repeated in the title', () => {
  const s = loadCitation();
  const text = s.WSCitationFormats.formatBibliography('gost', {
    url: 'https://example.com/article',
    title: 'Название статьи — Example',
    author: 'Иванов Иван Иванович, редактор',
    site: 'Example',
    published: '2024',
    date: new Date(2026, 6, 8)
  });

  assert.equal(
    text,
    'Иванов И. И. Название статьи [Электронный ресурс] // Example. – 2024. – URL: https://example.com/article (дата обращения: 08.07.2026).'
  );
});

test('page meta: publication date beats a generic date tag', () => {
  const s = loadCitation();
  const doc = fakeDoc({
    metas: [
      metaEl({ name: 'date', content: '1999-01-01' }),
      metaEl({ property: 'article:published_time', content: '2024-03-15' })
    ]
  });
  assert.equal(s.WSPageMeta.extract(doc).published, '2024-03-15');
});

test('literature file contains the citation, the quote and the note', () => {
  const s = loadCitation();
  const text = s.WSLiteratureExport.formatLiterature({
    url: 'https://example.com/article',
    title: 'Название статьи',
    author: 'Иван Иванов',
    site: 'Example',
    published: '2024-03-15',
    date: new Date(2026, 6, 8),
    text: 'Важная цитата',
    note: 'Моя заметка'
  }, { literatureCitationPreset: 'gost' });

  assert.equal(text, [
    'Иванов И. Название статьи [Электронный ресурс] // Example. – 2024. – URL: https://example.com/article (дата обращения: 08.07.2026).',
    '',
    '«Важная цитата»',
    '',
    'Моя заметка'
  ].join('\n'));
  assert.equal(
    s.WSLiteratureExport.buildFilename({
      text: 'Важная цитата',
      title: 'Название статьи',
      url: 'https://example.com/article',
      date: new Date(2026, 6, 8)
    }),
    'важная-цитата_2026-07-08.txt'
  );
});

test('quote template: legacy default gains source fields and drops empty ones', () => {
  const s = loadCitation();
  const legacy = s.WSAnnotationExport.formatAnnotation({
    text: 'Цитата',
    note: '',
    url: 'https://example.com/article',
    title: 'Название',
    date: new Date(2026, 6, 8, 16, 30),
    author: '',
    site: 'Example',
    published: '2024-03-15'
  }, {
    annotationSaveFormat: 'txt',
    annotationSaveTemplateTxt: '{text}\n\nИсточник: {url}\nДата сохранения: {date}'
  });

  assert.match(legacy, /^Цитата\n\nСайт: Example\nОпубликовано: 15\.03\.2024\nИсточник: https:\/\/example\.com\/article\nДата сохранения: /);

  const markdown = s.WSAnnotationExport.formatAnnotation({
    text: 'Цитата',
    note: 'Заметка',
    url: 'https://example.com/article',
    title: 'Название',
    author: '',
    site: '',
    published: '2024-03-15',
    date: new Date(2026, 6, 8, 16, 30)
  }, {
    annotationSaveFormat: 'md',
    annotationSaveTemplateMd: '> {text}\n\n{note}\n\n— [{title}]({url}), {date}'
  });

  assert.match(markdown, /^> Цитата\n\nЗаметка\n\n— \[Название\]\(https:\/\/example\.com\/article\), 15\.03\.2024,/);
});

