/**
 * Preset color swatches + custom picker (hidden native input stays in sync for forms).
 */
globalThis.WSSwatches = globalThis.WSSwatches ?? (() => {
  const PALETTES = {
    highlight: ['#ffff00', '#fef08a', '#bbf7d0', '#fbcfe8', '#bfdbfe'],
    currentHighlight: ['#ff9632', '#f97316', '#fbbf24', '#f472b6', '#60a5fa'],
    annotation: ['#7bed9f', '#6ee7b7', '#bef264', '#fbcfe8', '#fde68a'],
    annotationActive: ['#1e90ff', '#6366f1', '#8b5cf6', '#0ea5e9', '#22d3ee'],
    readerBg: ['#ffffff', '#fefce8', '#ffe5b8', '#f0fdf4', '#0f172a'],
    popupBg: ['#1a1a2e', '#1e293b', '#2c2c2e', '#ffffff', '#f8fafc'],
    popupText: ['#f0f0f5', '#ffffff', '#1d1d1f', '#0f172a', '#e2e8f0'],
    popupMuted: ['#a0a0b8', '#6b7280', '#98989d', '#64748b', '#cbd5e1'],
    accent: ['#7c6cf0', '#6366f1', '#8b5cf6', '#2563eb', '#0f172a'],
    pillBg: ['#ffffff', '#f8fafc', '#f0ecff', '#1a1a2e', '#1e293b']
  };

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

  /**
   * @param {HTMLInputElement} input - type="color", kept for form value
   * @param {{ presets?: string[], onChange?: (hex: string) => void }} options
   */
  function mount(input, options = {}) {
    if (!input || input.dataset.wsSwatchesMounted === '1') {
      return { refresh: () => {} };
    }
    input.dataset.wsSwatchesMounted = '1';
    input.classList.add('ws-color-input-native');
    input.tabIndex = -1;

    const presets = options.presets || PALETTES.highlight;
    const container = document.createElement('div');
    container.className = 'swatches';
    input.insertAdjacentElement('beforebegin', container);

    const presetButtons = [];

    function syncActive() {
      const current = normalizeHex(input.value);
      let matchedPreset = false;
      for (const btn of presetButtons) {
        const active = normalizeHex(btn.dataset.color) === current;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        if (active) matchedPreset = true;
      }
      const customActive = !matchedPreset && Boolean(current);
      customLabel.classList.toggle('active', customActive);
      customLabel.setAttribute('aria-pressed', customActive ? 'true' : 'false');
      if (current) customPicker.value = current;
    }

    function setValue(hex, { emit = true } = {}) {
      const value = normalizeHex(hex);
      if (!value) return;
      input.value = value;
      syncActive();
      if (!emit) return;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      options.onChange?.(value);
    }

    for (const hex of presets) {
      const color = normalizeHex(hex);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch-btn';
      btn.dataset.color = color;
      btn.style.background = color;
      btn.setAttribute('aria-label', color);
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => setValue(color));
      container.appendChild(btn);
      presetButtons.push(btn);
    }

    const customLabel = document.createElement('label');
    customLabel.className = 'swatch-btn swatch-btn-custom';
    customLabel.title = 'Свой цвет';
    const customPicker = document.createElement('input');
    customPicker.type = 'color';
    customPicker.setAttribute('aria-label', 'Свой цвет');
    customLabel.appendChild(customPicker);
    container.appendChild(customLabel);

    customPicker.addEventListener('input', () => setValue(customPicker.value));

    if (input.value) {
      syncActive();
    }

    return {
      refresh: syncActive,
      setValue: (hex) => setValue(hex, { emit: false })
    };
  }

  return { mount, PALETTES, normalizeHex };
})();
