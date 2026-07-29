/**
 * Unit tests for bibliographic citation presets.
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  url: 'https://example.com/',
  runScripts: 'outside-only'
});

const { window } = dom;

function loadScript(relativePath) {
  const code = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInContext(code, window);
}

loadScript('lib/defaults.js');
loadScript('lib/citation-formats.js');
loadScript('lib/literature-export.js');

const { WSCitationFormats, WSLiteratureExport } = window;

const SAMPLE = {
  url: 'https://example.com/article',
  title: 'Название статьи',
  date: new Date(2026, 6, 8, 16, 30)
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(value, part, message) {
  assert(value.includes(part), `${message}. Expected to include "${part}", got: ${value}`);
}

const presets = ['gost', 'apa7', 'mla9', 'chicago'];

for (const preset of presets) {
  const formatted = WSCitationFormats.formatBibliography(preset, SAMPLE);
  assert(typeof formatted === 'string' && formatted.length > 0, `${preset}: empty result`);
  assertIncludes(formatted, SAMPLE.url, `${preset}: missing url`);
  assertIncludes(formatted, SAMPLE.title, `${preset}: missing title`);
  assertIncludes(formatted, 'example.com', `${preset}: missing site name`);
}

assertIncludes(
  WSCitationFormats.formatBibliography('gost', SAMPLE),
  '08.07.2026',
  'gost: wrong access date format'
);

assertIncludes(
  WSCitationFormats.formatBibliography('gost', SAMPLE),
  '[Электронный ресурс]',
  'gost: missing electronic resource marker'
);

assertIncludes(
  WSCitationFormats.formatBibliography('apa7', SAMPLE),
  '(n.d.)',
  'apa7: missing n.d.'
);

assertIncludes(
  WSCitationFormats.formatBibliography('apa7', SAMPLE),
  'Retrieved July 8, 2026, from',
  'apa7: wrong retrieved line'
);

assertIncludes(
  WSCitationFormats.formatBibliography('mla9', SAMPLE),
  'accessed 8 July 2026',
  'mla9: wrong accessed date'
);

assertIncludes(
  WSCitationFormats.formatBibliography('chicago', SAMPLE),
  'example.com, "Название статьи," accessed July 8, 2026',
  'chicago: wrong footnote format'
);

const meta = WSCitationFormats.parseSourceMeta(SAMPLE);
assert(meta.siteName === 'example.com', 'parseSourceMeta: wrong site name');
assert(meta.title === 'Название статьи', 'parseSourceMeta: wrong title');

const literatureText = WSLiteratureExport.formatLiterature(SAMPLE, { literatureCitationPreset: 'apa7' });
assertIncludes(literatureText, '(n.d.)', 'formatLiterature: preset not applied');

const filename = WSLiteratureExport.buildFilename(SAMPLE);
assert(/^example-com_\d{4}-\d{2}-\d{2}\.txt$/.test(filename), `buildFilename: unexpected name "${filename}"`);

console.log('citation-formats: all tests passed');
