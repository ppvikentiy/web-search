/**
 * Lucide Icons (ISC) — paths in icon-paths.js (see icons/ATTRIBUTION.md).
 */
globalThis.WSIcons = (() => {
  const STROKE = 2;

  const PATHS = globalThis.WS_ICON_PATHS || {};

  function svg(name, size = 16) {
    const inner = PATHS[name];
    if (!inner) return '';
    return `<svg class="ws-icon ws-icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  /** Replace [data-ws-icon="name"] placeholders with SVG. Optional data-ws-icon-size. */
  function hydrate(root = document) {
    root.querySelectorAll('[data-ws-icon]').forEach((el) => {
      const name = el.getAttribute('data-ws-icon');
      const size = Number(el.getAttribute('data-ws-icon-size')) || 16;
      if (name) el.innerHTML = svg(name, size);
    });
  }

  return { svg, hydrate, names: Object.keys(PATHS) };
})();
