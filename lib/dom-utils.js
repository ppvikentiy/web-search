/**
 * Shared DOM utilities: exclusion checks, scrolling, text node collection.
 */
globalThis.WSDomUtils = (() => {
  let cacheGeneration = 0;
  const excludeCache = new WeakMap();

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

  function scrollElementIntoView(element) {
    if (!element?.isConnected) return;

    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });

    const rect = element.getBoundingClientRect();
    const inViewport =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth;

    if (inViewport) return;

    let parent = element.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      const scrollable =
        /(auto|scroll|overlay)/.test(style.overflowY) ||
        /(auto|scroll|overlay)/.test(style.overflow);

      if (scrollable && parent.scrollHeight > parent.clientHeight) {
        const parentRect = parent.getBoundingClientRect();
        const offset = rect.top - parentRect.top - parentRect.height / 2 + rect.height / 2;
        parent.scrollTop += offset;
      }
      parent = parent.parentElement;
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
    return Boolean(
      el?.closest?.('mark.ws-match, mark.ws-annotation, #ws-annotation-pill, #ws-search-sidebar, .ws-ann-menu, .ws-ann-popover, .ws-ann-note-editor, .ws-dict-popup')
    );
  }

  return {
    normalizeExcludeConfig,
    clearExcludeCache,
    isExcludedNode,
    scrollElementIntoView,
    collectTextNodesFromRoot,
    collectTextNodes,
    collectShadowRoots,
    getNodePath,
    resolveNodePath,
    isInsideExtensionUi
  };
})();
