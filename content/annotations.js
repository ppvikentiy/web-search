/**
 * Page annotations: highlight selected text, persist by URL, navigate groups.
 */
if (globalThis.WSAnnotations?.destroy) {
  try { globalThis.WSAnnotations.destroy(); } catch { /* stale instance */ }
}
globalThis.WSAnnotations = (() => {
  const MARK_CLASS = 'ws-annotation';
  const ACTIVE_CLASS = 'ws-annotation-active';
  const ID_ATTR = 'data-ws-annotation-id';
  const PREFIX_LEN = 32;
  const SUFFIX_LEN = 32;

  let settings = { ...WS_DEFAULTS };
  let onChange = null;
  let currentNavIndex = -1;
  let annotationMode = false;
  let destroyed = false;
  let nextId = 1;
  let lastCachedRange = null;
  let selectionCacheHandler = null;
  /** @type {Map<string, { note: string, createdAt: number|null, missing?: boolean }>} */
  const groupMeta = new Map();
  /** @type {Map<string, object>} orphan anchors not found in DOM */
  const missingGroups = new Map();
  const textMapCache = new WeakMap();
  let textMapInvalidationTimer = null;

  function getAnnotationExcludeConfig() {
    return {
      excludeTags: settings.annotationExcludeTags || [],
      excludeSelectors: [
        ...(settings.annotationExcludeSelectors || []),
        ...WSDomUtils.UI_REMOVE_SELECTORS
      ],
      skipMatchMarks: false,
      skipAnnotationMarks: false,
      skipAnnotationPill: true,
      skipAnnotationUi: true
    };
  }

  function invalidateTextMapCache(doc = null) {
    if (doc) {
      textMapCache.delete(doc);
      return;
    }
    for (const iframeDoc of getIframeRoots()) {
      textMapCache.delete(iframeDoc);
    }
  }

  function scheduleTextMapInvalidation(doc) {
    clearTimeout(textMapInvalidationTimer);
    textMapInvalidationTimer = setTimeout(() => {
      invalidateTextMapCache(doc);
    }, 300);
  }

  function isRangeValid(range) {
    try {
      return Boolean(
        range?.startContainer?.isConnected &&
        range?.endContainer?.isConnected
      );
    } catch {
      return false;
    }
  }

  function cacheSelectionRange() {
    if (destroyed) return;

    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    if (isExcludedNode(range.commonAncestorContainer)) return;

    try {
      lastCachedRange = range.cloneRange();
    } catch {
      /* ignore invalid range */
    }
  }

  function takeCachedRange() {
    if (!lastCachedRange || !isRangeValid(lastCachedRange)) {
      lastCachedRange = null;
      return null;
    }

    const range = lastCachedRange;
    lastCachedRange = null;
    return range;
  }

  function normalizeSpaces(value) {
    return value.replace(/\s+/g, ' ').trim();
  }

  function isExtensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function isTopFrame() {
    return window === window.top;
  }

  function getPageUrl() {
    const readerSource = document.documentElement.dataset.wsReaderSourceUrl;
    const url = readerSource || location.href;
    return WSAnnotationStorage?.normalizePageUrl?.(url) || url.split('#')[0];
  }

  function generateId() {
    return `ws-ann-${Date.now()}-${nextId++}`;
  }

  function hexToRgba(hex, alpha) {
    const h = String(hex || '').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    if (full.length !== 6) return `rgba(128, 128, 128, ${alpha})`;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applyPopupTheme(newSettings) {
    settings = { ...WS_DEFAULTS, ...newSettings };
    const theme = settings.annotationPopupTheme || 'system';
    let customProps = null;

    if (theme === 'custom') {
      const bg = settings.annotationPopupBg || '#1a1a2e';
      const text = settings.annotationPopupText || '#f0f0f5';
      const muted = settings.annotationPopupMuted || '#a0a0b8';
      customProps = {
        '--ws-ann-popup-bg': bg,
        '--ws-ann-popup-text': text,
        '--ws-ann-popup-muted': muted,
        '--ws-ann-popup-border': hexToRgba(text, 0.12),
        '--ws-ann-popup-shadow': '0 6px 28px rgba(0, 0, 0, 0.4)',
        '--ws-ann-popup-input-bg': hexToRgba(text, 0.06),
        '--ws-ann-popup-input-border': hexToRgba(text, 0.18),
        '--ws-ann-popup-btn-hover': hexToRgba(text, 0.1),
        '--ws-ann-popup-btn-primary-bg': hexToRgba(text, 0.1),
        '--ws-ann-popup-btn-primary-hover': hexToRgba(text, 0.16),
        '--ws-ann-popup-btn-danger-hover': 'rgba(255, 80, 80, 0.25)',
        '--ws-ann-popup-btn-danger-text': '#ffb4b4',
        '--ws-ann-popup-focus': hexToRgba(text, 0.35)
      };
    }

    WSDomUtils.setExtensionUiTheme(theme, customProps);
    applyPillTheme();
  }

  const PILL_CHROME_VARS = [
    '--ws-ann-pill-chrome-bg',
    '--ws-ann-pill-chrome-text',
    '--ws-ann-pill-chrome-muted',
    '--ws-ann-pill-chrome-border',
    '--ws-ann-pill-chrome-shadow',
    '--ws-ann-pill-btn-hover'
  ];

  function getPillChromePalette() {
    const mode = settings.annotationPillTheme || 'light';
    const light = { bg: '#ffffff', text: '#334155', muted: '#94a3b8' };
    const dark = { bg: '#1a1a2e', text: '#f0f0f5', muted: '#a0a0b8' };
    if (mode === 'match-menu') return null;
    if (mode === 'dark') return dark;
    if (mode === 'custom') {
      return {
        bg: settings.annotationPillBg || light.bg,
        text: settings.annotationPillText || light.text,
        muted: settings.annotationPillMuted || light.muted
      };
    }
    return light;
  }

  function pillChromeStyleProps(bg, text, muted) {
    return {
      '--ws-ann-pill-chrome-bg': bg,
      '--ws-ann-pill-chrome-text': text,
      '--ws-ann-pill-chrome-muted': muted,
      '--ws-ann-pill-chrome-border': hexToRgba(text, 0.12),
      '--ws-ann-pill-chrome-shadow': `0 1px 2px ${hexToRgba(text, 0.04)}, 0 4px 14px ${hexToRgba(text, 0.08)}`,
      '--ws-ann-pill-btn-hover': hexToRgba(text, 0.06)
    };
  }

  function clearPillChromeInline(el, bar, panel) {
    for (const key of PILL_CHROME_VARS) {
      el.style.removeProperty(key);
    }
    const barProps = ['background', 'backgroundColor', 'borderColor', 'color', 'boxShadow'];
    const panelProps = ['background', 'backgroundColor', 'borderColor', 'boxShadow'];
    for (const prop of barProps) bar?.style.removeProperty(prop);
    for (const prop of panelProps) panel?.style.removeProperty(prop);
  }

  function applyPillThemeToElement(el) {
    if (!el) return;
    const bar = el.querySelector('.ws-pill-bar');
    const panel = el.querySelector('.ws-pill-panel');
    const palette = getPillChromePalette();
    if (!palette) {
      clearPillChromeInline(el, bar, panel);
      el.dataset.wsPillTheme = 'match-menu';
      return;
    }
    const props = pillChromeStyleProps(palette.bg, palette.text, palette.muted);
    for (const [key, value] of Object.entries(props)) {
      el.style.setProperty(key, value);
    }
    if (bar) {
      bar.style.backgroundColor = palette.bg;
      bar.style.borderColor = props['--ws-ann-pill-chrome-border'];
      bar.style.color = palette.text;
      bar.style.boxShadow = props['--ws-ann-pill-chrome-shadow'];
    }
    if (panel) {
      panel.style.backgroundColor = palette.bg;
      panel.style.borderColor = props['--ws-ann-pill-chrome-border'];
      panel.style.boxShadow = props['--ws-ann-popup-shadow'] || props['--ws-ann-pill-chrome-shadow'];
    }
    el.dataset.wsPillTheme = settings.annotationPillTheme || 'light';
  }

  function applyPillTheme() {
    applyPillThemeToElement(document.getElementById('ws-annotation-pill'));
  }

  function applyColors(newSettings) {
    settings = { ...WS_DEFAULTS, ...newSettings };
    const root = document.documentElement;
    root.style.setProperty('--ws-annotation-color', settings.annotationColor || '#7bed9f');
    root.style.setProperty('--ws-annotation-active-color', settings.annotationActiveColor || '#1e90ff');
    root.dataset.wsAnnotationStyle = settings.annotationStyle || 'background';
    applyPopupTheme(newSettings);
    applyPillTheme();
  }

  function isExcludedNode(node) {
    return WSDomUtils.isExcludedNode(node, getAnnotationExcludeConfig());
  }

  function getIframeRoots() {
    const docs = [document];
    if (!settings.annotationIframes || !isTopFrame()) return docs;

    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const doc = frame.contentDocument;
        if (doc) docs.push(doc);
      } catch {
        /* cross-origin */
      }
    }
    return docs;
  }

  function getMarksInDocument(doc) {
    try {
      return [...doc.querySelectorAll(`mark.${MARK_CLASS}[${ID_ATTR}]`)];
    } catch {
      return [];
    }
  }

  function getAllMarks() {
    const marks = [];
    for (const doc of getIframeRoots()) {
      marks.push(...getMarksInDocument(doc));
    }
    return marks;
  }

  function getGroupIdsOrdered() {
    const seen = new Set();
    const ids = [];
    for (const doc of getIframeRoots()) {
      for (const mark of getMarksInDocument(doc)) {
        const id = mark.getAttribute(ID_ATTR);
        if (id && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    return ids;
  }

  function getNavigationGroupIds() {
    const ids = getGroupIdsOrdered();
    const seen = new Set(ids);
    for (const id of missingGroups.keys()) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }

  function getMarksForGroup(id) {
    return getAllMarks().filter((m) => m.getAttribute(ID_ATTR) === id);
  }

  function getFirstMarkForGroup(id) {
    return getMarksForGroup(id)[0] || null;
  }

  function getGroupText(id) {
    const marks = getMarksForGroup(id);
    if (marks.length) {
      return marks.map((m) => m.textContent).join('');
    }
    const anchor = missingGroups.get(id);
    return anchor?.text || '';
  }

  function clearActiveClass() {
    for (const mark of getAllMarks()) {
      try {
        mark.classList.remove(ACTIVE_CLASS);
      } catch {
        /* mark removed from DOM */
      }
    }
  }

  function setActiveGroup(id) {
    clearActiveClass();
    for (const mark of getMarksForGroup(id)) {
      mark.classList.add(ACTIVE_CLASS);
    }
  }

  function scrollToGroup(id) {
    const mark = getFirstMarkForGroup(id);
    if (!mark?.isConnected) return;
    WSDomUtils.scrollElementIntoView(mark);
  }

  function unwrapMark(mark) {
    if (!mark?.isConnected) return;
    const parent = mark.parentNode;
    if (!parent) return;
    try {
      const doc = mark.ownerDocument;
      parent.replaceChild(doc.createTextNode(mark.textContent), mark);
      parent.normalize();
    } catch {
      /* parent changed concurrently */
    }
  }

  function getTextAnchor(range) {
    const text = range.toString();
    if (!text.trim()) return null;

    const startNode = range.startContainer;
    const endNode = range.endContainer;
    let prefix = '';
    let suffix = '';

    if (startNode.nodeType === Node.TEXT_NODE) {
      const before = startNode.nodeValue.slice(0, range.startOffset);
      prefix = before.slice(-PREFIX_LEN);
    }

    if (endNode.nodeType === Node.TEXT_NODE) {
      const after = endNode.nodeValue.slice(range.endOffset);
      suffix = after.slice(0, SUFFIX_LEN);
    }

    return { text, prefix, suffix };
  }

  function getTextNodesInRange(range) {
    const result = [];
    if (range.collapsed) return result;

    const doc = range.commonAncestorContainer.ownerDocument || document;
    const root = range.commonAncestorContainer;
    const acceptNode = (node) => {
      if (!node?.nodeValue) return NodeFilter.FILTER_REJECT;
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      if (isExcludedNode(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    };

    if (root.nodeType === Node.TEXT_NODE && acceptNode(root) === NodeFilter.FILTER_ACCEPT) {
      result.push(root);
      return result;
    }

    const walker = doc.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      { acceptNode }
    );

    let node;
    while ((node = walker.nextNode())) {
      result.push(node);
    }
    return result;
  }

  function wrapTextNodePortion(textNode, startOffset, endOffset, id, doc) {
    if (!textNode?.isConnected || !textNode.parentNode) return null;

    const text = textNode.nodeValue;
    const before = text.slice(0, startOffset);
    const middle = text.slice(startOffset, endOffset);
    const after = text.slice(endOffset);

    if (!middle) return null;

    const frag = doc.createDocumentFragment();
    if (before) frag.appendChild(doc.createTextNode(before));

    const mark = doc.createElement('mark');
    mark.className = MARK_CLASS;
    mark.setAttribute(ID_ATTR, id);
    mark.textContent = middle;
    frag.appendChild(mark);

    if (after) frag.appendChild(doc.createTextNode(after));

    textNode.parentNode.replaceChild(frag, textNode);
    return mark;
  }

  function wrapRange(range, id) {
    const doc = range.commonAncestorContainer.ownerDocument || document;
    const textNodes = getTextNodesInRange(range);
    const marks = [];

    for (const node of textNodes) {
      if (!node.isConnected) continue;

      let start = 0;
      let end = node.nodeValue.length;

      if (node === range.startContainer) start = range.startOffset;
      if (node === range.endContainer) end = range.endOffset;

      try {
        const mark = wrapTextNodePortion(node, start, end, id, doc);
        if (mark) marks.push(mark);
      } catch {
        /* node changed concurrently */
      }
    }

    return marks;
  }

  function serializeGroups() {
    const anchors = [];
    const seen = new Set();

    for (const id of getGroupIdsOrdered()) {
      seen.add(id);
      const marks = getMarksForGroup(id);
      if (!marks.length) continue;
      const text = marks.map((m) => m.textContent).join('');
      const first = marks[0];
      const anchor = { id, text };

      const prev = first.previousSibling;
      if (prev?.nodeType === Node.TEXT_NODE) {
        anchor.prefix = prev.nodeValue.slice(-PREFIX_LEN);
      } else {
        anchor.prefix = '';
      }

      const last = marks[marks.length - 1];
      const next = last.nextSibling;
      if (next?.nodeType === Node.TEXT_NODE) {
        anchor.suffix = next.nodeValue.slice(0, SUFFIX_LEN);
      } else {
        anchor.suffix = '';
      }

      const meta = groupMeta.get(id) || { note: '', createdAt: null };
      if (meta.note) {
        anchor.note = meta.note;
        if (meta.createdAt) anchor.createdAt = meta.createdAt;
      }

      if (meta.startPath) anchor.startPath = meta.startPath;
      if (meta.endPath) anchor.endPath = meta.endPath;
      if (meta.startOffset != null) anchor.startOffset = meta.startOffset;
      if (meta.endOffset != null) anchor.endOffset = meta.endOffset;

      anchors.push(anchor);
    }

    for (const [id, anchor] of missingGroups) {
      if (seen.has(id)) continue;
      const meta = groupMeta.get(id) || {};
      anchors.push({
        id,
        text: anchor.text || '',
        prefix: anchor.prefix || '',
        suffix: anchor.suffix || '',
        note: meta.note || anchor.note || '',
        createdAt: meta.createdAt || anchor.createdAt || null,
        startPath: anchor.startPath || meta.startPath,
        endPath: anchor.endPath || meta.endPath,
        startOffset: anchor.startOffset ?? meta.startOffset,
        endOffset: anchor.endOffset ?? meta.endOffset
      });
    }

    return anchors;
  }

  async function persistGroups() {
    if (destroyed || !isTopFrame() || !isExtensionAlive()) return;

    const groups = serializeGroups();

    try {
      if (!groups.length) {
        await WSAnnotationStorage.remove(getPageUrl());
        return;
      }
      await WSAnnotationStorage.persist(getPageUrl(), { url: getPageUrl(), groups, updatedAt: Date.now() });
    } catch (err) {
      const quota = /quota/i.test(err?.message || '') || err?.name === 'QuotaExceededError';
      globalThis.WSAnnotationPill?.showMessage?.(
        quota ? 'Не удалось сохранить, хранилище заполнено' : 'Не удалось сохранить аннотации'
      );
    }
  }

  function requestPersist() {
    if (isTopFrame()) {
      persistGroups();
    } else {
      try {
        window.top.postMessage({
          type: 'ws-annotation-event',
          action: 'persist',
          nonce: globalThis.__wsFrameNonce || ''
        }, '*');
      } catch {
        /* ignore */
      }
    }
  }

  async function clearStorageForUrl() {
    if (destroyed || !isTopFrame() || !isExtensionAlive()) return;
    try {
      await WSAnnotationStorage.remove(getPageUrl());
    } catch {
      /* storage unavailable */
    }
  }

  function findAnchorPosition(anchor) {
    const { text, prefix, suffix } = anchor;
    if (!text) return null;

    for (const doc of getIframeRoots()) {
      const body = doc.body || doc.documentElement;
      if (!body) continue;

      const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue?.includes(text)) return NodeFilter.FILTER_REJECT;
          if (isExcludedNode(node)) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.closest?.(`mark.${MARK_CLASS}`)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let node;
      while ((node = walker.nextNode())) {
        const value = node.nodeValue;
        let from = 0;
        while (from <= value.length - text.length) {
          const idx = value.indexOf(text, from);
          if (idx < 0) break;

          const before = value.slice(Math.max(0, idx - PREFIX_LEN), idx);
          const after = value.slice(idx + text.length, idx + text.length + SUFFIX_LEN);

          const prefixMatch = !prefix || before.endsWith(
            prefix.slice(-Math.min(prefix.length, before.length))
          );
          const suffixMatch = !suffix || after.startsWith(
            suffix.slice(0, Math.min(suffix.length, after.length))
          );

          if (prefixMatch && suffixMatch) {
            const range = doc.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + text.length);
            return range;
          }

          from = idx + 1;
        }
      }
    }

    return null;
  }

  function collectSearchableTextNodes(doc) {
    const roots = [];
    const body = doc.body || doc.documentElement;
    if (!body) return [];

    roots.push(body);
    for (const shadowRoot of WSDomUtils.collectShadowRoots(body)) {
      roots.push(shadowRoot);
    }

    const excludeConfig = getAnnotationExcludeConfig();
    return WSDomUtils.collectTextNodes(roots, {
      ...excludeConfig,
      skipAnnotationMarks: true
    });
  }

  function buildTextMap(doc) {
    const cached = textMapCache.get(doc);
    if (cached) return cached;

    const textNodes = collectSearchableTextNodes(doc);
    let fullText = '';
    const runs = [];

    for (const node of textNodes) {
      const value = node.nodeValue || '';
      if (!value.length) continue;
      runs.push({
        node,
        globalStart: fullText.length,
        length: value.length
      });
      fullText += value;
    }

    let collapsed = '';
    const collapsedRuns = [];
    let lastWasSpace = false;

    for (let i = 0; i < fullText.length; i += 1) {
      const ch = fullText[i];
      if (/\s/.test(ch)) {
        if (lastWasSpace) continue;
        collapsed += ' ';
        collapsedRuns.push(i);
        lastWasSpace = true;
      } else {
        collapsed += ch;
        collapsedRuns.push(i);
        lastWasSpace = false;
      }
    }

    const result = { fullText, runs, collapsed, collapsedRuns, doc };
    textMapCache.set(doc, result);
    return result;
  }

  function rangeFromGlobalIndex(doc, runs, startIndex, length) {
    if (!length || !runs.length) return null;

    const endIndex = startIndex + length - 1;
    let startRun = null;
    let endRun = null;

    for (const run of runs) {
      const runEnd = run.globalStart + run.length - 1;
      if (!startRun && startIndex >= run.globalStart && startIndex <= runEnd) {
        startRun = { node: run.node, offset: startIndex - run.globalStart };
      }
      if (endIndex >= run.globalStart && endIndex <= runEnd) {
        endRun = { node: run.node, offset: endIndex - run.globalStart + 1 };
      }
    }

    if (!startRun || !endRun) return null;

    try {
      const range = doc.createRange();
      range.setStart(startRun.node, startRun.offset);
      range.setEnd(endRun.node, endRun.offset);
      return range;
    } catch {
      return null;
    }
  }

  function rangeFromTextMap(doc, mapData, startIndex, length) {
    return rangeFromGlobalIndex(doc, mapData.runs, startIndex, length);
  }

  function findTextRange(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const normalizedNeedle = normalizeSpaces(trimmed);

    for (const doc of getIframeRoots()) {
      const mapData = buildTextMap(doc);
      const { fullText, collapsed, collapsedRuns } = mapData;

      const directIdx = fullText.indexOf(trimmed);
      if (directIdx >= 0) {
        const range = rangeFromTextMap(doc, mapData, directIdx, trimmed.length);
        if (range) return range;
      }

      const fuzzyIdx = collapsed.indexOf(normalizedNeedle);
      if (fuzzyIdx >= 0) {
        const startGlobal = collapsedRuns[fuzzyIdx];
        const endGlobal = collapsedRuns[fuzzyIdx + normalizedNeedle.length - 1];
        if (startGlobal != null && endGlobal != null) {
          const range = rangeFromGlobalIndex(doc, mapData.runs, startGlobal, endGlobal - startGlobal + 1);
          if (range) return range;
        }
      }
    }

    return null;
  }

  function resolveAnchorRange(anchor, doc = document) {
    if (anchor.startPath?.length && anchor.endPath?.length) {
      const startNode = WSDomUtils.resolveNodePath(anchor.startPath, doc);
      const endNode = WSDomUtils.resolveNodePath(anchor.endPath, doc);
      if (startNode && endNode) {
        try {
          const range = doc.createRange();
          range.setStart(startNode, anchor.startOffset ?? 0);
          range.setEnd(endNode, anchor.endOffset ?? 0);
          if (range.toString().trim()) return range;
        } catch {
          /* invalid range */
        }
      }
    }

    const fromAnchor = findAnchorPosition(anchor);
    if (fromAnchor) return fromAnchor;

    return findTextRange(anchor.text);
  }

  function annotateRange(range) {
    if (!isRangeValid(range) || isExcludedNode(range.commonAncestorContainer)) {
      return false;
    }

    const id = generateId();
    const doc = range.commonAncestorContainer.ownerDocument || document;
    const stopAt = doc.body || doc.documentElement;
    const anchorPaths = {
      startPath: WSDomUtils.getNodePath(range.startContainer, stopAt),
      endPath: WSDomUtils.getNodePath(range.endContainer, stopAt),
      startOffset: range.startOffset,
      endOffset: range.endOffset
    };

    const marks = wrapRange(range.cloneRange(), id);
    if (!marks.length) return false;

    missingGroups.delete(id);
    groupMeta.set(id, { note: '', createdAt: null, missing: false, ...anchorPaths });

    const sel = window.getSelection();
    sel?.removeAllRanges?.();

    currentNavIndex = -1;
    clearActiveClass();

    requestPersist();

    onChange?.();
    return true;
  }

  function createFromText(text) {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const range = findTextRange(trimmed) || resolveAnchorRange({ text: trimmed, prefix: '', suffix: '' });
    if (!range) return false;

    return annotateRange(range);
  }

  async function restoreFromStorage() {
    if (destroyed || !isTopFrame() || !isExtensionAlive()) return;

    try {
      const data = await WSAnnotationStorage.load(getPageUrl());
      if (!data?.groups?.length) return;

      for (const anchor of data.groups) {
        groupMeta.set(anchor.id, {
          note: anchor.note || '',
          createdAt: anchor.createdAt || null,
          missing: false,
          startPath: anchor.startPath,
          endPath: anchor.endPath,
          startOffset: anchor.startOffset,
          endOffset: anchor.endOffset
        });

        if (getMarksForGroup(anchor.id).length) continue;

        let range = null;
        for (const doc of getIframeRoots()) {
          range = resolveAnchorRange(anchor, doc);
          if (range) break;
        }

        if (!range) {
          missingGroups.set(anchor.id, anchor);
          groupMeta.set(anchor.id, {
            note: anchor.note || '',
            createdAt: anchor.createdAt || null,
            missing: true,
            startPath: anchor.startPath,
            endPath: anchor.endPath,
            startOffset: anchor.startOffset,
            endOffset: anchor.endOffset
          });
          continue;
        }

        try {
          wrapRange(range, anchor.id);
          missingGroups.delete(anchor.id);
          const num = parseInt(String(anchor.id).split('-').pop(), 10);
          if (num >= nextId) nextId = num + 1;
        } catch {
          missingGroups.set(anchor.id, anchor);
          groupMeta.set(anchor.id, {
            ...(groupMeta.get(anchor.id) || {}),
            missing: true
          });
        }
      }

      currentNavIndex = -1;
      clearActiveClass();
      onChange?.();
    } catch {
      /* ignore restore errors */
    }
  }

  function removeGroup(id) {
    for (const mark of getMarksForGroup(id)) {
      unwrapMark(mark);
    }

    groupMeta.delete(id);
    missingGroups.delete(id);
    syncMetaDeleteToTop(id);

    const ids = getNavigationGroupIds();
    if (currentNavIndex >= ids.length) {
      currentNavIndex = ids.length ? ids.length - 1 : -1;
    }
    clearActiveClass();
    if (currentNavIndex >= 0 && ids[currentNavIndex]) {
      setActiveGroup(ids[currentNavIndex]);
    }

    requestPersist();
    onChange?.();
  }

  function removeElement(mark) {
    const id = mark?.getAttribute?.(ID_ATTR);
    if (!id) return false;
    removeGroup(id);
    return true;
  }

  function createFromSelection(fallbackText = '') {
    const sel = window.getSelection();
    let range = null;

    if (sel?.rangeCount && !sel.isCollapsed) {
      range = sel.getRangeAt(0);
    } else {
      range = takeCachedRange();
    }

    if (range && isRangeValid(range)) {
      return annotateRange(range);
    }

    if (fallbackText) {
      return createFromText(fallbackText);
    }

    return false;
  }

  function clearVisuals({ notify = true } = {}) {
    for (const mark of [...getAllMarks()]) {
      unwrapMark(mark);
    }
    currentNavIndex = -1;
    clearActiveClass();
    if (notify && !destroyed) {
      onChange?.();
    }
  }

  function clearAll({ clearStorage = true, notify = true } = {}) {
    for (const mark of [...getAllMarks()]) {
      unwrapMark(mark);
    }

    groupMeta.clear();
    missingGroups.clear();
    currentNavIndex = -1;
    clearActiveClass();

    if (clearStorage && isTopFrame()) {
      clearStorageForUrl();
    }

    if (notify && !destroyed) {
      onChange?.();
    }
  }

  function getState() {
    const ids = getNavigationGroupIds();
    const total = ids.length;
    let displayCurrent = 0;

    if (currentNavIndex >= 0 && currentNavIndex < total) {
      displayCurrent = currentNavIndex + 1;
    }

    return {
      total,
      displayCurrent,
      currentIndex: currentNavIndex
    };
  }

  function getGroupMeta(id) {
    const meta = groupMeta.get(id);
    return meta ? { note: meta.note, createdAt: meta.createdAt } : { note: '', createdAt: null };
  }

  function setGroupNote(id, note) {
    const hasMarks = getMarksForGroup(id).length > 0;
    const isKnownGroup = hasMarks || missingGroups.has(id) || groupMeta.has(id);
    if (!isKnownGroup) return false;

    const trimmed = (note || '').trim();
    const existing = groupMeta.get(id) || { note: '', createdAt: null };

    if (trimmed) {
      groupMeta.set(id, {
        ...existing,
        note: trimmed,
        createdAt: existing.createdAt || Date.now()
      });
    } else {
      groupMeta.set(id, { ...existing, note: '', createdAt: null });
    }

    syncMetaToTop(id);
    requestPersist();
    onChange?.();
    return true;
  }

  function syncMetaToTop(id) {
    if (isTopFrame()) return;
    const meta = groupMeta.get(id);
    if (!meta) return;
    try {
      window.top.postMessage({
        type: 'ws-annotation-event',
        action: 'updateMeta',
        nonce: globalThis.__wsFrameNonce || '',
        id,
        meta: { note: meta.note, createdAt: meta.createdAt }
      }, '*');
    } catch {
      /* ignore */
    }
  }

  function syncMetaDeleteToTop(id) {
    if (isTopFrame()) return;
    try {
      window.top.postMessage({
        type: 'ws-annotation-event',
        action: 'deleteMeta',
        nonce: globalThis.__wsFrameNonce || '',
        id
      }, '*');
    } catch {
      /* ignore */
    }
  }

  function deleteGroupNote(id) {
    return setGroupNote(id, '');
  }

  function getAnnotationsList() {
    const items = getGroupIdsOrdered().map((id) => {
      const marks = getMarksForGroup(id);
      const text = marks.map((m) => m.textContent).join('');
      const meta = getGroupMeta(id);
      return {
        id,
        text,
        note: meta.note,
        createdAt: meta.createdAt,
        hasNote: Boolean(meta.note),
        missing: false
      };
    });

    for (const [id, anchor] of missingGroups) {
      if (items.some((item) => item.id === id)) continue;
      const meta = getGroupMeta(id);
      items.push({
        id,
        text: anchor.text || '',
        note: meta.note,
        createdAt: meta.createdAt,
        hasNote: Boolean(meta.note),
        missing: true
      });
    }

    return items;
  }

  function getActiveGroupId() {
    const ids = getNavigationGroupIds();
    if (currentNavIndex >= 0 && currentNavIndex < ids.length) {
      return ids[currentNavIndex];
    }
    return null;
  }

  function goToGroup(id) {
    const ids = getNavigationGroupIds();
    const index = ids.indexOf(id);
    if (index < 0) return false;

    currentNavIndex = index;
    setActiveGroup(id);
    scrollToGroup(id);
    onChange?.();
    return true;
  }

  function isAnnotationMode() {
    return annotationMode;
  }

  function navigate(direction) {
    const ids = getNavigationGroupIds();
    if (!ids.length) {
      currentNavIndex = -1;
      clearActiveClass();
      onChange?.();
      return;
    }

    if (currentNavIndex < 0) {
      currentNavIndex = direction === 'PREV' ? ids.length - 1 : 0;
    } else if (direction === 'NEXT') {
      currentNavIndex = (currentNavIndex + 1) % ids.length;
    } else if (direction === 'PREV') {
      currentNavIndex = currentNavIndex <= 0 ? ids.length - 1 : currentNavIndex - 1;
    }

    const id = ids[currentNavIndex];
    setActiveGroup(id);
    scrollToGroup(id);
    onChange?.();
  }

  function setAnnotationMode(enabled) {
    annotationMode = enabled;
    const root = document.documentElement;
    if (enabled) {
      root.dataset.wsAnnotationMode = 'on';
    } else {
      root.dataset.wsAnnotationMode = 'off';
      currentNavIndex = -1;
      clearActiveClass();
    }
  }

  function onFrameMessage(event) {
    const msg = event.data;
    if (msg?.type !== 'ws-annotation-event') return;
    if (!globalThis.__wsFrameNonce || msg.nonce !== globalThis.__wsFrameNonce) return;

    let fromChild = false;
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        if (event.source === frame.contentWindow) {
          fromChild = true;
          break;
        }
      } catch { /* ignore */ }
    }
    if (!fromChild) return;

    if (msg.action === 'persist' && isTopFrame()) {
      persistGroups();
    }

    if (msg.action === 'updateMeta' && isTopFrame() && msg.id) {
      groupMeta.set(msg.id, {
        note: msg.meta?.note || '',
        createdAt: msg.meta?.createdAt || null
      });
      persistGroups();
    }

    if (msg.action === 'deleteMeta' && isTopFrame() && msg.id) {
      groupMeta.delete(msg.id);
      persistGroups();
    }
  }

  function init(options = {}) {
    destroyed = false;
    onChange = options.onChange || null;
    applyColors(WS_DEFAULTS);
    document.documentElement.dataset.wsAnnotationMode = annotationMode ? 'on' : 'off';

    if (!selectionCacheHandler) {
      selectionCacheHandler = cacheSelectionRange;
      document.addEventListener('mouseup', selectionCacheHandler, true);
      document.addEventListener('keyup', selectionCacheHandler, true);
      document.addEventListener('contextmenu', selectionCacheHandler, true);
      document.addEventListener('selectionchange', selectionCacheHandler);
    }

    window.addEventListener('message', onFrameMessage);
  }

  function destroy() {
    destroyed = true;

    if (selectionCacheHandler) {
      document.removeEventListener('mouseup', selectionCacheHandler, true);
      document.removeEventListener('keyup', selectionCacheHandler, true);
      document.removeEventListener('contextmenu', selectionCacheHandler, true);
      document.removeEventListener('selectionchange', selectionCacheHandler);
      selectionCacheHandler = null;
    }

    lastCachedRange = null;

    window.removeEventListener('message', onFrameMessage);

    clearAll({ clearStorage: false, notify: false });
    onChange = null;
    annotationMode = false;
  }

  return {
    init,
    destroy,
    isTopFrame,
    applyColors,
    applyPillThemeToElement,
    createFromSelection,
    clearAll,
    clearVisuals,
    clearStorageForUrl,
    removeElement,
    removeGroup,
    navigate,
    getState,
    getGroupMeta,
    getGroupText,
    setGroupNote,
    deleteGroupNote,
    getAnnotationsList,
    getActiveGroupId,
    goToGroup,
    isAnnotationMode,
    getFirstMarkForGroup,
    restoreFromStorage,
    setAnnotationMode,
    persistGroups,
    invalidateTextMapCache,
    scheduleTextMapInvalidation
  };
})();
