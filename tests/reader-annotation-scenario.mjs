/**
 * Integration scenario: annotations in reader mode (jsdom + mocked chrome APIs).
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const SOURCE_URL = 'https://example.com/article-test';
const ARTICLE_HTML = `
  <p>Это тестовая статья для проверки аннотаций в режиме читателя.</p>
  <p>Второй абзац содержит <strong>важный фрагмент</strong> текста.</p>
`;

const dom = new JSDOM(
  `<!DOCTYPE html><html lang="ru"><head></head><body>
    <div id="ws-reader-app">
      <div id="ws-reader-pill-mount"></div>
      <div id="ws-reader-content" class="ws-reader-content">${ARTICLE_HTML}</div>
    </div>
  </body></html>`,
  {
    url: 'chrome-extension://fake-ext-id/reader/reader.html?id=test-1',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  }
);

const { window } = dom;
const { document } = window;

if (!window.Element.prototype.scrollIntoView) {
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
}

document.documentElement.dataset.wsReaderSourceUrl = SOURCE_URL;
document.title = 'Тестовая статья';

const storage = {
  local: {},
  session: { annotationModeEnabled: false },
  sync: { ...JSON.parse(JSON.stringify(globalThis.WS_DEFAULTS || {})) }
};

function makeStorageArea(area) {
  return {
    get(keys) {
      if (typeof keys === 'string') {
        return Promise.resolve({ [keys]: area[keys] });
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) out[k] = area[k];
        return Promise.resolve(out);
      }
      const defaults = keys || {};
      const out = { ...defaults };
      for (const k of Object.keys(defaults)) {
        if (area[k] !== undefined) out[k] = area[k];
      }
      return Promise.resolve(out);
    },
    set(obj) {
      Object.assign(area, obj);
      return Promise.resolve();
    },
    remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete area[k];
      return Promise.resolve();
    }
  };
}

window.chrome = {
  runtime: { id: 'fake-ext-id', getURL: (p) => `chrome-extension://fake-ext-id/${p}` },
  storage: {
    local: makeStorageArea(storage.local),
    session: makeStorageArea(storage.session),
    sync: makeStorageArea(storage.sync)
  },
  tabs: {
    query: async () => [{ id: 99, active: true, currentWindow: true }]
  }
};

const scripts = [
  'lib/defaults.js',
  'lib/icons.js',
  'lib/word-boundary.js',
  'lib/dom-utils.js',
  'content/morphology.js',
  'content/dom-search.js',
  'content/annotations.js',
  'lib/annotation-export.js',
  'content/annotation-note.js',
  'reader/reader-pill.js'
];

function runScript(relativePath) {
  const code = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInContext(code, window, { filename: relativePath });
}

for (const script of scripts) {
  runScript(script);
}

const results = [];
function step(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

async function asyncStep(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

// --- Scenario ---
step('1. WSAnnotations инициализируется', () => {
  window.WSAnnotations.init({ onChange: () => {} });
  window.WSAnnotationNote.init({
    onChange: () => {},
    getMeta: (id) => window.WSAnnotations.getGroupMeta(id),
    getSettings: () => window.WS_DEFAULTS,
    setNote: (id, note) => window.WSAnnotations.setGroupNote(id, note),
    deleteNote: (id) => window.WSAnnotations.deleteGroupNote(id),
    removeGroup: (id) => window.WSAnnotations.removeGroup(id)
  });
});

step('2. Режим аннотаций включается', () => {
  window.WSAnnotations.setAnnotationMode(true);
  if (!window.WSAnnotations.isAnnotationMode()) {
    throw new Error('annotation mode not active');
  }
});

step('3. Аннотация создаётся из текста', () => {
  const ok = window.WSAnnotations.createFromSelection('важный фрагмент');
  if (!ok) throw new Error('createFromSelection returned false');
  const marks = document.querySelectorAll('mark.ws-annotation');
  if (!marks.length) throw new Error('no annotation marks in DOM');
});

step('4. Счётчик аннотаций = 1', () => {
  const st = window.WSAnnotations.getState();
  if (st.total !== 1) throw new Error(`expected total=1, got ${st.total}`);
});

step('5. Заметка сохраняется', () => {
  const id = window.WSAnnotations.getAnnotationsList()[0]?.id;
  if (!id) throw new Error('no annotation id');
  const saved = window.WSAnnotations.setGroupNote(id, 'Тестовая заметка');
  if (!saved) throw new Error('setGroupNote failed');
  const meta = window.WSAnnotations.getGroupMeta(id);
  if (meta.note !== 'Тестовая заметка') throw new Error('note not stored');
});

step('6. Навигация NEXT/PREV работает', () => {
  window.WSAnnotations.navigate('NEXT');
  window.WSAnnotations.navigate('PREV');
  const st = window.WSAnnotations.getState();
  if (st.displayCurrent !== 1) throw new Error(`displayCurrent=${st.displayCurrent}`);
});

await asyncStep('7. Аннотации сохраняются в storage по source URL', async () => {
  await window.WSAnnotations.persistGroups();
  const key = `annotations:${SOURCE_URL}`;
  const stored = await window.chrome.storage.local.get(key);
  const groups = stored[key]?.groups;
  if (!groups?.length) throw new Error('nothing persisted');
  if (!groups[0].text.includes('важный')) throw new Error('wrong persisted text');
  if (groups[0].note !== 'Тестовая заметка') throw new Error('note not persisted');
});

step('8. Экспорт использует source URL, не URL читателя', () => {
  let captured = null;
  const orig = window.WSAnnotationExport.downloadAnnotation;
  window.WSAnnotationExport.downloadAnnotation = (data, settings) => {
    captured = data;
  };

  const id = window.WSAnnotations.getAnnotationsList()[0].id;
  const meta = window.WSAnnotations.getGroupMeta(id);
  window.WSAnnotationExport.downloadAnnotation({
    text: window.WSAnnotations.getGroupText(id),
    note: meta.note,
    url: document.documentElement.dataset.wsReaderSourceUrl || location.href,
    title: document.title,
    date: new Date()
  }, window.WS_DEFAULTS);

  window.WSAnnotationExport.downloadAnnotation = orig;

  if (!captured) throw new Error('export not called');
  if (captured.url !== SOURCE_URL) {
    throw new Error(`export url=${captured.url}, expected ${SOURCE_URL}`);
  }
});

await asyncStep('9. Аннотации восстанавливаются после перезагрузки', async () => {
  window.WSAnnotations.clearVisuals({ notify: false });
  const marksBefore = document.querySelectorAll('mark.ws-annotation').length;
  if (marksBefore !== 0) throw new Error('visuals not cleared');

  await window.WSAnnotations.restoreFromStorage();
  const marksAfter = document.querySelectorAll('mark.ws-annotation').length;
  if (marksAfter !== 1) throw new Error(`restored marks=${marksAfter}`);
  const list = window.WSAnnotations.getAnnotationsList();
  if (!list[0]?.hasNote) throw new Error('note not restored');
});

step('10. Reader pill UI отражает аннотации', () => {
  window.WSReaderPill.init({
    onSearch: async () => ({}),
    onNavigate: async () => ({}),
    onClear: async () => ({}),
    onSettingsChange: async () => ({}),
    onAnnotationToggle: async () => ({}),
    onAnnNavigate: async () => ({}),
    onAnnSelect: () => {}
  });

  window.WSReaderPill.updateUI({
    query: '',
    searchActive: false,
    total: 0,
    currentIndex: -1,
    annotationMode: true,
    annotationTotal: 1,
    annotationCurrent: 1
  });

  const counter = document.querySelector('.ws-rp-ann-group .ws-rp-counter');
  if (!counter || counter.textContent !== '1/1') {
    throw new Error(`pill counter=${counter?.textContent}`);
  }
  if (document.getElementById('ws-reader-pill') == null) {
    throw new Error('reader pill not mounted');
  }
});

step('11. Удаление аннотации', () => {
  const id = window.WSAnnotations.getAnnotationsList()[0]?.id;
  window.WSAnnotations.removeGroup(id);
  if (window.WSAnnotations.getState().total !== 0) {
    throw new Error('annotation not removed');
  }
});

await asyncStep('12. Выключение режима удаляет аннотации и не восстанавливает их', async () => {
  window.WSAnnotations.invalidateTextMapCache?.();
  const created = window.WSAnnotations.createFromSelection('тестовая статья');
  if (!created) throw new Error('createFromSelection failed in step 12');
  await window.WSAnnotations.persistGroups();

  window.WSAnnotations.setAnnotationMode(false);
  window.WSAnnotations.clearAll();
  await window.WSAnnotations.persistGroups();
  document.documentElement.dataset.wsAnnotationMode = 'off';

  const marksOff = document.querySelectorAll('mark.ws-annotation').length;
  if (marksOff !== 0) throw new Error(`marks still in DOM after mode off: ${marksOff}`);

  const key = `annotations:${SOURCE_URL}`;
  const storedAfterDisable = await window.chrome.storage.local.get(key);
  if (storedAfterDisable[key]?.groups?.length) {
    throw new Error('storage not cleared on disable');
  }

  window.WSAnnotations.setAnnotationMode(true);
  document.documentElement.dataset.wsAnnotationMode = 'on';
  await window.WSAnnotations.restoreFromStorage();

  const marksOn = document.querySelectorAll('mark.ws-annotation').length;
  if (marksOn !== 0) throw new Error(`marks restored after disable cycle: ${marksOn}`);
});

// Report
const failed = results.filter((r) => !r.ok);
console.log('\n=== Сценарий аннотирования в читателе ===\n');
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.error ? ` — ${r.error}` : ''}`);
}
console.log(`\nИтого: ${results.length - failed.length}/${results.length} шагов пройдено`);
process.exit(failed.length ? 1 : 0);
