/**
 * Reader tab: render extracted article, search, annotations.
 */
(() => {
  const CONTENT_SCRIPT_VERSION = globalThis.WS_CONTENT_SCRIPT_VERSION || '1.0.8';

  let readerTabId = null;
  let payload = null;
  let pendingNavUrl = null;

  const navState = {
    stack: [],
    index: -1,
    loading: false
  };

  try {
    chrome.tabs.getCurrent((tab) => {
      readerTabId = tab?.id ?? null;
    });
  } catch {
    readerTabId = null;
  }
  let bgColorSaveTimer = null;
  let appearanceSaveTimer = null;

  const state = {
    query: '',
    options: {},
    settings: { ...WS_DEFAULTS },
    matches: [],
    currentIndex: -1,
    searchActive: false,
    annotationMode: false,
    searching: false,
    operationChain: Promise.resolve(),
    keydownHandler: null
  };

  const els = {
    app: document.getElementById('ws-reader-app'),
    error: document.getElementById('ws-reader-error'),
    errorText: document.getElementById('ws-reader-error-text'),
    backBtn: document.getElementById('ws-reader-back'),
    historyBackBtn: document.getElementById('ws-reader-history-back'),
    historyForwardBtn: document.getElementById('ws-reader-history-forward'),
    site: document.getElementById('ws-reader-site'),
    title: document.getElementById('ws-reader-title'),
    meta: document.getElementById('ws-reader-meta'),
    content: document.getElementById('ws-reader-content'),
    loading: document.getElementById('ws-reader-loading'),
    navError: document.getElementById('ws-reader-nav-error'),
    navErrorText: document.getElementById('ws-reader-nav-error-text'),
    navOpenBtn: document.getElementById('ws-reader-nav-open'),
    progress: document.getElementById('ws-reader-progress')
  };

  function showError(message) {
    if (els.app) els.app.hidden = true;
    if (els.error) els.error.hidden = false;
    if (els.errorText) els.errorText.textContent = message;
  }

  function formatSite(url) {
    if (!url) return '—';
    try {
      return new URL(url).hostname || url;
    } catch {
      return url;
    }
  }

  function formatMeta({ byline, publishedTime, siteName, sourceUrl } = {}) {
    const parts = [];
    if (byline) parts.push(byline);
    if (publishedTime) {
      try {
        parts.push(new Date(publishedTime).toLocaleDateString('ru-RU'));
      } catch {
        parts.push(publishedTime);
      }
    }
    if (siteName) parts.push(siteName);
    else if (sourceUrl) parts.push(formatSite(sourceUrl));
    return parts.join(' · ');
  }

  function applyReaderAppearance(settings) {
    const root = document.documentElement;
    const bg = settings.readerBgColor || '#ffe5b8';
    root.style.setProperty('--ws-reader-bg', bg);
    root.style.setProperty('--ws-reader-font-size', `${settings.readerFontSize ?? 18}px`);
    root.style.setProperty('--ws-reader-line-height', String(settings.readerLineHeight ?? 1.7));
    root.style.setProperty('--ws-reader-max-width', `${settings.readerMaxWidth ?? 680}px`);
  }

  function parseSettings(stored) {
    const settings = { ...WS_DEFAULTS, ...stored };
    if (typeof stored.excludeTags === 'string') {
      settings.excludeTags = stored.excludeTags.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (typeof stored.excludeSelectors === 'string') {
      settings.excludeSelectors = stored.excludeSelectors.split('\n').map((s) => s.trim()).filter(Boolean);
    }
    if (typeof stored.annotationExcludeTags === 'string') {
      settings.annotationExcludeTags = stored.annotationExcludeTags.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (typeof stored.annotationExcludeSelectors === 'string') {
      settings.annotationExcludeSelectors = stored.annotationExcludeSelectors.split('\n').map((s) => s.trim()).filter(Boolean);
    }
    return settings;
  }

  async function loadSettings() {
    const stored = await WSSettingsStorage.get(WS_DEFAULTS);
    state.settings = parseSettings(stored);
    applyReaderAppearance(state.settings);
    return state.settings;
  }

  function getSearchOptions(overrides = {}) {
    const settings = state.settings || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(overrides, key)
      && overrides[key] !== undefined;

    const wholeWord = has('wholeWord')
      ? Boolean(overrides.wholeWord)
      : has('matchMode')
        ? overrides.matchMode === 'whole'
        : Boolean(settings.wholeWord);

    return {
      caseSensitive: has('caseSensitive') ? Boolean(overrides.caseSensitive) : (settings.caseSensitive ?? true),
      wholeWord,
      useMorphology: has('useMorphology') ? Boolean(overrides.useMorphology) : Boolean(settings.useMorphology),
      phraseMode: has('phraseMode') ? overrides.phraseMode : (settings.phraseMode || 'exact'),
      matchMode: wholeWord ? 'whole' : 'substring',
      morphDepth: settings.morphDepth || 'basic'
    };
  }

  function wrapMatch(mark) {
    return {
      element: mark,
      markId: mark?.getAttribute?.('data-ws-mark-id') || null,
      text: mark?.textContent || ''
    };
  }

  function buildAnnotationResponse() {
    const annState = WSAnnotations.getState();
    return {
      annotationMode: state.annotationMode,
      annotationTotal: annState.total,
      annotationCurrent: annState.displayCurrent
    };
  }

  function buildResponse({ resyncHighlight = true } = {}) {
    state.matches = state.matches.filter((ref) => ref.element?.isConnected);

    if (state.currentIndex >= state.matches.length) {
      state.currentIndex = state.matches.length ? state.matches.length - 1 : -1;
    }

    if (resyncHighlight && state.currentIndex >= 0 && state.matches.length) {
      const elements = state.matches.map((r) => r.element).filter(Boolean);
      state.currentIndex = WSDomSearch.setCurrentMatch(elements, state.currentIndex, { scroll: false });
    }

    return {
      query: state.query,
      options: state.options,
      total: state.matches.length,
      currentIndex: state.currentIndex,
      searchActive: state.searchActive,
      readerMode: true,
      ...buildAnnotationResponse()
    };
  }

  function withOperationLock(fn) {
    const run = state.operationChain.then(() => fn());
    state.operationChain = run.catch(() => {});
    return run;
  }

  function syncReaderPillUI() {
    const response = buildResponse();
    WSReaderPill.updateUI(response);
    WSReaderPill.renderAnnList(
      WSAnnotations.getAnnotationsList(),
      WSAnnotations.getActiveGroupId()
    );
  }

  function onAnnotationChange() {
    syncReaderPillUI();
  }

  async function runSearch(query, options = {}, preferredIndex = 0, shouldScroll = false) {
    if (state.searching) return buildResponse();

    await loadSettings();
    WSDomUtils.clearExcludeCache();
    state.query = query.trim();
    state.options = getSearchOptions(options);
    if (/\s/.test(state.query)) {
      state.options = {
        ...state.options,
        wholeWord: false,
        phraseMode: state.options.phraseMode || state.settings.phraseMode || 'exact'
      };
    }

    if (!state.query) {
      WSDomSearch.clearHighlights();
      state.matches = [];
      state.currentIndex = -1;
      state.searchActive = false;
      syncReaderPillUI();
      return buildResponse();
    }

    state.searching = true;
    try {
      const result = await WSDomSearch.searchFull(state.query, state.options, state.settings);
      state.matches = result.matches.map((m) => wrapMatch(m));
      state.searchActive = true;

      let index = preferredIndex;
      if (index < 0 || index >= state.matches.length) {
        index = state.matches.length ? 0 : -1;
      }

      const elements = state.matches.map((r) => r.element).filter(Boolean);
      state.currentIndex = WSDomSearch.setCurrentMatch(elements, index, { scroll: shouldScroll });
    } finally {
      state.searching = false;
    }

    syncReaderPillUI();
    return buildResponse();
  }

  function navigate(direction) {
    const live = state.matches.filter((r) => r.element?.isConnected || r.element?._wsRange);
    if (live.length) state.matches = live;

    if (!state.matches.length) {
      syncReaderPillUI();
      return buildResponse({ resyncHighlight: false });
    }

    let next;
    if (state.currentIndex < 0 || state.currentIndex >= state.matches.length) {
      next = direction === 'PREV' ? state.matches.length - 1 : 0;
    } else if (direction === 'NEXT') {
      next = (state.currentIndex + 1) % state.matches.length;
    } else {
      next = state.currentIndex <= 0 ? state.matches.length - 1 : state.currentIndex - 1;
    }

    const elements = state.matches.map((r) => r.element);
    state.currentIndex = WSDomSearch.setCurrentMatch(elements, next, { scroll: true });
    syncReaderPillUI();
    return buildResponse({ resyncHighlight: false });
  }

  function onSearchKeydown(e) {
    if (!state.searchActive || !state.matches.length) return;

    let direction = null;
    if (e.key === 'F3') {
      direction = e.shiftKey ? 'PREV' : 'NEXT';
    } else if ((e.key === 'g' || e.key === 'G') && (e.ctrlKey || e.metaKey) && !e.altKey) {
      direction = e.shiftKey ? 'PREV' : 'NEXT';
    }

    if (!direction) return;
    e.preventDefault();
    e.stopPropagation();
    withOperationLock(async () => navigate(direction));
  }

  function onSelectionMouseUp(e) {
    if (!state.annotationMode) return;
    if (e.target?.closest?.('#ws-reader-pill')) return;
    if (e.target?.closest?.('.ws-ann-menu, .ws-ann-popover, .ws-ann-note-editor, .ws-dict-popup')) return;
    if (e.target?.closest?.('mark.ws-annotation')) return;

    const sel = window.getSelection();
    if (!sel?.toString()?.trim() || sel.isCollapsed) return;

    const created = WSAnnotations.createFromSelection();
    if (created) {
      WSAnnotations.scheduleTextMapInvalidation(document);
      syncReaderPillUI();
    }
  }

  function notifyAnnotationModeChanged(enabled) {
    try {
      chrome.runtime.sendMessage({ type: 'ANNOTATION_MODE_CHANGED', enabled }).catch(() => {});
    } catch { /* extension unavailable */ }
  }

  async function handleDictionaryLookup(text) {
    if (state.annotationMode) {
      return { ok: false, reason: 'annotation-mode' };
    }

    await loadSettings();
    await WSUserDictionary.reload();
    const entry = await WSUserDictionary.lookupWord(text, {
      morphDepth: state.settings.morphDepth
    });

    const anchor = WSDictionaryPopup.getSelectionRect();
    if (entry) {
      WSDictionaryPopup.show(entry, anchor, state.settings);
    } else {
      const query = text.trim();
      if (query && /^\S+$/.test(query)) {
        WSDictionaryPopup.show(
          { word: query, description: 'В вашем словаре нет этой записи.' },
          anchor,
          state.settings
        );
      }
    }

    return { ok: true, found: Boolean(entry) };
  }

  async function enableAnnotationMode() {
    state.annotationMode = true;
    await chrome.storage.session.set({ annotationModeEnabled: true }).catch(() => {});
    WSAnnotations.setAnnotationMode(true);
    await WSAnnotations.restoreFromStorage();
    document.addEventListener('mouseup', onSelectionMouseUp, true);
    syncReaderPillUI();
    notifyAnnotationModeChanged(true);
  }

  function disableAnnotationMode(clearHighlights = true) {
    state.annotationMode = false;
    chrome.storage.session.set({ annotationModeEnabled: false }).catch(() => {});
    WSAnnotations.setAnnotationMode(false);
    document.removeEventListener('mouseup', onSelectionMouseUp, true);
    WSAnnotationNote.closeAll();
    if (clearHighlights) {
      WSAnnotations.clearAll();
      WSAnnotations.clearStorageForUrl();
    }
    syncReaderPillUI();
    notifyAnnotationModeChanged(false);
  }

  async function setAnnotationMode(enabled) {
    if (enabled) {
      await enableAnnotationMode();
    } else {
      disableAnnotationMode(true);
    }
    return buildAnnotationResponse();
  }

  function initAnnotations() {
    WSAnnotations.init({ onChange: onAnnotationChange });

    WSAnnotationNote.init({
      onChange: onAnnotationChange,
      getMeta: (id) => WSAnnotations.getGroupMeta(id),
      getSettings: () => state.settings,
      setNote: (id, note) => WSAnnotations.setGroupNote(id, note),
      deleteNote: (id) => WSAnnotations.deleteGroupNote(id),
      removeGroup: (id) => WSAnnotations.removeGroup(id)
    });
  }

  function applyReaderBgColor(color) {
    const value = color || WS_DEFAULTS.readerBgColor;
    state.settings.readerBgColor = value;
    applyReaderAppearance(state.settings);
    WSReaderPill.applySettings(state.settings);
    return value;
  }

  async function persistReaderBgColor(value) {
    try {
      await WSSettingsStorage.set({ readerBgColor: value });
    } catch (err) {
      console.warn('[ws-reader] Failed to save background color:', err);
    }
  }

  function saveReaderBgColor(color, { commit = false } = {}) {
    const value = applyReaderBgColor(color);
    WSReaderPill.applySettings(state.settings);
    clearTimeout(bgColorSaveTimer);
    if (commit) {
      return persistReaderBgColor(value);
    }
    bgColorSaveTimer = setTimeout(() => persistReaderBgColor(value), 500);
  }

  function applyReaderTypography(partial) {
    state.settings = {
      ...state.settings,
      readerFontSize: partial.readerFontSize ?? state.settings.readerFontSize,
      readerLineHeight: partial.readerLineHeight ?? state.settings.readerLineHeight,
      readerMaxWidth: partial.readerMaxWidth ?? state.settings.readerMaxWidth
    };
    applyReaderAppearance(state.settings);
    WSReaderPill.applySettings(state.settings);
    return state.settings;
  }

  async function persistReaderTypography(values) {
    try {
      await WSSettingsStorage.set({
        readerFontSize: values.readerFontSize,
        readerLineHeight: values.readerLineHeight,
        readerMaxWidth: values.readerMaxWidth
      });
    } catch (err) {
      console.warn('[ws-reader] Failed to save typography:', err);
    }
  }

  function saveReaderTypography(partial, { commit = false } = {}) {
    const values = applyReaderTypography(partial);
    clearTimeout(appearanceSaveTimer);
    if (commit) {
      return persistReaderTypography(values);
    }
    appearanceSaveTimer = setTimeout(() => persistReaderTypography(values), 500);
  }

  let progressRaf = null;
  function updateReadingProgress() {
    if (!els.progress) return;
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const scrollHeight = Math.max(doc.scrollHeight, document.body?.scrollHeight || 0);
    const clientHeight = window.innerHeight || doc.clientHeight || 1;
    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    const ratio = Math.min(1, Math.max(0, scrollTop / maxScroll));
    els.progress.style.transform = `scaleX(${ratio})`;
  }

  function bindReadingProgress() {
    window.addEventListener('scroll', () => {
      if (progressRaf) return;
      progressRaf = requestAnimationFrame(() => {
        progressRaf = null;
        updateReadingProgress();
      });
    }, { passive: true });
    window.addEventListener('resize', updateReadingProgress, { passive: true });
    updateReadingProgress();
  }

  function initReaderPill() {
    WSReaderPill.init({
      onSearch: async (query) => withOperationLock(() =>
        runSearch(query, getSearchOptions(), 0, true)
      ),
      onNavigate: async (direction) => withOperationLock(async () => navigate(direction)),
      onClear: async () => withOperationLock(async () => {
        WSDomSearch.clearHighlights();
        state.query = '';
        state.matches = [];
        state.currentIndex = -1;
        state.searchActive = false;
        syncReaderPillUI();
        return buildResponse({ resyncHighlight: false });
      }),
      onSettingsChange: async (basic) => {
        await WSSettingsStorage.set(basic);
        state.settings = { ...state.settings, ...basic };
        return withOperationLock(async () => {
          await loadSettings();
          WSDomUtils.clearExcludeCache();
          WSDomSearch.invalidateMatcherCache();
          WSAnnotations.applyColors(state.settings);
          if (state.searchActive && state.query) {
            return runSearch(state.query, getSearchOptions(), state.currentIndex, false);
          }
          WSDomSearch.applyHighlightColors(state.settings);
          syncReaderPillUI();
          return buildResponse();
        });
      },
      onAnnotationToggle: async (enabled) => withOperationLock(async () => {
        await loadSettings();
        WSAnnotations.applyColors(state.settings);
        return setAnnotationMode(enabled);
      }),
      onAnnNavigate: async (direction) => withOperationLock(async () => {
        WSAnnotations.navigate(direction);
        syncReaderPillUI();
        return buildAnnotationResponse();
      }),
      onAnnSelect: (id) => {
        WSAnnotations.goToGroup(id);
        syncReaderPillUI();
      },
      onBgColorChange: (color, options) => saveReaderBgColor(color, options),
      onReaderAppearanceChange: (partial, options) => saveReaderTypography(partial, options),
      onCopyText: async () => {
        const articleEl = document.querySelector('.ws-reader-article');
        if (!articleEl || !payload) throw new Error('Статья не загружена');
        await WSReaderExport.copyPlainText({ articleEl, payload });
      },
      onCopyMarkdown: async () => {
        const articleEl = document.querySelector('.ws-reader-article');
        if (!articleEl || !payload) throw new Error('Статья не загружена');
        await WSReaderExport.copyMarkdown({ articleEl, payload, includeAnnotations: false });
      },
      onSave: async ({ includeAnnotations }) => {
        const articleEl = document.querySelector('.ws-reader-article');
        if (!articleEl || !payload) {
          throw new Error('Статья не загружена');
        }

        const annotations = includeAnnotations ? WSAnnotations.getAnnotationsList() : [];
        await WSReaderExport.download({
          payload,
          articleEl,
          annotations,
          includeAnnotations
        });
        return { ok: true };
      }
    });

    WSReaderPill.applySettings(state.settings);
  }

  function handleMessage(message, _sender, sendResponse) {
    if (message.type === 'ANNOTATION_MODE_CHANGED') {
      return false;
    }

    if (message.targetTabId != null && readerTabId != null && message.targetTabId !== readerTabId) {
      return false;
    }

    const reply = (result) => {
      if (typeof sendResponse === 'function') sendResponse(result);
    };

    const handle = async () => {
      switch (message.type) {
        case 'PING':
          return { ok: true, version: CONTENT_SCRIPT_VERSION, readerMode: true };

        case 'GET_STATE':
          await loadSettings();
          WSDomSearch.applyHighlightColors(state.settings);
          WSAnnotations.applyColors(state.settings);
          return buildResponse();

        case 'GET_ANNOTATION_STATE':
          await loadSettings();
          WSAnnotations.applyColors(state.settings);
          return buildAnnotationResponse();

        case 'SEARCH':
          return withOperationLock(() =>
            runSearch(message.query || '', message.options || {}, 0, true)
          );

        case 'NEXT':
          return withOperationLock(async () => navigate('NEXT'));

        case 'PREV':
          return withOperationLock(async () => navigate('PREV'));

        case 'CLEAR':
          return withOperationLock(async () => {
            WSDomSearch.clearHighlights();
            state.query = '';
            state.matches = [];
            state.currentIndex = -1;
            state.searchActive = false;
            return buildResponse({ resyncHighlight: false });
          });

        case 'ANNOTATION_MODE_TOGGLE':
          return withOperationLock(async () => {
            await loadSettings();
            WSAnnotations.applyColors(state.settings);
            const enabled = message.enabled ?? !state.annotationMode;
            await setAnnotationMode(enabled);
            return buildResponse();
          });

        case 'ANNOTATE_SELECTION':
          return withOperationLock(async () => {
            await loadSettings();
            WSAnnotations.applyColors(state.settings);
            if (message.autoEnable !== false && !state.annotationMode) {
              await enableAnnotationMode();
            }
            const created = WSAnnotations.createFromSelection(message.text || '');
            if (created) WSAnnotations.scheduleTextMapInvalidation(document);
            syncReaderPillUI();
            return { ...buildAnnotationResponse(), created: Boolean(created) };
          });

        case 'ANNOTATION_NEXT':
          WSAnnotations.navigate('NEXT');
          syncReaderPillUI();
          return buildAnnotationResponse();

        case 'ANNOTATION_PREV':
          WSAnnotations.navigate('PREV');
          syncReaderPillUI();
          return buildAnnotationResponse();

        case 'ANNOTATION_CLEAR':
          WSAnnotations.clearAll();
          syncReaderPillUI();
          return buildAnnotationResponse();

        case 'UPDATE_SETTINGS':
          return withOperationLock(async () => {
            await loadSettings();
            WSDomUtils.clearExcludeCache();
            WSDomSearch.invalidateMatcherCache();
            WSAnnotations.applyColors(state.settings);
            WSReaderPill.applySettings(state.settings);
            if (state.searchActive && state.query) {
              return runSearch(state.query, getSearchOptions(), state.currentIndex, false);
            }
            WSDomSearch.applyHighlightColors(state.settings);
            syncReaderPillUI();
            return buildResponse();
          });

        case 'UPDATE_DICTIONARY':
          await WSUserDictionary.reload();
          return { ok: true };

        case 'DICTIONARY_LOOKUP':
          return handleDictionaryLookup(message.text || '');

        case 'READER_EXIT':
          await exitReader();
          return { ok: true };

        default:
          return { error: 'Unknown message type' };
      }
    };

    handle()
      .then((result) => {
        if (result !== undefined) reply(result);
      })
      .catch((err) => reply({ error: err.message }));
    return true;
  }

  async function exitReader() {
    if (!payload?.sourceTabId) {
      window.close();
      return;
    }

    await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'READER_EXIT',
        sourceTabId: payload.sourceTabId,
        readerTabId
      }, resolve);
    });
  }

  function setNavLoading(visible) {
    navState.loading = visible;
    if (els.loading) els.loading.hidden = !visible;
    if (els.content) els.content.classList.toggle('ws-reader-content-loading', visible);
  }

  function hideNavError() {
    pendingNavUrl = null;
    if (els.navError) els.navError.hidden = true;
    if (els.navErrorText) els.navErrorText.textContent = '';
  }

  function showNavError(url, message) {
    pendingNavUrl = url;
    if (els.navErrorText) {
      els.navErrorText.textContent = message || 'Не удалось открыть статью в читателе.';
    }
    if (els.navError) els.navError.hidden = false;
  }

  function updateHistoryControls() {
    if (els.historyBackBtn) {
      els.historyBackBtn.disabled = navState.index <= 0 || navState.loading;
    }
    if (els.historyForwardBtn) {
      els.historyForwardBtn.disabled = navState.index >= navState.stack.length - 1 || navState.loading;
    }
  }

  function resetSearchState() {
    WSDomSearch.clearHighlights();
    state.query = '';
    state.matches = [];
    state.currentIndex = -1;
    state.searchActive = false;
  }

  async function loadArticle(data) {
    renderArticle(data);
    resetSearchState();
    WSAnnotations.clearAll();
    await WSAnnotations.restoreFromStorage();
    window.scrollTo(0, 0);
    updateReadingProgress();
    syncReaderPillUI();
  }

  function isNavigableHttpUrl(href) {
    try {
      const url = new URL(href);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async function navigateToArticleUrl(url) {
    if (navState.loading) return;

    hideNavError();
    setNavLoading(true);
    updateHistoryControls();

    try {
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'READER_EXTRACT_URL', url }, resolve);
      });

      if (!result?.ok) {
        const messages = {
          not_article: 'Не удалось извлечь статью с этой страницы.',
          sanitizer_unavailable: 'Модуль очистки HTML недоступен. Переустановите расширение.',
          timeout: 'Страница загружается слишком долго.',
          invalid_url: 'Недопустимый адрес ссылки.'
        };
        showNavError(url, result?.message || messages[result?.error] || 'Не удалось открыть статью.');
        return;
      }

      const data = {
        ...result.data,
        sourceUrl: result.data.sourceUrl || url.split('#')[0]
      };

      navState.stack = navState.stack.slice(0, navState.index + 1);
      navState.stack.push(data);
      navState.index = navState.stack.length - 1;

      payload = {
        ...data,
        sourceTabId: payload?.sourceTabId ?? null
      };

      await loadArticle(data);
      updateHistoryControls();
    } finally {
      setNavLoading(false);
      updateHistoryControls();
    }
  }

  async function navigateHistory(direction) {
    const nextIndex = navState.index + direction;
    if (nextIndex < 0 || nextIndex >= navState.stack.length || navState.loading) return;

    hideNavError();
    navState.index = nextIndex;
    const data = navState.stack[nextIndex];
    payload = {
      ...data,
      sourceTabId: payload?.sourceTabId ?? null
    };
    await loadArticle(data);
    updateHistoryControls();
  }

  function onContentLinkClick(e) {
    const link = e.target.closest('a[href]');
    if (!link || !els.content?.contains(link)) return;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    const lower = href.toLowerCase();
    if (lower.startsWith('mailto:') || lower.startsWith('tel:')) return;
    if (!isNavigableHttpUrl(href)) return;

    e.preventDefault();
    e.stopPropagation();
    navigateToArticleUrl(href);
  }

  function bindReaderNavigation() {
    els.content?.addEventListener('click', onContentLinkClick);
    els.historyBackBtn?.addEventListener('click', () => navigateHistory(-1));
    els.historyForwardBtn?.addEventListener('click', () => navigateHistory(1));
    els.navOpenBtn?.addEventListener('click', () => {
      if (pendingNavUrl) {
        chrome.tabs.create({ url: pendingNavUrl });
      }
    });
  }

  function renderArticle(data) {
    document.title = data.title ? `${data.title} — Читатель` : 'Читатель';
    document.documentElement.dataset.wsReaderSourceUrl = data.sourceUrl;
    if (data.dir) {
      document.documentElement.dir = data.dir;
    }

    if (els.site) els.site.textContent = formatSite(data.sourceUrl);
    if (els.title) els.title.textContent = data.title || 'Без заголовка';
    if (els.meta) els.meta.textContent = formatMeta(data);
    if (els.content) {
      if (typeof DOMPurify === 'undefined' || typeof DOMPurify.sanitize !== 'function') {
        els.content.innerHTML = '';
        showError('Модуль очистки HTML недоступен. Переустановите расширение.');
        return;
      }
      els.content.innerHTML = DOMPurify.sanitize(data.contentHtml || '');
      if (data.sourceUrl) {
        WSReaderExtract.fixMediaElements(els.content, data.sourceUrl);
      }
    }

    if (els.app) els.app.hidden = false;
    if (els.error) els.error.hidden = true;
  }

  async function bootstrapSearchAndAnnotations() {
    await loadSettings();
    WSDomSearch.applyHighlightColors(state.settings);
    WSAnnotations.applyColors(state.settings);
    WSDictionaryPopup.init();

    initAnnotations();
    initReaderPill();

    const session = await chrome.storage.session.get({ annotationModeEnabled: false });
    if (session.annotationModeEnabled) {
      await enableAnnotationMode();
    } else {
      WSAnnotations.setAnnotationMode(false);
    }

    state.keydownHandler = onSearchKeydown;
    document.addEventListener('keydown', state.keydownHandler, true);

    syncReaderPillUI();
  }

  async function init() {
    WSIcons.hydrate(document);
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) {
      showError('Сессия истекла. Откройте читатель снова со страницы статьи.');
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      readerTabId = tab?.id ?? null;

      payload = await WSReaderExtract.loadPayload(id);
      if (!payload) {
        showError('Сессия истекла. Откройте читатель снова со страницы статьи.');
        return;
      }

      await WSReaderExtract.deletePayload(id);
      navState.stack = [payload];
      navState.index = 0;
      renderArticle(payload);
      await bootstrapSearchAndAnnotations();
      bindReaderNavigation();
      bindReadingProgress();
      updateHistoryControls();

      els.backBtn?.addEventListener('click', () => exitReader());
    } catch (err) {
      showError(err.message || 'Не удалось загрузить статью.');
    }
  }

  chrome.runtime.onMessage.addListener(handleMessage);
  init();
})();
