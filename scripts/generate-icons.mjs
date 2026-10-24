/**
 * Generate lib/icon-paths.js from Lucide Icons and raster extension PNGs.
 * Requires: npm install lucide sharp (dev-only, see icons/ATTRIBUTION.md)
 *
 * Run: node scripts/generate-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import * as lucide from 'lucide';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** camelCase keys used across the extension → Lucide export names */
const ICON_MAP = {
  search: 'Search',
  x: 'X',
  chevronLeft: 'ChevronLeft',
  chevronRight: 'ChevronRight',
  chevronDown: 'ChevronDown',
  highlighter: 'Highlighter',
  bookOpen: 'BookOpen',
  settings: 'Settings',
  gripVertical: 'GripVertical',
  arrowLeft: 'ArrowLeft',
  panelRight: 'PanelRight',
  panelRightClose: 'PanelRightClose',
  list: 'List',
  penLine: 'PenLine',
  trash2: 'Trash2',
  alertTriangle: 'AlertTriangle',
  textSelect: 'TextSelect',
  rotateCcw: 'RotateCcw',
  undo2: 'Undo2',
  redo2: 'Redo2',
  keyboard: 'Keyboard',
  activity: 'Activity',
  alignLeft: 'AlignLeft',
  download: 'Download',
  palette: 'Palette',
  scissors: 'Scissors',
  library: 'Library',
  languages: 'Languages',
  bookMarked: 'BookMarked',
  scan: 'Scan',
  filter: 'Filter',
  info: 'Info',
  scanSearch: 'ScanSearch'
};

function nodeToSvg([tag, attrs]) {
  const parts = Object.entries(attrs)
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, '&quot;')}"`)
    .join(' ');
  return `<${tag} ${parts}/>`;
}

function lucideToInner(exportName) {
  const nodes = lucide[exportName];
  if (!nodes) {
    throw new Error(`Lucide icon not found: ${exportName}`);
  }
  return nodes.map(nodeToSvg).join('');
}

function buildPaths() {
  const paths = {};
  for (const [key, exportName] of Object.entries(ICON_MAP)) {
    paths[key] = lucideToInner(exportName);
  }
  return paths;
}

function writeIconPaths(paths) {
  const out = `/** Auto-generated from Lucide Icons (ISC). Run: node scripts/generate-icons.mjs */\n`
    + `globalThis.WS_ICON_PATHS = ${JSON.stringify(paths, null, 2)};\n`
    + `var WS_ICON_PATHS = globalThis.WS_ICON_PATHS;\n`;
  fs.writeFileSync(path.join(ROOT, 'lib', 'icon-paths.js'), out, 'utf8');
}

const BRAND = {
  bg: '#2563EB',
  fg: '#FFFFFF',
  radius: 28
};

function buildBrandSvg(inner, { size = 128, padding = 24, stroke = 2.5 } = {}) {
  const innerSize = size - padding * 2;
  const scale = innerSize / 24;
  const tx = padding;
  const ty = padding;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${BRAND.radius}" fill="${BRAND.bg}"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})" fill="none" stroke="${BRAND.fg}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    ${inner}
  </g>
</svg>`;
}

async function writeExtensionIcons(inner) {
  const iconsDir = path.join(ROOT, 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });

  const masterSvg = buildBrandSvg(inner, { size: 128 });
  fs.writeFileSync(path.join(iconsDir, 'icon-source.svg'), masterSvg, 'utf8');

  for (const size of [16, 32, 48, 128]) {
    const svg = buildBrandSvg(inner, {
      size: 128,
      padding: size <= 16 ? 28 : size <= 32 ? 26 : 24,
      stroke: size <= 16 ? 2.75 : 2.5
    });
    const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
    fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  }
}

const paths = buildPaths();
writeIconPaths(paths);
await writeExtensionIcons(paths.scanSearch);
console.log(`Generated ${Object.keys(paths).length} UI icons and extension PNGs in icons/`);
