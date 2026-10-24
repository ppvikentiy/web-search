/**
 * Single source of truth for content-script injection lists and version.
 * Loaded first in CONTENT_FILES so content.js can read the version.
 */
globalThis.WS_CONTENT_SCRIPT_VERSION = '2.0.0';

globalThis.WS_CONTENT_FILES = [
  'lib/injection-manifest.js',
  'lib/defaults.js',
  'lib/settings-storage.js',
  'lib/icon-paths.js',
  'lib/icons.js',
  'lib/word-boundary.js',
  'lib/query-parser.js',
  'lib/url-utils.js',
  'lib/dom-utils.js',
  'lib/annotation-storage.js',
  'lib/theme-accent.js',
  'lib/readability.js',
  'lib/dompurify.min.js',
  'content/morphology.js',
  'content/dom-search.js',
  'content/annotations.js',
  'content/annotation-pill.js',
  'lib/page-meta.js',
  'lib/citation-formats.js',
  'lib/literature-export.js',
  'lib/annotation-export.js',
  'content/annotation-note.js',
  'content/search-sidebar.js',
  'content/reader-extract.js',
  'content/content.js'
];

globalThis.WS_CSS_FILES = [
  'lib/tokens-injected.css',
  'lib/icons.css',
  'content/highlights.css',
  'content/annotations.css',
  'content/sidebar.css'
];
