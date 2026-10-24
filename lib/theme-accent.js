/** Apply user accent color to CSS variables across extension UIs. */
globalThis.WSThemeAccent = globalThis.WSThemeAccent ?? (() => {
  const DEFAULT = '#7c6cf0';

  function normalizeHex(hex) {
    const raw = String(hex || '').trim();
    if (!raw) return '';
    const withHash = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#[0-9a-f]{3}$/i.test(withHash)) {
      const r = withHash[1];
      const g = withHash[2];
      const b = withHash[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    if (/^#[0-9a-f]{6}$/i.test(withHash)) {
      return withHash.toLowerCase();
    }
    return withHash.toLowerCase();
  }

  function applyAccent(hex) {
    const color = normalizeHex(hex) || DEFAULT;
    const root = document.documentElement;
    root.style.setProperty('--ws-user-accent', color);
    root.style.setProperty('--ws-accent', color);
    root.style.setProperty('--ws-icon-chip-accent', color);
    root.style.setProperty('--accent', color);
    root.style.setProperty('--nav-accent-label', color);
    root.style.setProperty('--ws-accent-hover', `color-mix(in srgb, ${color} 86%, #1e1b4b)`);
    root.style.setProperty('--accent-hover', `color-mix(in srgb, ${color} 86%, #1e1b4b)`);

    const widgetAccentProps = ['--ws-user-accent', '--ws-accent', '--accent'];
    for (const sel of ['#ws-search-sidebar', '#ws-annotation-pill']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      for (const prop of widgetAccentProps) {
        el.style.setProperty(prop, color);
      }
    }
  }

  function applyFromSettings(settings) {
    const accent = settings?.accentColor ?? globalThis.WS_DEFAULTS?.accentColor ?? DEFAULT;
    applyAccent(accent);
  }

  return { applyAccent, applyFromSettings, normalizeHex, DEFAULT };
})();
