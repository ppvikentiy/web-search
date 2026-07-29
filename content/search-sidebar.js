/**
 * Docked search sidebar on the right edge of the page.
 */
if (globalThis.WSSearchSidebar?.destroy) {
  try { globalThis.WSSearchSidebar.destroy(); } catch { /* stale instance */ }
}
globalThis.WSSearchSidebar = (() => {
  const SIDEBAR_ID = 'ws-search-sidebar';
  const COLLAPSED_KEY = 'ws-sidebar-collapsed';

  let root = null;
  let panelEl = null;
  let tabEl = null;
  let els = {};
  let callbacks = {};
  let collapsed = false;
  let searchActiveOnPage = false;

  function loadCollapsed() {
    try {
      return sessionStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  }

  function saveCollapsed(value) {
    try {
      sessionStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
    } catch { /* ignore */ }
  }

  function setCollapsed(value) {
    collapsed = Boolean(value);
    if (!root) return;
    root.classList.toggle('ws-sidebar-collapsed', collapsed);
    saveCollapsed(collapsed);
  }

  function toggleCollapsed() {
    setCollapsed(!collapsed);
  }

  function updateClearButton() {
    if (!els.query || !els.btnClear) return;
    const show = Boolean(els.query.value) || searchActiveOnPage;
    els.btnClear.hidden = !show;
  }

  function setStatus(text, isError = false) {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.classList.toggle('ws-error', isError);
  }

  function isToggleOn(toggle) {
    return toggle?.classList.contains('ws-toggle-on') ?? false;
  }

  function setToggleOn(toggle, on) {
    if (!toggle) return;
    const enabled = Boolean(on);
    toggle.classList.toggle('ws-toggle-on', enabled);
    toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
  }

  function createToggle(initial = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ws-toggle';
    btn.setAttribute('role', 'switch');
    setToggleOn(btn, initial);
    return btn;
  }

  function createOptionRow(labelText, { icon = null } = {}) {
    const row = document.createElement('div');
    row.className = icon ? 'ws-option-row ws-option-row-icon' : 'ws-option-row';

    const label = document.createElement('span');
    label.className = 'ws-option-label';
    if (icon) {
      label.innerHTML = `${WSIcons.svg(icon, 14)}<span>${labelText}</span>`;
    } else {
      label.textContent = labelText;
    }

    const toggle = createToggle(false);
    row.append(label, toggle);
    return { row, toggle };
  }

  function wireToggle(toggle, handler) {
    toggle?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setToggleOn(toggle, !isToggleOn(toggle));
      handler?.();
    });
  }

  function updateAnnotationStatus(state) {
    if (!state || !els.optAnnotationMode || !els.annotationStatus) return;

    setToggleOn(els.optAnnotationMode, Boolean(state.annotationMode));
    const total = state.annotationTotal ?? 0;
    const current = state.annotationCurrent ?? 0;

    if (state.annotationMode) {
      els.annotationStatus.textContent = total
        ? `Аннотаций: ${current} из ${total}`
        : 'Режим активен — выделите текст на странице';
    } else {
      els.annotationStatus.textContent = total
        ? `На странице ${total} аннотаций (режим выключен)`
        : '';
    }
  }

  function applySettingsToForm(settings) {
    if (!settings) return;
    if (els.optCase) setToggleOn(els.optCase, settings.caseSensitive ?? true);
    if (els.optWhole) setToggleOn(els.optWhole, settings.wholeWord ?? true);
    if (els.optMorph) setToggleOn(els.optMorph, settings.useMorphology ?? false);
  }

  function readSettingsFromForm() {
    return {
      caseSensitive: isToggleOn(els.optCase),
      wholeWord: isToggleOn(els.optWhole),
      useMorphology: isToggleOn(els.optMorph),
      matchMode: isToggleOn(els.optWhole) ? 'whole' : 'substring'
    };
  }

  function updateUI(state) {
    if (!state) return;

    if (state.query !== undefined && els.query) {
      els.query.value = state.query;
    }

    const total = state.total ?? 0;
    const current = state.currentIndex ?? -1;
    const displayCurrent = total && current >= 0 ? current + 1 : 0;

    searchActiveOnPage = Boolean(state.searchActive);
    if (els.counter) els.counter.textContent = `${displayCurrent} из ${total}`;
    if (els.btnPrev) els.btnPrev.disabled = total === 0;
    if (els.btnNext) els.btnNext.disabled = total === 0;
    updateClearButton();
    updateAnnotationStatus(state);

    if (total === 0 && state.query) {
      setStatus('Совпадений не найдено.');
    } else if (total > 0) {
      setStatus('');
    } else if (!state.query) {
      setStatus('');
    }
  }

  function setPageInfo({ site, title, url } = {}) {
    if (els.pageSite) {
      els.pageSite.textContent = site || '—';
      els.pageSite.title = url || site || '';
    }
    if (els.pageTitle) {
      els.pageTitle.textContent = title || '—';
      els.pageTitle.title = title || '';
    }
  }

  async function runSearch() {
    const query = els.query?.value.trim() || '';
    if (!query) {
      setStatus('Введите слово или фразу.', true);
      return;
    }

    const state = await callbacks.onSearch?.(query);
    updateUI(state);
  }

  async function searchSelection() {
    const text = window.getSelection()?.toString()?.trim() || '';
    if (!text) {
      setStatus('Выделите текст на странице.', true);
      return;
    }

    if (els.query) els.query.value = text;
    updateClearButton();
    await runSearch();
  }

  async function navigate(direction) {
    const state = await callbacks.onNavigate?.(direction);
    updateUI(state);
  }

  async function clearSearch() {
    if (els.query) els.query.value = '';
    searchActiveOnPage = false;
    updateClearButton();

    const state = await callbacks.onClear?.();
    updateUI(state);
    setStatus('');
    els.query?.focus();
  }

  async function onOptionChange() {
    const basic = readSettingsFromForm();
    const state = await callbacks.onSettingsChange?.(basic);
    if (state && els.query?.value.trim()) {
      updateUI(state);
    }
  }

  async function toggleAnnotationMode() {
    const enabled = isToggleOn(els.optAnnotationMode);
    const state = await callbacks.onAnnotationToggle?.(enabled);
    updateUI(state);
  }

  function openSettings() {
    const fallbackUrl = chrome.runtime.getURL('settings/settings.html');
    try {
      chrome.runtime.openOptionsPage(() => {
        if (chrome.runtime.lastError) {
          chrome.tabs.create({ url: fallbackUrl });
        }
      });
    } catch {
      chrome.tabs.create({ url: fallbackUrl });
    }
  }

  async function openReader() {
    const result = await callbacks.onReaderOpen?.();
    if (result?.ok === false) {
      setStatus(result.message || 'Не удалось открыть читатель.', true);
    } else if (result?.ok) {
      setStatus('Читатель открыт в новой вкладке.');
    }
  }

  function bindEvents() {
    els.btnSearch?.addEventListener('click', runSearch);
    els.btnFindSelection?.addEventListener('click', searchSelection);
    els.btnClear?.addEventListener('click', clearSearch);
    els.btnPrev?.addEventListener('click', () => navigate('PREV'));
    els.btnNext?.addEventListener('click', () => navigate('NEXT'));
    els.btnSettings?.addEventListener('click', openSettings);
    els.btnReader?.addEventListener('click', openReader);
    els.btnCollapse?.addEventListener('click', () => setCollapsed(true));
    els.btnClose?.addEventListener('click', () => hide());

    tabEl?.addEventListener('click', () => setCollapsed(false));

    els.query?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch();
    });

    els.query?.addEventListener('input', updateClearButton);

    [els.optCase, els.optWhole, els.optMorph].forEach((toggle) => {
      wireToggle(toggle, onOptionChange);
    });

    wireToggle(els.optAnnotationMode, toggleAnnotationMode);
  }

  function createIconButton(className, title, iconName, size = 16) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = WSIcons.svg(iconName, size);
    return btn;
  }

  function buildSidebar() {
    root = document.createElement('div');
    root.id = SIDEBAR_ID;
    root.hidden = true;

    tabEl = document.createElement('div');
    tabEl.className = 'ws-sidebar-tab';
    tabEl.title = 'Развернуть панель поиска';
    tabEl.setAttribute('role', 'button');
    tabEl.setAttribute('aria-label', 'Развернуть панель поиска');
    tabEl.innerHTML = `
      <span class="ws-sidebar-tab-icon" aria-hidden="true">${WSIcons.svg('search', 16)}</span>
      ${WSIcons.svg('chevronLeft', 14)}
    `;

    panelEl = document.createElement('div');
    panelEl.className = 'ws-sidebar-panel';

    const header = document.createElement('header');
    header.className = 'ws-sidebar-header';

    const title = document.createElement('h1');
    title.textContent = 'Поиск';

    const headerActions = document.createElement('div');
    headerActions.className = 'ws-sidebar-header-actions';

    els.btnCollapse = createIconButton('ws-btn-icon', 'Свернуть', 'panelRightClose');
    els.btnSettings = createIconButton('ws-btn-icon', 'Настройки', 'settings');
    els.btnClose = createIconButton('ws-btn-icon', 'Закрыть', 'x');

    headerActions.append(els.btnCollapse, els.btnSettings, els.btnClose);
    header.append(title, headerActions);

    const readerRow = document.createElement('div');
    readerRow.className = 'ws-reader-row';
    readerRow.innerHTML = `
      <button type="button" class="ws-btn-reader" title="Открыть статью в читателе">
        ${WSIcons.svg('bookOpen', 14)}
        <span>Читатель</span>
      </button>
    `;
    els.btnReader = readerRow.querySelector('.ws-btn-reader');

    const pageInfo = document.createElement('div');
    pageInfo.className = 'ws-page-info-card';
    pageInfo.innerHTML = `
      <div class="ws-page-info-row">
        <span class="ws-page-info-label">Сайт</span>
        <span class="ws-page-info-value"></span>
      </div>
      <div class="ws-page-info-row">
        <span class="ws-page-info-label">Заголовок</span>
        <span class="ws-page-info-value"></span>
      </div>
    `;
    els.pageSite = pageInfo.querySelector('.ws-page-info-row:nth-child(1) .ws-page-info-value');
    els.pageTitle = pageInfo.querySelector('.ws-page-info-row:nth-child(2) .ws-page-info-value');

    const searchRow = document.createElement('div');
    searchRow.className = 'ws-search-row';
    searchRow.innerHTML = `
      <div class="ws-search-input-wrap">
        <span class="ws-search-field-icon" aria-hidden="true">${WSIcons.svg('search', 14)}</span>
        <input type="text" class="ws-query-input" placeholder="Слово или фраза…" autocomplete="off" spellcheck="false">
        <button type="button" class="ws-btn-clear" hidden aria-label="Очистить поиск" title="Очистить">
          ${WSIcons.svg('x', 12)}
        </button>
      </div>
      <button type="button" class="ws-btn-primary">Найти</button>
    `;
    els.query = searchRow.querySelector('.ws-query-input');
    els.btnClear = searchRow.querySelector('.ws-btn-clear');
    els.btnSearch = searchRow.querySelector('.ws-btn-primary');

    const selectionRow = document.createElement('div');
    selectionRow.className = 'ws-selection-row';
    selectionRow.innerHTML = `<button type="button" class="ws-btn-selection">${WSIcons.svg('textSelect', 14)}<span>Найти выделенное</span></button>`;
    els.btnFindSelection = selectionRow.querySelector('.ws-btn-selection');

    const optionsCard = document.createElement('div');
    optionsCard.className = 'ws-options-card';

    const caseRow = createOptionRow('Учитывать регистр');
    const wholeRow = createOptionRow('Целое слово');
    const morphRow = createOptionRow('Формы слова');
    els.optCase = caseRow.toggle;
    els.optWhole = wholeRow.toggle;
    els.optMorph = morphRow.toggle;
    optionsCard.append(caseRow.row, wholeRow.row, morphRow.row);

    const annotationCard = document.createElement('div');
    annotationCard.className = 'ws-options-card';
    const annRow = createOptionRow('Режим аннотаций', { icon: 'highlighter' });
    els.optAnnotationMode = annRow.toggle;
    annotationCard.append(annRow.row);

    const annotationStatus = document.createElement('p');
    annotationStatus.className = 'ws-annotation-status';
    annotationStatus.setAttribute('aria-live', 'polite');
    els.annotationStatus = annotationStatus;
    annotationCard.appendChild(annotationStatus);

    const navRow = document.createElement('div');
    navRow.className = 'ws-nav-row';
    navRow.innerHTML = `
      <button type="button" class="ws-btn-nav" disabled aria-label="Предыдущее">
        ${WSIcons.svg('chevronLeft', 14)}
      </button>
      <span class="ws-counter">0 из 0</span>
      <button type="button" class="ws-btn-nav" disabled aria-label="Следующее">
        ${WSIcons.svg('chevronRight', 14)}
      </button>
    `;
    els.btnPrev = navRow.querySelector('.ws-btn-nav:first-child');
    els.btnNext = navRow.querySelector('.ws-btn-nav:last-child');
    els.counter = navRow.querySelector('.ws-counter');

    const status = document.createElement('p');
    status.className = 'ws-status';
    status.setAttribute('aria-live', 'polite');
    els.status = status;

    panelEl.append(
      header,
      readerRow,
      pageInfo,
      searchRow,
      selectionRow,
      optionsCard,
      annotationCard,
      navRow,
      status
    );

    root.append(tabEl, panelEl);
    document.documentElement.appendChild(root);

    collapsed = loadCollapsed();
    root.classList.toggle('ws-sidebar-collapsed', collapsed);
    bindEvents();
  }

  function init(cb = {}) {
    callbacks = cb;
    if (!root) buildSidebar();
  }

  function show({ expand = true } = {}) {
    if (!root) buildSidebar();
    root.hidden = false;
    if (expand) setCollapsed(false);
    else setCollapsed(loadCollapsed());
  }

  function hide() {
    if (root) root.hidden = true;
  }

  function isVisible() {
    return Boolean(root && !root.hidden);
  }

  function destroy() {
    if (root) {
      root.remove();
      root = null;
      panelEl = null;
      tabEl = null;
      els = {};
    }
    callbacks = {};
    collapsed = false;
    searchActiveOnPage = false;
  }

  return {
    init,
    show,
    hide,
    destroy,
    updateUI,
    setPageInfo,
    applySettingsToForm,
    setCollapsed,
    isVisible,
    isCollapsed: () => collapsed
  };
})();
