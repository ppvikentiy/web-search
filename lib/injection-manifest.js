/**
 * Single source of truth for content-script injection lists and version.
 * Loaded first in CONTENT_FILES so content.js can read the version.
 */
globalThis.WS_CONTENT_SCRIPT_VERSION = '1.0.7';

globalThis.WS_CONTENT_FILES = [
  'lib/injection-manifest.js',
  'lib/defaults.js',
  'lib/settings-storage.js',
  'lib/icons.js',
  'lib/word-boundary.js',
  'lib/url-utils.js',
  'lib/dom-utils.js',
  'lib/archive-bytes.js',
  'lib/annotation-storage.js',
  'lib/user-dictionary.js',
  'lib/readability.js',
  'lib/dompurify.min.js',
  'lib/jsqr.min.js',
  'lib/qr-utils.js',
  'content/morphology.js',
  'content/dom-search.js',
  'content/annotations.js',
  'content/annotation-pill.js',
  'lib/citation-formats.js',
  'lib/literature-export.js',
  'lib/annotation-export.js',
  'content/annotation-note.js',
  'content/dictionary-popup.js',
  'content/qr-decode.js',
  'content/search-sidebar.js',
  'content/reader-extract.js',
  'content/archive-collect.js',
  'content/content.js'
];

globalThis.WS_CSS_FILES = [
  'lib/tokens-injected.css',
  'lib/icons.css',
  'content/highlights.css',
  'content/annotations.css',
  'content/dictionary.css',
  'content/qr-decode.css',
  'content/sidebar.css'
];
