/**

 * Fixed toolbar pill for reader mode: search, annotations, background color.

 */

globalThis.WSReaderPill = (() => {

  const PILL_ID = 'ws-reader-pill';

  const I = (name, size) => WSIcons.svg(name, size);



  let root = null;

  let panelEl = null;

  let annListEl = null;

  let els = {};

  let callbacks = {};

  let settingsOpen = false;

  let annListOpen = false;

  let saveOpen = false;



  function createIconBtn(className, title, iconName, iconSize = 14) {

    const btn = document.createElement('button');

    btn.type = 'button';

    btn.className = className;

    btn.title = title;

    btn.setAttribute('aria-label', title);

    btn.innerHTML = I(iconName, iconSize);

    return btn;

  }



  function setPanelOpen(open) {

    settingsOpen = open;

    if (!panelEl || !els.btnSettings) return;

    panelEl.hidden = !open;

    els.btnSettings.setAttribute('aria-expanded', open ? 'true' : 'false');

    els.btnSettings.classList.toggle('ws-rp-active', open);

    if (open) setSavePanelOpen(false);

  }



  function setSavePanelOpen(open) {

    saveOpen = open;

    if (!els.savePanel || !els.btnSave) return;

    els.savePanel.hidden = !open;

    els.btnSave.setAttribute('aria-expanded', open ? 'true' : 'false');

    els.btnSave.classList.toggle('ws-rp-active', open);

    if (open) {

      setPanelOpen(false);

      setAnnListOpen(false);

    }

  }



  function setAnnListOpen(open) {

    annListOpen = open;

    if (!els.annListPanel || !els.btnAnnList) return;

    els.annListPanel.hidden = !open;

    els.btnAnnList.setAttribute('aria-expanded', open ? 'true' : 'false');

    els.btnAnnList.classList.toggle('ws-rp-active', open);

    if (open) setSavePanelOpen(false);

  }



  function build() {

    const mount = document.getElementById('ws-reader-pill-mount');

    if (!mount) return;



    root = document.createElement('div');

    root.id = PILL_ID;

    root.setAttribute('role', 'toolbar');

    root.setAttribute('aria-label', 'Поиск и аннотации');



    const bar = document.createElement('div');

    bar.className = 'ws-rp-bar';



    const searchWrap = document.createElement('div');

    searchWrap.className = 'ws-rp-search-wrap';

    searchWrap.innerHTML = `<span class="ws-rp-search-icon">${I('search', 14)}</span>`;



    els.query = document.createElement('input');

    els.query.type = 'text';

    els.query.className = 'ws-rp-query';

    els.query.placeholder = 'Поиск…';

    els.query.autocomplete = 'off';

    els.query.spellcheck = false;



    els.btnClear = createIconBtn('ws-rp-btn ws-rp-clear', 'Очистить', 'x', 12);

    els.btnClear.hidden = true;



    searchWrap.append(els.query, els.btnClear);



    els.btnSearch = createIconBtn('ws-rp-btn ws-rp-search-btn', 'Найти', 'search', 14);



    els.searchNavGroup = document.createElement('div');

    els.searchNavGroup.className = 'ws-rp-search-nav';

    els.searchNavGroup.hidden = true;



    els.btnSearchPrev = createIconBtn('ws-rp-btn ws-rp-nav', 'Предыдущее совпадение', 'chevronLeft', 14);

    els.searchCounter = document.createElement('span');

    els.searchCounter.className = 'ws-rp-counter';

    els.searchCounter.textContent = '0/0';

    els.btnSearchNext = createIconBtn('ws-rp-btn ws-rp-nav', 'Следующее совпадение', 'chevronRight', 14);



    els.searchNavGroup.append(els.btnSearchPrev, els.searchCounter, els.btnSearchNext);



    els.sepSearchAnn = document.createElement('span');

    els.sepSearchAnn.className = 'ws-rp-sep ws-rp-sep-search-ann';

    els.sepSearchAnn.setAttribute('aria-hidden', 'true');



    els.btnAnnMode = createIconBtn('ws-rp-btn ws-rp-ann-toggle', 'Режим аннотаций', 'highlighter', 14);



    els.annGroup = document.createElement('div');

    els.annGroup.className = 'ws-rp-ann-group';

    els.annGroup.hidden = true;



    els.btnAnnPrev = createIconBtn('ws-rp-btn ws-rp-nav', 'Предыдущая аннотация', 'chevronLeft', 14);

    els.annCounter = document.createElement('span');

    els.annCounter.className = 'ws-rp-counter';

    els.annCounter.textContent = '0/0';

    els.btnAnnNext = createIconBtn('ws-rp-btn ws-rp-nav', 'Следующая аннотация', 'chevronRight', 14);

    els.btnAnnList = createIconBtn('ws-rp-btn ws-rp-ann-list', 'Список аннотаций', 'list', 14);

    els.btnAnnList.setAttribute('aria-expanded', 'false');



    els.annGroup.append(els.btnAnnPrev, els.annCounter, els.btnAnnNext, els.btnAnnList);



    els.sepAnnSettings = document.createElement('span');

    els.sepAnnSettings.className = 'ws-rp-sep ws-rp-sep-ann-settings';

    els.sepAnnSettings.setAttribute('aria-hidden', 'true');



    els.btnSettings = createIconBtn('ws-rp-btn ws-rp-settings', 'Настройки читателя', 'settings', 14);

    els.btnSettings.setAttribute('aria-expanded', 'false');



    els.btnSave = createIconBtn(
      'ws-rp-btn ws-rp-save',
      'Сохранить статью (.md)',
      'download',
      14
    );

    els.btnSave.setAttribute('aria-expanded', 'false');



    bar.append(

      searchWrap,

      els.btnSearch,

      els.searchNavGroup,

      els.sepSearchAnn,

      els.btnAnnMode,

      els.annGroup,

      els.sepAnnSettings,

      els.btnSave,

      els.btnSettings

    );



    panelEl = document.createElement('div');

    panelEl.className = 'ws-rp-panel';

    panelEl.hidden = true;



    const optionsRow = document.createElement('div');

    optionsRow.className = 'ws-rp-options';

    optionsRow.innerHTML = `

      <label class="ws-rp-option"><input type="checkbox" class="ws-rp-opt-case"><span>Регистр</span></label>

      <label class="ws-rp-option"><input type="checkbox" class="ws-rp-opt-whole"><span>Целое слово</span></label>

      <label class="ws-rp-option"><input type="checkbox" class="ws-rp-opt-morph"><span>Формы</span></label>

    `;

    els.optCase = optionsRow.querySelector('.ws-rp-opt-case');

    els.optWhole = optionsRow.querySelector('.ws-rp-opt-whole');

    els.optMorph = optionsRow.querySelector('.ws-rp-opt-morph');



    const bgRow = document.createElement('div');

    bgRow.className = 'ws-rp-bg-row';

    bgRow.innerHTML = `

      <span class="ws-rp-bg-label">Фон чтения</span>

      <input type="color" class="ws-rp-bg-color" aria-label="Цвет фона чтения">

      <button type="button" class="ws-rp-bg-reset">Сброс</button>

    `;

    els.bgColor = bgRow.querySelector('.ws-rp-bg-color');

    els.bgReset = bgRow.querySelector('.ws-rp-bg-reset');



    const typoRow = document.createElement('div');

    typoRow.className = 'ws-rp-typo-row';

    typoRow.innerHTML = `

      <label class="ws-rp-typo-field">

        <span class="ws-rp-typo-label">Шрифт <span class="ws-rp-typo-value" data-for="font"></span></span>

        <input type="range" class="ws-rp-font-size" min="14" max="32" step="1" aria-label="Размер шрифта">

      </label>

      <label class="ws-rp-typo-field">

        <span class="ws-rp-typo-label">Межстрочный <span class="ws-rp-typo-value" data-for="line"></span></span>

        <input type="range" class="ws-rp-line-height" min="1.2" max="2.4" step="0.1" aria-label="Межстрочный интервал">

      </label>

      <label class="ws-rp-typo-field">

        <span class="ws-rp-typo-label">Ширина <span class="ws-rp-typo-value" data-for="width"></span></span>

        <input type="range" class="ws-rp-max-width" min="480" max="960" step="20" aria-label="Ширина колонки">

      </label>

    `;

    els.fontSize = typoRow.querySelector('.ws-rp-font-size');

    els.lineHeight = typoRow.querySelector('.ws-rp-line-height');

    els.maxWidth = typoRow.querySelector('.ws-rp-max-width');

    els.typoValueFont = typoRow.querySelector('[data-for="font"]');

    els.typoValueLine = typoRow.querySelector('[data-for="line"]');

    els.typoValueWidth = typoRow.querySelector('[data-for="width"]');



    panelEl.append(optionsRow, bgRow, typoRow);



    els.savePanel = document.createElement('div');

    els.savePanel.className = 'ws-rp-panel ws-rp-save-panel';

    els.savePanel.hidden = true;

    els.savePanel.innerHTML = `

      <div class="ws-rp-save-title">Сохранить статью</div>

      <label class="ws-rp-save-option">

        <input type="checkbox" class="ws-rp-save-annotations">

        <span>Включить аннотации</span>

      </label>

      <div class="ws-rp-copy-actions">

        <button type="button" class="ws-rp-copy-text">Копировать текст</button>

        <button type="button" class="ws-rp-copy-md">Копировать Markdown</button>

      </div>

      <p class="ws-rp-copy-status" aria-live="polite" hidden></p>

      <button type="button" class="ws-rp-save-submit">Скачать Markdown</button>

    `;

    els.saveAnnotations = els.savePanel.querySelector('.ws-rp-save-annotations');

    els.saveSubmit = els.savePanel.querySelector('.ws-rp-save-submit');

    els.copyTextBtn = els.savePanel.querySelector('.ws-rp-copy-text');

    els.copyMdBtn = els.savePanel.querySelector('.ws-rp-copy-md');

    els.copyStatus = els.savePanel.querySelector('.ws-rp-copy-status');



    els.annListPanel = document.createElement('div');

    els.annListPanel.className = 'ws-rp-ann-list-panel';

    els.annListPanel.hidden = true;



    annListEl = document.createElement('div');

    annListEl.className = 'ws-rp-ann-list';

    els.annListPanel.appendChild(annListEl);



    root.append(bar, panelEl, els.savePanel, els.annListPanel);

    mount.appendChild(root);



    bindEvents();

  }



  function bindEvents() {

    els.btnSearch?.addEventListener('click', () => callbacks.onSearch?.(els.query?.value?.trim() || ''));

    els.query?.addEventListener('keydown', (e) => {

      if (e.key === 'Enter') callbacks.onSearch?.(els.query?.value?.trim() || '');

    });

    els.query?.addEventListener('input', () => {

      if (els.btnClear) els.btnClear.hidden = !els.query?.value;

    });

    els.btnClear?.addEventListener('click', () => {

      if (els.query) els.query.value = '';

      els.btnClear.hidden = true;

      callbacks.onClear?.();

    });



    els.btnSearchPrev?.addEventListener('click', () => callbacks.onNavigate?.('PREV'));

    els.btnSearchNext?.addEventListener('click', () => callbacks.onNavigate?.('NEXT'));



    els.btnAnnMode?.addEventListener('click', async () => {

      if (els.btnAnnMode.disabled) return;

      const next = !els.btnAnnMode.classList.contains('ws-rp-active');

      els.btnAnnMode.disabled = true;

      try {

        await callbacks.onAnnotationToggle?.(next);

      } finally {

        els.btnAnnMode.disabled = false;

      }

    });



    els.btnAnnPrev?.addEventListener('click', () => callbacks.onAnnNavigate?.('PREV'));

    els.btnAnnNext?.addEventListener('click', () => callbacks.onAnnNavigate?.('NEXT'));

    els.btnAnnList?.addEventListener('click', () => {

      if (els.annGroup?.hidden) return;

      setAnnListOpen(!annListOpen);

    });



    els.btnSettings?.addEventListener('click', () => setPanelOpen(!settingsOpen));



    els.btnSave?.addEventListener('click', () => setSavePanelOpen(!saveOpen));



    els.saveSubmit?.addEventListener('click', async () => {

      if (els.saveSubmit.disabled) return;

      const includeAnnotations = Boolean(els.saveAnnotations?.checked);

      els.saveSubmit.disabled = true;

      try {

        await callbacks.onSave?.({ format: 'md', includeAnnotations });

        setSavePanelOpen(false);

      } finally {

        els.saveSubmit.disabled = false;

      }

    });



    els.savePanel?.addEventListener('keydown', (e) => {

      if (e.key === 'Escape') setSavePanelOpen(false);

    });



    [els.optCase, els.optWhole, els.optMorph].forEach((input) => {

      input?.addEventListener('change', () => {

        callbacks.onSettingsChange?.({

          caseSensitive: els.optCase?.checked ?? true,

          wholeWord: els.optWhole?.checked ?? true,

          useMorphology: els.optMorph?.checked ?? false,

          matchMode: els.optWhole?.checked ? 'whole' : 'substring'

        });

      });

    });



    els.bgColor?.addEventListener('input', () => {

      callbacks.onBgColorChange?.(els.bgColor.value);

    });

    els.bgColor?.addEventListener('change', () => {

      callbacks.onBgColorChange?.(els.bgColor.value, { commit: true });

    });

    els.bgReset?.addEventListener('click', () => {

      callbacks.onBgColorChange?.(null, { commit: true });

    });



    const emitAppearance = ({ commit = false } = {}) => {

      callbacks.onReaderAppearanceChange?.({

        readerFontSize: Number(els.fontSize?.value) || 18,

        readerLineHeight: Number(els.lineHeight?.value) || 1.7,

        readerMaxWidth: Number(els.maxWidth?.value) || 680

      }, { commit });

    };



    [els.fontSize, els.lineHeight, els.maxWidth].forEach((input) => {

      input?.addEventListener('input', () => {

        updateTypoLabels();

        emitAppearance();

      });

      input?.addEventListener('change', () => {

        updateTypoLabels();

        emitAppearance({ commit: true });

      });

    });



    els.copyTextBtn?.addEventListener('click', async () => {

      if (els.copyTextBtn.disabled) return;

      els.copyTextBtn.disabled = true;

      try {

        await callbacks.onCopyText?.();

        showCopyStatus('Текст скопирован');

      } catch (err) {

        showCopyStatus(err?.message || 'Не удалось скопировать', true);

      } finally {

        els.copyTextBtn.disabled = false;

      }

    });



    els.copyMdBtn?.addEventListener('click', async () => {

      if (els.copyMdBtn.disabled) return;

      els.copyMdBtn.disabled = true;

      try {

        await callbacks.onCopyMarkdown?.();

        showCopyStatus('Markdown скопирован');

      } catch (err) {

        showCopyStatus(err?.message || 'Не удалось скопировать', true);

      } finally {

        els.copyMdBtn.disabled = false;

      }

    });



    document.addEventListener('click', (e) => {

      if (!root || root.contains(e.target)) return;

      setPanelOpen(false);

      setAnnListOpen(false);

      setSavePanelOpen(false);

    });

  }



  function formatCounter(current, total) {

    const cur = total && current >= 0 ? current + 1 : 0;

    return `${cur}/${total}`;

  }



  function updateTypoLabels() {

    if (els.typoValueFont && els.fontSize) {

      els.typoValueFont.textContent = `${els.fontSize.value}px`;

    }

    if (els.typoValueLine && els.lineHeight) {

      els.typoValueLine.textContent = Number(els.lineHeight.value).toFixed(1);

    }

    if (els.typoValueWidth && els.maxWidth) {

      els.typoValueWidth.textContent = `${els.maxWidth.value}px`;

    }

  }



  let copyStatusTimer = null;

  function showCopyStatus(message, isError = false) {

    if (!els.copyStatus) return;

    els.copyStatus.textContent = message;

    els.copyStatus.hidden = !message;

    els.copyStatus.classList.toggle('ws-rp-copy-status-error', isError);

    clearTimeout(copyStatusTimer);

    copyStatusTimer = setTimeout(() => {

      if (els.copyStatus) els.copyStatus.hidden = true;

    }, 2500);

  }



  function applySettings(settings) {

    if (!settings) return;

    if (els.optCase) els.optCase.checked = settings.caseSensitive ?? true;

    if (els.optWhole) els.optWhole.checked = settings.wholeWord ?? true;

    if (els.optMorph) els.optMorph.checked = settings.useMorphology ?? false;

    if (els.bgColor) {

      els.bgColor.value = settings.readerBgColor || '#ffe5b8';

    }

    if (els.fontSize) els.fontSize.value = String(settings.readerFontSize ?? 18);

    if (els.lineHeight) els.lineHeight.value = String(settings.readerLineHeight ?? 1.7);

    if (els.maxWidth) els.maxWidth.value = String(settings.readerMaxWidth ?? 680);

    updateTypoLabels();

  }



  function updateUI(state) {

    if (!state) return;



    if (state.query !== undefined && els.query) {

      els.query.value = state.query;

    }

    if (els.btnClear) {

      els.btnClear.hidden = !els.query?.value;

    }



    const searchActive = Boolean(state.searchActive && state.query);

    const total = state.total ?? 0;

    const current = state.currentIndex ?? -1;



    if (els.searchNavGroup) {

      els.searchNavGroup.hidden = !searchActive;

    }

    if (els.searchCounter) els.searchCounter.textContent = formatCounter(current, total);

    if (els.btnSearchPrev) els.btnSearchPrev.disabled = total === 0;

    if (els.btnSearchNext) els.btnSearchNext.disabled = total === 0;



    const annMode = Boolean(state.annotationMode);

    els.btnAnnMode?.classList.toggle('ws-rp-active', annMode);



    const annTotal = state.annotationTotal ?? 0;

    const annCurrent = state.annotationCurrent ?? 0;

    const showAnnNav = annMode && annTotal > 0;



    if (els.annGroup) {

      els.annGroup.hidden = !showAnnNav;

    }

    if (!showAnnNav && annListOpen) {

      setAnnListOpen(false);

    }

    if (els.annCounter) {

      els.annCounter.textContent = annTotal ? `${annCurrent}/${annTotal}` : '0/0';

    }

    if (els.btnAnnPrev) els.btnAnnPrev.disabled = annTotal === 0;

    if (els.btnAnnNext) els.btnAnnNext.disabled = annTotal === 0;

    if (els.btnAnnList) els.btnAnnList.disabled = annTotal === 0;



    if (els.sepSearchAnn) {

      els.sepSearchAnn.hidden = false;

    }

    if (els.sepAnnSettings) {

      els.sepAnnSettings.hidden = !showAnnNav;

    }

  }



  function renderAnnList(items = [], activeId = null) {

    if (!annListEl) return;

    annListEl.innerHTML = '';



    if (!items.length) {

      const empty = document.createElement('div');

      empty.className = 'ws-rp-ann-empty';

      empty.textContent = 'Нет аннотаций';

      annListEl.appendChild(empty);

      return;

    }



    for (const item of items) {

      const row = document.createElement('button');

      row.type = 'button';

      row.className = 'ws-rp-ann-item';

      if (item.id === activeId) row.classList.add('ws-rp-ann-item-active');

      row.textContent = (item.text || '').replace(/\s+/g, ' ').trim().slice(0, 80)

        + ((item.text || '').length > 80 ? '…' : '');

      row.addEventListener('click', () => {

        callbacks.onAnnSelect?.(item.id);

        setAnnListOpen(false);

      });

      annListEl.appendChild(row);

    }

  }



  function init(cb = {}) {

    callbacks = cb;

    if (!root) build();

  }



  function destroy() {

    root?.remove();

    root = null;

    panelEl = null;

    annListEl = null;

    els = {};

    callbacks = {};

    settingsOpen = false;

    annListOpen = false;

    saveOpen = false;

  }



  return {

    init,

    destroy,

    updateUI,

    applySettings,

    renderAnnList,

    setPanelOpen,

    setAnnListOpen,

    setSavePanelOpen

  };

})();


