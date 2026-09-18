/**
 * Content script entry: messaging, state, MutationObserver.
 */
(() => {
  const CONTENT_SCRIPT_VERSION = globalThis.WS_CONTENT_SCRIPT_VERSION || '1.0.7';

  function isExtensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function isContextInvalidated(err) {
    const msg = err?.message || String(err || '');
    return msg.includes('Extension context invalidated');
  }

  if (globalThis.__wsPageSearchInitialized) {
    try { globalThis.WSAnnotations?.destroy?.(); } catch { /* ignore */ }
    try { globalThis.WSAnnotationPill?.destroy?.(); } catch { /* ignore */ }
    try { globalThis.WSSearchSidebar?.destroy?.(); } catch { /* ignore */ }
    try { globalThis.WSAnnotationNote?.destroy?.(); } catch { /* ignore */ }
    try { globalThis.WSDictionaryPopup?.destroy?.(); } catch { /* ignore */ }
    globalThis.__wsPageSearchInitialized = false;
  }
  globalThis.__wsPageSearchInitialized = true;
  const instanceGeneration = (globalThis.__wsPageSearchGeneration || 0) + 1;
  globalThis.__wsPageSearchGeneration = instanceGeneration;

  const state = {
    query: '',
    options: {},
    settings: { ...WS_DEFAULTS },
    matches: [],
    currentIndex: -1,
    searchActive: false,
    annotationMode: false,
    observer: null,
    annotationObserver: null,
    debounceTimer: null,
    searching: false,
    suppressObserver: false,
    suppressTimer: null,
    operationChain: Promise.resolve(),
    tornDown: false,
    selectionHandler: null,
    keydownHandler: null,
    anchorMarkId: null,
    lastWarning: null,
    fullRescanNeeded: true,
    pendingMutations: [],
    iframeSearchToken: 0,
    frameNonce: ''
  };

  function wrapMatch(mark, frameWindow = null) {
    return {
      element: mark,
      markId: mark?.getAttribute?.('data-ws-mark-id') || null,
      text: mark?.textContent || '',
      frameWindow
    };
  }

  function resolveMatchElement(matchRef) {
    if (!matchRef) return null;
    if (matchRef.element?.isConnected) return matchRef.element;
    if (matchRef.markId) {
      const escaped = (typeof CSS !== 'undefined' && CSS.escape)
        ? CSS.escape(String(matchRef.markId))
        : String(matchRef.markId);
      const selector = `mark.ws-match[data-ws-mark-id="${escaped}"]`;
      if (matchRef.frameWindow) {
        try {
          const found = matchRef.frameWindow.document.querySelector(selector);
          if (found) return found;
        } catch { /* cross-origin */ }
      }
      try {
        const found = document.querySelector(selector);
        if (found) return found;
      } catch { /* ignore */ }
    }
    return matchRef.element?._wsRange ? matchRef.element : null;
  }

  function isLiveMatchElement(el) {
    return Boolean(el && (el.isConnected || el._wsRange));
  }

  function filterLiveMatchRefs(matchRefs) {
    return matchRefs.filter((ref) => isLiveMatchElement(resolveMatchElement(ref)));
  }

  function collectDomMatchRefs() {
    try {
      return [...document.querySelectorAll('mark.ws-match')].map((mark) => wrapMatch(mark));
    } catch {
      return [];
    }
  }

  function setCurrentMatchRef(matchRefs, index, { scroll = false } = {}) {
    const elements = matchRefs.map((ref) => resolveMatchElement(ref));
    const idx = WSDomSearch.setCurrentMatch(elements, index, { scroll });

    if (scroll && idx >= 0 && document.hasFocus()) {
      const frameWindow = matchRefs[idx]?.frameWindow;
      if (frameWindow && frameWindow !== window) {
        try {
          frameWindow.focus?.();
        } catch { /* ignore */ }
      }
    }

    return idx;
  }

  function teardown() {
    if (state.tornDown) return;
    state.tornDown = true;
    state.searchActive = false;
    stopObserver();
    stopAnnotationObserver();
    disableAnnotationMode(false, { clearHighlights: false });
    WSAnnotations.destroy();
    WSAnnotationNote.destroy();
    if (WSAnnotations.isTopFrame()) {
      WSAnnotationPill.destroy();
      WSSearchSidebar.destroy();
    }
    if (state.keydownHandler) {
      document.removeEventListener('keydown', state.keydownHandler, true);
      state.keydownHandler = null;
    }
    if (globalThis.__wsPageSearchGeneration === instanceGeneration) {
      globalThis.__wsPageSearchInitialized = false;
    }
  }

  function handleExtensionError(err) {
    if (!isContextInvalidated(err) && isExtensionAlive()) {
      return;
    }
    teardown();
  }

  function withOperationLock(fn) {
    if (!isExtensionAlive()) {
      teardown();
      return Promise.reject(new Error('Extension context invalidated'));
    }

    const run = state.operationChain.then(() => {
      if (!isExtensionAlive()) {
        teardown();
        throw new Error('Extension context invalidated');
      }
      return fn();
    });
    state.operationChain = run.catch((err) => {
      handleExtensionError(err);
    });
    return run;
  }

  function suppressObserverBriefly(ms = 600) {
    state.suppressObserver = true;
    clearTimeout(state.suppressTimer);
    state.suppressTimer = setTimeout(() => {
      state.suppressObserver = false;
    }, ms);
  }

  function syncCurrentIndexAfterFilter(previousRef) {
    if (previousRef) {
      const idx = state.matches.indexOf(previousRef);
      if (idx >= 0) {
        state.currentIndex = idx;
        return;
      }

      if (state.anchorMarkId) {
        const byId = state.matches.findIndex((m) => m.markId === state.anchorMarkId);
        if (byId >= 0) {
          state.currentIndex = byId;
          return;
        }
      }
    }

    if (state.currentIndex >= state.matches.length) {
      state.currentIndex = state.matches.length ? state.matches.length - 1 : -1;
    }
    if (state.currentIndex < 0 && state.matches.length) {
      state.currentIndex = 0;
    }
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
    if (!isExtensionAlive()) {
      teardown();
      throw new Error('Extension context invalidated');
    }

    try {
      const stored = await WSSettingsStorage.get(WS_DEFAULTS);
      state.settings = parseSettings(stored);
      return state.settings;
    } catch (err) {
      handleExtensionError(err);
      throw err;
    }
  }

  async function ensureFrameNonce() {
    if (state.frameNonce) return state.frameNonce;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_FRAME_NONCE' });
      state.frameNonce = response?.nonce || '';
    } catch {
      state.frameNonce = '';
    }
    globalThis.__wsFrameNonce = state.frameNonce;
    return state.frameNonce;
  }

  function isTrustedTopMessage(event) {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return false;
    if (state.frameNonce && msg.nonce !== state.frameNonce) return false;
    return event.source === window.top;
  }

  function isTrustedChildFrame(event) {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return false;
    if (state.frameNonce && msg.nonce !== state.frameNonce) return false;
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        if (event.source === frame.contentWindow) return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  /* Cross-origin iframes require targetOrigin '*'; payloads contain match text only, never secrets. */
  function postToIframe(frame, payload) {
    frame.contentWindow?.postMessage({ ...payload, nonce: state.frameNonce }, '*');
  }

  async function loadSessionMode() {
    try {
      const session = await chrome.storage.session.get({ annotationModeEnabled: false });
      return Boolean(session.annotationModeEnabled);
    } catch {
      return false;
    }
  }

  async function saveSessionMode(enabled) {
    try {
      await chrome.storage.session.set({ annotationModeEnabled: enabled });
    } catch { /* session unavailable */ }
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

  function buildAnnotationResponse() {
    const annState = WSAnnotations.getState();
    return {
      annotationMode: state.annotationMode,
      annotationTotal: annState.total,
      annotationCurrent: annState.displayCurrent
    };
  }

  function buildResponse({ resyncHighlight = true } = {}) {
    const previousRef = state.matches[state.currentIndex];
    state.matches = filterLiveMatchRefs(state.matches);
    syncCurrentIndexAfterFilter(previousRef);

    if (resyncHighlight && state.currentIndex >= 0 && state.matches.length) {
      setCurrentMatchRef(state.matches, state.currentIndex, { scroll: false });
    }

    return {
      query: state.query,
      options: state.options,
      total: state.matches.length,
      currentIndex: state.currentIndex,
      searchActive: state.searchActive,
      warning: state.lastWarning,
      ...buildAnnotationResponse()
    };
  }

  function updatePillUI() {
    if (!WSAnnotations.isTopFrame()) return;
    const annState = WSAnnotations.getState();
    WSAnnotationPill.updateCounter(annState.displayCurrent, annState.total);
    WSAnnotationPill.renderList(
      WSAnnotations.getAnnotationsList(),
      WSAnnotations.getActiveGroupId()
    );
  }

  function onAnnotationChange() {
    updatePillUI();
    syncSidebarUI();
  }

  function onSearchKeydown(e) {
    if (state.tornDown || !isExtensionAlive()) return;
    if (!WSAnnotations.isTopFrame()) return;
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

    withOperationLock(async () => navigate(direction)).catch(handleExtensionError);
  }

  function startKeyboardShortcuts() {
    if (!WSAnnotations.isTopFrame() || state.keydownHandler) return;
    state.keydownHandler = onSearchKeydown;
    document.addEventListener('keydown', state.keydownHandler, true);
  }

  function onSelectionMouseUp(e) {
    if (!state.annotationMode || state.tornDown) return;
    if (e.target?.closest?.('#ws-annotation-pill, #ws-search-sidebar')) return;
    if (e.target?.closest?.('.ws-ann-menu, .ws-ann-popover, .ws-ann-note-editor, .ws-dict-popup')) return;
    if (e.target?.closest?.('mark.ws-annotation')) return;

    const sel = window.getSelection();
    if (!sel?.toString()?.trim() || sel.isCollapsed) return;

    const created = WSAnnotations.createFromSelection();
    if (created) {
      WSAnnotations.scheduleTextMapInvalidation(document);
      updatePillUI();
    }
  }

  function enableAnnotationMode() {
    state.annotationMode = true;
    saveSessionMode(true);
    WSAnnotations.setAnnotationMode(true);
    startAnnotationObserver();

    if (WSAnnotations.isTopFrame()) {
      WSAnnotationPill.show();
      updatePillUI();
      broadcastAnnotationMode(true);
      notifyAnnotationModeChanged(true);
    }

    if (!state.selectionHandler) {
      state.selectionHandler = onSelectionMouseUp;
      document.addEventListener('mouseup', state.selectionHandler, true);
    }
  }

  function disableAnnotationMode(resetPillPosition = true, { clearHighlights = true } = {}) {
    state.annotationMode = false;
    saveSessionMode(false);
    WSAnnotations.setAnnotationMode(false);
    stopAnnotationObserver();

    if (state.selectionHandler) {
      document.removeEventListener('mouseup', state.selectionHandler, true);
      state.selectionHandler = null;
    }

    if (clearHighlights) {
      WSAnnotations.clearAll();
      if (WSAnnotations.isTopFrame()) {
        WSAnnotations.clearStorageForUrl();
      }
    }

    if (WSAnnotations.isTopFrame()) {
      WSAnnotationPill.hide();
      if (resetPillPosition) {
        WSAnnotationPill.resetPosition();
      }
      broadcastAnnotationMode(false);
      notifyAnnotationModeChanged(false);
    }
  }

  function broadcastAnnotationMode(enabled) {
    if (!WSAnnotations.isTopFrame()) return;
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        postToIframe(frame, {
          type: 'ws-annotation-event',
          action: 'mode',
          enabled
        });
      } catch { /* cross-origin */ }
    }
  }

  function broadcastSearchToIframes(action, payload = {}) {
    if (!WSAnnotations.isTopFrame() || !state.settings.searchIframes) return;

    for (const frame of document.querySelectorAll('iframe')) {
      try {
        postToIframe(frame, {
          type: 'ws-search',
          action,
          token: state.iframeSearchToken,
          ...payload
        });
      } catch { /* cross-origin */ }
    }
  }

  function waitForIframeSearchResults(timeoutMs = 500) {
    if (!state.settings.searchIframes || !WSAnnotations.isTopFrame()) {
      return Promise.resolve([]);
    }

    const frames = [...document.querySelectorAll('iframe')].filter((frame) => {
      try {
        return Boolean(frame.contentWindow);
      } catch {
        return false;
      }
    });
    if (!frames.length) return Promise.resolve([]);

    return new Promise((resolve) => {
      const results = [];
      const token = state.iframeSearchToken;
      let settled = false;
      const timer = setTimeout(finish, timeoutMs);

      function finish() {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onResult);
        clearTimeout(timer);
        resolve(results);
      }

      function onResult(event) {
        if (!isTrustedChildFrame(event)) return;
        const msg = event.data;
        if (msg?.type !== 'ws-search' || msg.action !== 'RESULT' || msg.token !== token) return;
        results.push({
          frameWindow: event.source,
          matches: (msg.matches || []).map((meta) => ({
            element: null,
            markId: meta.markId,
            text: meta.text,
            frameWindow: event.source
          }))
        });
        if (results.length >= frames.length) finish();
      }

      window.addEventListener('message', onResult);
    });
  }

  function aggregateIframeMatches(localMatches, iframeResults) {
    const aggregated = localMatches.map((m) => wrapMatch(m));

    for (const result of iframeResults) {
      for (const meta of result.matches) {
        aggregated.push(meta);
      }
    }

    return aggregated;
  }

  function onFrameModeMessage(event) {
    if (!isTrustedTopMessage(event)) return;
    const msg = event.data;
    if (msg?.type === 'ws-annotation-event' && msg.action === 'mode') {
      if (WSAnnotations.isTopFrame()) return;
      if (msg.enabled) {
        enableAnnotationMode();
      } else {
        disableAnnotationMode(false);
      }
      return;
    }

    if (msg?.type !== 'ws-search') return;

    if (msg.action === 'SEARCH' && !WSAnnotations.isTopFrame()) {
      runSearch(msg.query || '', msg.options || {}, 0, false, { fromIframe: true, token: msg.token })
        .catch(handleExtensionError);
      return;
    }

    if (msg.action === 'SET_CURRENT' && !WSAnnotations.isTopFrame()) {
      const elements = state.matches.map((r) => resolveMatchElement(r)).filter(Boolean);
      const idx = WSDomSearch.findMatchIndexByMarkId(elements, msg.markId);
      if (idx >= 0) {
        WSDomSearch.setCurrentMatch(elements, idx, { scroll: true });
      }
      return;
    }

    if (msg.action === 'CLEAR' && !WSAnnotations.isTopFrame()) {
      WSDomSearch.clearHighlights();
      state.matches = [];
      state.currentIndex = -1;
      state.searchActive = false;
    }
  }

  function postIframeSearchResult(token) {
    if (WSAnnotations.isTopFrame()) return;

    try {
      window.top.postMessage({
        type: 'ws-search',
        action: 'RESULT',
        token,
        nonce: state.frameNonce,
        matches: state.matches.map((ref) => ({
          markId: ref.markId || ref.element?.getAttribute?.('data-ws-mark-id'),
          text: ref.text || ref.element?.textContent || ''
        }))
      }, '*');
    } catch {
      /* ignore */
    }
  }

  function setAnnotationMode(enabled) {
    if (enabled) {
      enableAnnotationMode();
    } else {
      disableAnnotationMode(true, { clearHighlights: true });
    }
    return buildAnnotationResponse();
  }

  async function annotateSelection(autoEnable = false, fallbackText = '') {
    if (autoEnable && !state.annotationMode) {
      enableAnnotationMode();
    }

    const created = WSAnnotations.createFromSelection(fallbackText);

    if (created && !state.annotationMode) {
      enableAnnotationMode();
    }

    if (created) {
      WSAnnotations.scheduleTextMapInvalidation(document);
    }

    updatePillUI();
    return { ...buildAnnotationResponse(), created: Boolean(created) };
  }

  async function runSearch(query, options = {}, preferredIndex = 0, shouldScroll = false, { fromIframe = false, token = null } = {}) {
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
      state.anchorMarkId = null;
      state.lastWarning = null;
      state.fullRescanNeeded = true;
      stopObserver();
      if (WSAnnotations.isTopFrame()) {
        broadcastSearchToIframes('CLEAR');
      }
      return buildResponse();
    }

    stopObserver();

    const previousRef = state.matches[state.currentIndex];
    const anchorMarkId = state.anchorMarkId || previousRef?.markId || null;
    const anchorIndex = state.currentIndex;

    state.searching = true;
    try {
      const result = await WSDomSearch.searchFull(state.query, state.options, state.settings);
      state.lastWarning = result.warning || null;

      let aggregated = result.matches.map((m) => wrapMatch(m));

      if (WSAnnotations.isTopFrame() && state.settings.searchIframes) {
        state.iframeSearchToken += 1;
        const searchToken = state.iframeSearchToken;
        broadcastSearchToIframes('SEARCH', {
          query: state.query,
          options: state.options,
          token: searchToken
        });
        const iframeResults = await waitForIframeSearchResults();
        aggregated = aggregateIframeMatches(result.matches, iframeResults);
      }

      state.matches = aggregated;
      state.fullRescanNeeded = false;
      state.searchActive = true;

      let index = preferredIndex;
      if (anchorMarkId && preferredIndex === anchorIndex) {
        const found = state.matches.findIndex((m) => m.markId === anchorMarkId);
        if (found >= 0) index = found;
      }

      if (index < 0 || index >= state.matches.length) {
        index = state.matches.length ? 0 : -1;
      }

      state.currentIndex = setCurrentMatchRef(state.matches, index, { scroll: shouldScroll });
      state.anchorMarkId = state.matches[state.currentIndex]?.markId || null;
      suppressObserverBriefly(800);

      if (fromIframe && token != null) {
        postIframeSearchResult(token);
      }
    } finally {
      state.searching = false;
      if (state.searchActive) {
        startObserver();
      }
    }

    syncSidebarUI();
    return buildResponse();
  }

  async function runIncrementalUpdate() {
    if (!state.searchActive || !state.query || state.searching) return;

    state.searching = true;
    try {
      const changedRoots = WSDomSearch.collectChangedRootsFromMutations(state.pendingMutations);
      state.pendingMutations = [];

      if (!changedRoots.length) return;

      const anchorMarkId = state.anchorMarkId || state.matches[state.currentIndex]?.markId || null;
      const incremental = await WSDomSearch.searchIncremental(
        changedRoots,
        state.query,
        state.options,
        state.settings
      );

      if (!incremental.matches?.length) return;

      const existingElements = state.matches.map((r) => resolveMatchElement(r)).filter(Boolean);
      const merged = WSDomSearch.mergeIncrementalMatches(
        existingElements,
        incremental.matches,
        anchorMarkId
      );

      const newRefs = merged.matches.map((el) => {
        const markId = el.getAttribute?.('data-ws-mark-id');
        const existingRef = state.matches.find((r) => r.markId === markId);
        return existingRef || wrapMatch(el);
      });

      state.matches = newRefs;
      state.currentIndex = merged.currentIndex;
      state.anchorMarkId = state.matches[state.currentIndex]?.markId || null;
      setCurrentMatchRef(state.matches, state.currentIndex, { scroll: false });
    } finally {
      state.searching = false;
    }
  }

  function navigate(direction) {
    state.matches = filterLiveMatchRefs(state.matches);
    if (!state.matches.length) {
      state.matches = collectDomMatchRefs();
    }
    if (!state.matches.length) {
      state.currentIndex = -1;
      syncSidebarUI();
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

    suppressObserverBriefly();
    let idx = setCurrentMatchRef(state.matches, next, { scroll: true });
    if (idx < 0) {
      const fallback = state.matches.findIndex((ref) => isLiveMatchElement(resolveMatchElement(ref)));
      if (fallback >= 0) {
        idx = setCurrentMatchRef(state.matches, fallback, { scroll: true });
      }
    }
    state.currentIndex = idx;
    state.anchorMarkId = state.matches[state.currentIndex]?.markId || null;

    const currentRef = state.matches[state.currentIndex];
    if (currentRef?.frameWindow && currentRef.frameWindow !== window) {
      try {
        currentRef.frameWindow.postMessage({
          type: 'ws-search',
          action: 'SET_CURRENT',
          markId: currentRef.markId,
          nonce: state.frameNonce
        }, '*');
      } catch { /* ignore */ }
    }

    syncSidebarUI();
    return buildResponse({ resyncHighlight: false });
  }

  function getObserverDebounce(mutations) {
    const hasCharacterData = mutations.some((m) => m.type === 'characterData');
    return hasCharacterData ? 400 : 150;
  }

  function startObserver() {
    if (state.observer) return;

    state.observer = new MutationObserver((mutations) => {
      if (state.tornDown || !isExtensionAlive()) {
        teardown();
        return;
      }
      if (!state.searchActive || !state.query || state.suppressObserver || state.searching) return;

      const relevant = mutations.filter((m) => WSDomSearch.isRelevantMutation(m));
      if (!relevant.length) return;

      state.pendingMutations.push(...relevant);
      clearTimeout(state.debounceTimer);

      const debounceMs = getObserverDebounce(relevant);
      state.debounceTimer = setTimeout(() => {
        if (state.tornDown || !isExtensionAlive()) {
          teardown();
          return;
        }
        if (state.suppressObserver || state.searching) return;

        if (state.fullRescanNeeded) {
          withOperationLock(() =>
            runSearch(state.query, state.options, state.currentIndex, false)
          ).catch(handleExtensionError);
        } else {
          withOperationLock(() => runIncrementalUpdate()).catch(handleExtensionError);
        }
      }, debounceMs);
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function stopObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    clearTimeout(state.debounceTimer);
    clearTimeout(state.suppressTimer);
    state.suppressObserver = false;
    state.pendingMutations = [];
  }

  function startAnnotationObserver() {
    if (state.annotationObserver) return;

    state.annotationObserver = new MutationObserver((mutations) => {
      if (!state.annotationMode) return;
      const relevant = mutations.some((m) => !WSDomUtils.isInsideExtensionUi(m.target));
      if (relevant) {
        WSAnnotations.scheduleTextMapInvalidation(document);
      }
    });

    state.annotationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function stopAnnotationObserver() {
    if (state.annotationObserver) {
      state.annotationObserver.disconnect();
      state.annotationObserver = null;
    }
  }

  function formatPageSite(url) {
    if (!url) return '—';
    try {
      return new URL(url).hostname || url;
    } catch {
      return url;
    }
  }

  function syncSidebarUI() {
    if (!WSAnnotations.isTopFrame() || !WSSearchSidebar.isVisible()) return;
    WSSearchSidebar.updateUI(buildResponse());
  }

  function initSearchSidebar() {
    if (!WSAnnotations.isTopFrame()) return;

    WSSearchSidebar.init({
      onSearch: async (query) => {
        state.fullRescanNeeded = true;
        return withOperationLock(() =>
          runSearch(query, getSearchOptions(), 0, true)
        );
      },
      onNavigate: async (direction) => withOperationLock(async () => navigate(direction)),
      onClear: async () => withOperationLock(async () => {
        WSDomSearch.clearHighlights();
        state.query = '';
        state.matches = [];
        state.currentIndex = -1;
        state.searchActive = false;
        state.anchorMarkId = null;
        state.lastWarning = null;
        state.fullRescanNeeded = true;
        stopObserver();
        broadcastSearchToIframes('CLEAR');
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
          state.fullRescanNeeded = true;
          if (state.searchActive && state.query) {
            return runSearch(state.query, getSearchOptions(), state.currentIndex, false);
          }
          WSDomSearch.applyHighlightColors(state.settings);
          return buildResponse();
        });
      },
      onAnnotationToggle: async (enabled) => withOperationLock(async () => {
        await loadSettings();
        WSAnnotations.applyColors(state.settings);
        setAnnotationMode(enabled);
        return buildResponse();
      }),
      onReaderOpen: async () => withOperationLock(async () => {
        const result = await WSReaderExtract.openReaderTab();
        if (!result.ok) {
          const messages = {
            not_article: 'Не удалось извлечь статью с этой страницы.',
            readability_unavailable: 'Модуль читателя недоступен.',
            sanitizer_unavailable: 'Модуль очистки HTML недоступен. Переустановите расширение.',
            storage_failed: 'Не удалось сохранить статью для чтения.',
            open_failed: 'Не удалось открыть вкладку читателя.'
          };
          return {
            ok: false,
            message: result.message || messages[result.error] || 'Ошибка читателя.'
          };
        }
        return { ok: true };
      })
    });
  }

  function showSearchSidebar(pageInfo = {}) {
    if (!WSAnnotations.isTopFrame()) return buildResponse();

    WSSearchSidebar.show();
    WSSearchSidebar.applySettingsToForm(state.settings);
    WSSearchSidebar.setPageInfo({
      site: pageInfo.site || formatPageSite(location.href),
      title: pageInfo.title || document.title?.trim() || '—',
      url: pageInfo.url || location.href
    });
    WSSearchSidebar.updateUI(buildResponse());
    return buildResponse();
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

    if (WSAnnotations.isTopFrame()) {
      WSAnnotationPill.init({
        onPrev: () => {
          WSAnnotations.navigate('PREV');
          updatePillUI();
        },
        onNext: () => {
          WSAnnotations.navigate('NEXT');
          updatePillUI();
        },
        onClose: () => {
          WSAnnotations.clearAll();
          WSAnnotationNote.closeAll();
          updatePillUI();
        },
        onSelectItem: (id) => {
          WSAnnotations.goToGroup(id);
          updatePillUI();
        }
      });
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isExtensionAlive()) {
      teardown();
      sendResponse({ error: 'Extension context invalidated' });
      return false;
    }

    if (message.targetTabId != null) {
      return false;
    }

    if (message.type === 'ANNOTATION_MODE_CHANGED') {
      return false;
    }

    const isTop = WSAnnotations.isTopFrame();

    if (!isTop) {
      const subFrameTypes = [
        'PING',
        'ANNOTATE_SELECTION',
        'UPDATE_SETTINGS',
        'UPDATE_DICTIONARY',
        'DICTIONARY_LOOKUP',
        'SEARCH',
        'NEXT',
        'PREV',
        'CLEAR',
        'GET_STATE'
      ];
      if (!subFrameTypes.includes(message.type)) {
        return false;
      }
    }

    const handle = async () => {
      switch (message.type) {
        case 'PING':
          return { ok: true, version: CONTENT_SCRIPT_VERSION };

        case 'OPEN_SIDEBAR':
          return withOperationLock(async () => {
            await loadSettings();
            WSDomSearch.applyHighlightColors(state.settings);
            WSAnnotations.applyColors(state.settings);
            return showSearchSidebar(message.pageInfo || {});
          });

        case 'GET_STATE':
          return withOperationLock(async () => {
            await loadSettings();
            WSDomSearch.applyHighlightColors(state.settings);
            WSAnnotations.applyColors(state.settings);
            return buildResponse();
          });

        case 'GET_ANNOTATION_STATE':
          return withOperationLock(async () => {
            await loadSettings();
            WSAnnotations.applyColors(state.settings);
            return buildAnnotationResponse();
          });

        case 'SEARCH':
          state.fullRescanNeeded = true;
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
            state.anchorMarkId = null;
            state.lastWarning = null;
            state.fullRescanNeeded = true;
            stopObserver();
            if (isTop) broadcastSearchToIframes('CLEAR');
            return buildResponse({ resyncHighlight: false });
          });

        case 'ANNOTATION_MODE_TOGGLE':
          return withOperationLock(async () => {
            await loadSettings();
            WSAnnotations.applyColors(state.settings);
            const enabled = message.enabled ?? !state.annotationMode;
            setAnnotationMode(enabled);
            return buildResponse();
          });

        case 'ANNOTATE_SELECTION':
          return withOperationLock(async () => {
            await loadSettings();
            WSAnnotations.applyColors(state.settings);
            return annotateSelection(message.autoEnable !== false, message.text || '');
          });

        case 'ANNOTATION_NEXT':
          return withOperationLock(async () => {
            WSAnnotations.navigate('NEXT');
            updatePillUI();
            return buildAnnotationResponse();
          });

        case 'ANNOTATION_PREV':
          return withOperationLock(async () => {
            WSAnnotations.navigate('PREV');
            updatePillUI();
            return buildAnnotationResponse();
          });

        case 'ANNOTATION_CLEAR':
          return withOperationLock(async () => {
            WSAnnotations.clearAll();
            updatePillUI();
            return buildAnnotationResponse();
          });

        case 'UPDATE_SETTINGS':
          return withOperationLock(async () => {
            await loadSettings();
            WSDomUtils.clearExcludeCache();
            WSDomSearch.invalidateMatcherCache();
            WSAnnotations.applyColors(state.settings);
            state.fullRescanNeeded = true;
            if (state.searchActive && state.query) {
              return runSearch(state.query, getSearchOptions(), state.currentIndex, false);
            }
            WSDomSearch.applyHighlightColors(state.settings);
            return buildResponse();
          });

        case 'UPDATE_DICTIONARY':
          await WSUserDictionary.reload();
          return { ok: true };

        case 'DICTIONARY_LOOKUP':
          return handleDictionaryLookup(message.text || '');

        case 'QR_DECODE_IMAGE':
          if (!globalThis.WSQrDecode) {
            return { ok: false, error: 'not_found' };
          }
          {
            const data = await globalThis.WSQrDecode.decodeFromSrcUrl(message.srcUrl || '');
            if (data) {
              globalThis.WSQrDecode.showResult(data);
              return { ok: true, data };
            }
            globalThis.WSQrDecode.showNotFound();
            return { ok: false, error: 'not_found' };
          }

        case 'READER_EXTRACT':
          if (!WSAnnotations.isTopFrame()) {
            return { ok: false, error: 'not_top_frame' };
          }
          return WSReaderExtract.extractArticle();

        case 'READER_OPEN':
          return withOperationLock(async () => {
            if (!WSAnnotations.isTopFrame()) {
              return { ok: false, error: 'not_top_frame' };
            }
            const result = await WSReaderExtract.openReaderTab();
            if (!result.ok) {
              const messages = {
                not_article: 'Не удалось извлечь статью с этой страницы.',
                readability_unavailable: 'Модуль читателя недоступен.',
                sanitizer_unavailable: 'Модуль очистки HTML недоступен. Переустановите расширение.',
                storage_failed: 'Не удалось сохранить статью для чтения.',
                open_failed: 'Не удалось открыть вкладку читателя.'
              };
              return {
                ok: false,
                error: result.error,
                message: result.message || messages[result.error] || 'Ошибка читателя.'
              };
            }
            return { ok: true };
          });

        case 'ARCHIVE_PREPARE':
          if (!WSAnnotations.isTopFrame()) {
            return { ok: false, error: 'not_top_frame' };
          }
          return WSArchiveCollect.preparePageForArchive(message);

        case 'ARCHIVE_COLLECT':
          if (!WSAnnotations.isTopFrame()) {
            return { ok: false, error: 'not_top_frame' };
          }
          return WSArchiveCollect.collectPageSnapshot();

        default:
          return { error: 'Unknown message type' };
      }
    };

    handle()
      .then(sendResponse)
      .catch((err) => {
        handleExtensionError(err);
        sendResponse({ error: err.message });
      });
    return true;
  });

  async function bootstrap() {
    initAnnotations();
    initSearchSidebar();
    WSDictionaryPopup.init();
    WSQrDecode.init();
    startKeyboardShortcuts();
    window.addEventListener('message', onFrameModeMessage);
    ensureFrameNonce().catch(() => {});

    try {
      const settings = await loadSettings();
      if (!state.tornDown) {
        WSDomSearch.applyHighlightColors(settings);
        WSAnnotations.applyColors(settings);
      }

      const modeFromSession = await loadSessionMode();
      if (modeFromSession && !state.tornDown) {
        await WSAnnotations.restoreFromStorage();
        enableAnnotationMode();
        updatePillUI();
      }
    } catch (err) {
      handleExtensionError(err);
    }
  }

  bootstrap();
})();
