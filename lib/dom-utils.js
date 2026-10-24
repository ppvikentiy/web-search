/**
 * Shared DOM utilities: exclusion checks, scrolling, text node collection.
 */
globalThis.WSDomUtils = (() => {
  const UI_REMOVE_SELECTORS = [
    '#ws-search-sidebar',
    '#ws-annotation-pill',
    '#ws-reader-pill',
    '#ws-reader-outline',
    '.ws-ann-note-editor',
    '.ws-ann-popover',
    '.ws-ann-menu',
    '.ws-dict-popup'
  ];
  const UI_UNWRAP_SELECTORS = [
    'mark.ws-match',
    'mark.ws-annotation'
  ];
  const EXTENSION_UI_SELECTOR = [...UI_REMOVE_SELECTORS, ...UI_UNWRAP_SELECTORS].join(', ');
  const WIDGET_THEME_SELECTOR = [
    '#ws-search-sidebar',
    '#ws-annotation-pill',
    '.ws-ann-popover',
    '.ws-ann-menu',
    '.ws-ann-note-editor',
    '.ws-dict-popup'
  ].join(', ');

  let cacheGeneration = 0;
  const excludeCache = new WeakMap();
  let uiTheme = { theme: 'system', customProps: null };
  const POPUP_THEME_VARS = [
    '--ws-ann-popup-bg',
    '--ws-ann-popup-text',
    '--ws-ann-popup-muted',
    '--ws-ann-popup-border',
    '--ws-ann-popup-shadow',
    '--ws-ann-popup-input-bg',
    '--ws-ann-popup-input-border',
    '--ws-ann-popup-btn-hover',
    '--ws-ann-popup-btn-primary-bg',
    '--ws-ann-popup-btn-primary-hover',
    '--ws-ann-popup-btn-danger-hover',
    '--ws-ann-popup-btn-danger-text',
    '--ws-ann-popup-focus'
  ];
  function applyThemeToElement(el, themeState = uiTheme) {
    if (!el) return;
    const theme = themeState.theme || 'system';
    if (theme === 'system') {
      delete el.dataset.wsAnnPopupTheme;
    } else {
      el.dataset.wsAnnPopupTheme = theme;
    }
    if (!el.style) return;
    for (const name of POPUP_THEME_VARS) {
      el.style.removeProperty(name);
    }
    if (theme === 'custom' && themeState.customProps) {
      for (const [name, value] of Object.entries(themeState.customProps)) {
        el.style.setProperty(name, value);
      }
    }
  }

  function normalizeExcludeConfig(config = {}) {
    const tags = config.excludeTags instanceof Set
      ? config.excludeTags
      : new Set((config.excludeTags || []).map((t) => String(t).toLowerCase()));

    return {
      excludeTags: tags,
      excludeSelectors: config.excludeSelectors || [],
      skipMatchMarks: Boolean(config.skipMatchMarks),
      skipAnnotationMarks: Boolean(config.skipAnnotationMarks),
      skipAnnotationPill: Boolean(config.skipAnnotationPill),
      skipAnnotationUi: Boolean(config.skipAnnotationUi)
    };
  }

  function clearExcludeCache() {
    cacheGeneration += 1;
  }

  function isExcludedNode(node, config = {}) {
    if (!node) return true;

    const normalized = normalizeExcludeConfig(config);
    const cached = excludeCache.get(node);
    if (cached && cached.generation === cacheGeneration) {
      return cached.excluded;
    }

    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    let excluded = false;

    while (el) {
      const tag = el.tagName?.toLowerCase();
      if (tag && normalized.excludeTags.has(tag)) {
        excluded = true;
        break;
      }

      if (normalized.excludeSelectors.length) {
        for (const sel of normalized.excludeSelectors) {
          if (sel && el.closest?.(sel)) {
            excluded = true;
            break;
          }
        }
        if (excluded) break;
      }

      if (normalized.skipMatchMarks && el.closest?.('mark.ws-match')) {
        excluded = true;
        break;
      }

      if (normalized.skipAnnotationMarks && el.closest?.('mark.ws-annotation')) {
        excluded = true;
        break;
      }

      if (normalized.skipAnnotationPill && el.closest?.('#ws-annotation-pill')) {
        excluded = true;
        break;
      }

      if (normalized.skipAnnotationUi && el.closest?.('.ws-ann-menu, .ws-ann-popover, .ws-ann-note-editor, .ws-dict-popup')) {
        excluded = true;
        break;
      }

      if (el.isContentEditable) {
        excluded = true;
        break;
      }

      el = el.parentElement;
    }

    excludeCache.set(node, { generation: cacheGeneration, excluded });
    return excluded;
  }

  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    return rect.width > 0
      && rect.height > 0
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < vh
      && rect.left < vw;
  }

  function scrollWindowToRect(rect) {
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const top = window.scrollY + rect.top - vh / 2 + rect.height / 2;
    const left = window.scrollX + rect.left - vw / 2 + rect.width / 2;
    try {
      window.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'auto' });
    } catch {
      window.scrollTo(Math.max(0, left), Math.max(0, top));
    }
  }

  function scrollElementIntoView(element) {
    if (!element?.isConnected) return;

    const firstRect = element.getBoundingClientRect();
    if (firstRect.width || firstRect.height) {
      scrollWindowToRect(firstRect);
    }

    try {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    } catch {
      try {
        element.scrollIntoView(true);
      } catch { /* ignore */ }
    }

    let parent = element.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const style = getComputedStyle(parent);
      const scrollableY =
        /(auto|scroll|overlay)/.test(style.overflowY) ||
        /(auto|scroll|overlay)/.test(style.overflow);
      const scrollableX =
        /(auto|scroll|overlay)/.test(style.overflowX) ||
        /(auto|scroll|overlay)/.test(style.overflow);

      if (scrollableY && parent.scrollHeight > parent.clientHeight + 1) {
        const rect = element.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        parent.scrollTop += rect.top - parentRect.top - parentRect.height / 2 + rect.height / 2;
      }
      if (scrollableX && parent.scrollWidth > parent.clientWidth + 1) {
        const rect = element.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        parent.scrollLeft += rect.left - parentRect.left - parentRect.width / 2 + rect.width / 2;
      }
      parent = parent.parentElement;
    }

    if (!isInViewport(element)) {
      scrollWindowToRect(element.getBoundingClientRect());
    }
  }

  function collectTextNodesFromRoot(root, config, ownerDoc) {
    const nodes = [];
    if (!root) return nodes;
    const doc = ownerDoc || root.ownerDocument || document;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
        if (isExcludedNode(node, config)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let n;
    while ((n = walker.nextNode())) {
      nodes.push(n);
    }
    return nodes;
  }

  function collectTextNodes(roots, config = {}) {
    const nodes = [];
    for (const root of roots) {
      if (!root) continue;
      const ownerDoc = root.ownerDocument || document;
      nodes.push(...collectTextNodesFromRoot(root, config, ownerDoc));
    }
    return nodes;
  }

  function collectShadowRoots(parent) {
    const shadows = [];
    const walk = (element) => {
      if (!element) return;
      if (element.shadowRoot) {
        shadows.push(element.shadowRoot);
        walkShadowTree(element.shadowRoot, shadows);
      }
      for (const child of element.children || []) {
        walk(child);
      }
    };

    const walkShadowTree = (shadowParent, list) => {
      for (const el of shadowParent.querySelectorAll?.('*') || []) {
        if (el.shadowRoot) {
          list.push(el.shadowRoot);
          walkShadowTree(el.shadowRoot, list);
        }
      }
    };

    walk(parent);
    return shadows;
  }

  function getNodePath(node, stopAt = null) {
    const path = [];
    let current = node;

    while (current && current !== stopAt) {
      const parent = current.parentNode;
      if (!parent) break;

      let index = -1;
      for (let i = 0; i < parent.childNodes.length; i += 1) {
        if (parent.childNodes[i] === current) {
          index = i;
          break;
        }
      }

      if (index < 0) break;
      path.unshift(index);
      current = parent;
    }

    return path;
  }

  function resolveNodePath(path, doc = document) {
    if (!path?.length) return null;

    let node = doc.body || doc.documentElement;
    for (const index of path) {
      if (!node?.childNodes?.[index]) return null;
      node = node.childNodes[index];
    }
    return node;
  }

  function isInsideExtensionUi(node) {
    if (!node) return false;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return Boolean(el?.closest?.(EXTENSION_UI_SELECTOR));
  }

  function unwrapMarks(root, selector, doc) {
    if (!root?.querySelectorAll) return;
    const owner = doc || root.ownerDocument || document;
    for (const mark of [...root.querySelectorAll(selector)]) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(owner.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    }
  }

  function removeExtensionUi(root) {
    if (!root?.querySelectorAll) return;
    for (const el of [...root.querySelectorAll(UI_REMOVE_SELECTORS.join(','))]) {
      el.remove();
    }
  }

  function refreshAnnotationPillTheme(el) {
    if (el?.id === 'ws-annotation-pill') {
      globalThis.WSAnnotations?.applyPillThemeToElement?.(el);
    }
  }

  function setExtensionUiTheme(theme, customProps = null) {
    uiTheme = { theme: theme || 'system', customProps };
    if (typeof document === 'undefined') return;
    document.querySelectorAll(WIDGET_THEME_SELECTOR).forEach((el) => {
      applyThemeToElement(el, uiTheme);
      refreshAnnotationPillTheme(el);
    });
  }

  function decorateExtensionUi(el) {
    applyThemeToElement(el, uiTheme);
    refreshAnnotationPillTheme(el);
  }

  return {
    UI_REMOVE_SELECTORS,
    UI_UNWRAP_SELECTORS,
    EXTENSION_UI_SELECTOR,
    WIDGET_THEME_SELECTOR,
    normalizeExcludeConfig,
    clearExcludeCache,
    isExcludedNode,
    scrollElementIntoView,
    collectTextNodesFromRoot,
    collectTextNodes,
    collectShadowRoots,
    getNodePath,
    resolveNodePath,
    isInsideExtensionUi,
    unwrapMarks,
    removeExtensionUi,
    setExtensionUiTheme,
    decorateExtensionUi
  };
})();
