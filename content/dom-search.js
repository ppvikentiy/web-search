/**
 * DOM search, highlighting, and navigation.
 */
globalThis.WSDomSearch = (() => {
  const MARK_CLASS = 'ws-match';
  const CURRENT_CLASS = 'ws-current';
  const HIGHLIGHT_NAME = 'ws-match';
  const CURRENT_HIGHLIGHT_NAME = 'ws-current-match';

  const supportsHighlightApi = typeof CSS !== 'undefined'
    && Boolean(CSS.highlights)
    && typeof Highlight !== 'undefined';

  let matcherCache = { key: '', matcher: null };
  let markIdCounter = 0;
  // DOM marks are reliable in content scripts; Highlight API styling is inconsistent.
  let useHighlightApi = false;
  const highlightRanges = [];
  let currentHighlightRange = null;

  function applyHighlightColors(settings) {
    const root = document.documentElement;
    root.style.setProperty('--ws-highlight-color', settings.highlightColor || '#ffff00');
    root.style.setProperty('--ws-current-highlight-color', settings.currentHighlightColor || '#ff9632');
  }

  function invalidateMatcherCache() {
    matcherCache = { key: '', matcher: null };
  }

  function getExcludeConfig(settings) {
    return {
      excludeTags: settings.excludeTags || [],
      excludeSelectors: [
        ...(settings.excludeSelectors || []),
        ...WSDomUtils.UI_REMOVE_SELECTORS
      ],
      skipMatchMarks: true,
      skipAnnotationMarks: true
    };
  }

  function collectRoots(settings) {
    const roots = [{ root: document.body || document.documentElement, doc: document }];

    if (settings.searchShadowDom) {
      const body = document.body || document.documentElement;
      for (const shadowRoot of WSDomUtils.collectShadowRoots(body)) {
        roots.push({ root: shadowRoot, doc: document });
      }
    }

    /* iframe search is coordinated via postMessage in content.js (allFrames injection). */

    return roots.filter((r) => r.root);
  }

  function buildTermPattern(term, wholeWord) {
    return wholeWord ? wsBuildWholeWordPattern(term) : wsBuildSubstringPattern(term);
  }

  function buildQuickFilters(query, options, terms = null) {
    const filters = new Set();
    const trimmed = query.trim();
    if (!trimmed) return filters;

    const addFilter = (value) => {
      if (!value) return;
      filters.add(value);
      if (!options.caseSensitive) {
        filters.add(value.toLowerCase());
      }
    };

    addFilter(trimmed);
    if (terms) {
      for (const term of terms) {
        addFilter(term);
      }
    }

    return filters;
  }

  function passesQuickFilter(text, quickFilters, caseSensitive = true) {
    if (!quickFilters?.size) return true;
    const haystack = caseSensitive ? text : text.toLowerCase();
    for (const filter of quickFilters) {
      if (!filter) continue;
      const needle = caseSensitive ? filter : filter.toLowerCase();
      if (haystack.includes(needle)) return true;
    }
    return false;
  }

  function buildSingleMatcher(terms, options) {
    const wholeWord = options.matchMode === 'whole' || options.wholeWord;
    const flags = options.caseSensitive ? 'gu' : 'giu';
    const escapedTerms = [...terms]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length || a.localeCompare(b))
      .map((t) => buildTermPattern(t, wholeWord));

    if (!escapedTerms.length) return null;

    const source = escapedTerms.join('|');
    try {
      return {
        type: 'regex',
        regex: new RegExp(source, flags),
        quickFilters: buildQuickFilters([...terms][0] || '', options, terms)
      };
    } catch {
      return null;
    }
  }

  function buildPhraseMatcher(query, options) {
    const words = wsSplitWords(query);
    if (!words.length) return null;

    const wholeWord = options.matchMode === 'whole' || options.wholeWord;
    const flags = options.caseSensitive ? 'gu' : 'giu';
    const { phraseMode } = options;

    const wordPatterns = words.map((w) => buildTermPattern(w, wholeWord));
    const separator = phraseMode === 'flexible' ? '[\\s\\p{P}]+' : '\\s+';

    try {
      return {
        type: 'regex',
        regex: new RegExp(wordPatterns.join(separator), flags),
        quickFilters: buildQuickFilters(query, options, words)
      };
    } catch {
      return null;
    }
  }

  function buildPhraseSequentialMatcher(query, options) {
    const words = wsSplitWords(query);
    if (!words.length) return null;

    const wordFormSets = WSMorphology.getPhraseWordFormSets(words, options);
    const filterTerms = wordFormSets.flatMap((set) => [...set]);

    return {
      type: 'phrase',
      words,
      wordFormSets,
      options: {
        caseSensitive: options.caseSensitive,
        wholeWord: options.matchMode === 'whole' || options.wholeWord,
        phraseMode: options.phraseMode
      },
      quickFilters: buildQuickFilters(query, options, filterTerms),
      warning: null
    };
  }

  async function buildMatcher(query, options) {
    await WSMorphology.loadDictionary();

    const cacheKey = JSON.stringify({
      query: query.trim(),
      options,
      morphDepth: options.morphDepth
    });

    if (matcherCache.key === cacheKey && matcherCache.matcher) {
      return matcherCache.matcher;
    }

    const trimmed = query.trim();
    if (!trimmed) return null;

    let matcher = null;

    if (wsIsPhrase(trimmed)) {
      const usePhraseMorph = options.phraseMode === 'morph' || options.useMorphology;
      if (usePhraseMorph) {
        matcher = buildPhraseSequentialMatcher(trimmed, options);
      } else {
        matcher = buildPhraseMatcher(trimmed, options);
      }
    } else {
      let terms;
      if (options.useMorphology) {
        terms = WSMorphology.expandQuery(trimmed, options);
      } else {
        terms = new Set([trimmed]);
        if (!options.caseSensitive) {
          terms.add(trimmed.toLowerCase());
          terms.add(trimmed.toUpperCase());
          terms.add(trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase());
        }
      }
      matcher = buildSingleMatcher(terms, options);
      if (matcher) {
        matcher.quickFilters = buildQuickFilters(trimmed, options, terms);
      }
    }

    matcherCache = { key: cacheKey, matcher };
    return matcher;
  }

  function wordMatchesAt(text, pos, form, wholeWord, caseSensitive) {
    const haystack = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? form : form.toLowerCase();
    if (!haystack.startsWith(needle, pos)) return false;
    if (wholeWord && !wsIsWholeWordMatch(text, pos, form.length)) return false;
    return true;
  }

  function skipSeparator(text, pos, flexible) {
    if (flexible) {
      let i = pos;
      while (i < text.length && /[\s\p{P}]/u.test(text[i])) i += 1;
      return i;
    }
    let i = pos;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    return i;
  }

  function findPhraseMatchesInText(text, matcher) {
    const { wordFormSets, options } = matcher;
    const { caseSensitive, wholeWord, phraseMode } = options;
    const flexible = phraseMode === 'flexible';
    const matches = [];

    for (let i = 0; i < text.length; i += 1) {
      let pos = i;
      let allMatched = true;

      for (let w = 0; w < wordFormSets.length; w += 1) {
        const forms = [...wordFormSets[w]].sort((a, b) => b.length - a.length);
        let wordFound = false;

        for (const form of forms) {
          if (wordMatchesAt(text, pos, form, wholeWord, caseSensitive)) {
            pos += form.length;
            wordFound = true;
            break;
          }
        }

        if (!wordFound) {
          allMatched = false;
          break;
        }

        if (w < wordFormSets.length - 1) {
          const nextPos = skipSeparator(text, pos, flexible);
          if (nextPos === pos) {
            allMatched = false;
            break;
          }
          pos = nextPos;
        }
      }

      if (allMatched && pos > i) {
        matches.push({ start: i, length: pos - i, text: text.slice(i, pos) });
        i = pos - 1;
      }
    }

    return matches;
  }

  function findRegexMatchesInText(text, regex) {
    const matches = [];
    regex.lastIndex = 0;

    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push({ start: match.index, length: match[0].length, text: match[0] });
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }

    return matches;
  }

  function findMatchesInNode(textNode, matcher) {
    const text = textNode.nodeValue;
    const caseSensitive = matcher.type === 'phrase'
      ? Boolean(matcher.options?.caseSensitive)
      : !matcher.regex?.flags?.includes('i');
    if (!passesQuickFilter(text, matcher.quickFilters, caseSensitive)) return [];

    if (matcher.type === 'phrase') {
      return findPhraseMatchesInText(text, matcher);
    }

    return findRegexMatchesInText(text, matcher.regex);
  }

  function clearHighlightApi() {
    if (!supportsHighlightApi) return;
    try {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      CSS.highlights.delete(CURRENT_HIGHLIGHT_NAME);
    } catch {
      /* ignore */
    }
    highlightRanges.length = 0;
    currentHighlightRange = null;
  }

  function clearHighlightsInRoot(root, doc) {
    WSDomUtils.unwrapMarks(root, `mark.${MARK_CLASS}`, doc);
  }

  function clearHighlights() {
    clearHighlightApi();
    for (const { root, doc } of collectRoots({ searchIframes: true, searchShadowDom: true, excludeTags: [], excludeSelectors: [] })) {
      clearHighlightsInRoot(root, doc);
    }
  }

  function canUseHighlightApiForNode(textNode) {
    if (!useHighlightApi) return false;
    const root = textNode.getRootNode?.();
    return root === document || root === document.documentElement;
  }

  function createRangeForMatch(textNode, match) {
    const range = document.createRange();
    range.setStart(textNode, match.start);
    range.setEnd(textNode, match.start + match.length);
    return range;
  }

  function highlightInNode(textNode, matcher) {
    const text = textNode.nodeValue;
    const doc = textNode.ownerDocument || document;
    const matchList = findMatchesInNode(textNode, matcher);
    if (!matchList.length) return [];

    if (useHighlightApi && canUseHighlightApiForNode(textNode)) {
      try {
        const marks = [];
        let lastHighlight = 0;
        for (const m of matchList) {
          if (m.start < lastHighlight) continue;
          const range = createRangeForMatch(textNode, m);
          highlightRanges.push(range);
          const mark = doc.createElement('mark');
          mark.className = MARK_CLASS;
          mark.setAttribute('data-ws-mark-id', String(++markIdCounter));
          mark._wsRange = range;
          mark.textContent = m.text;
          marks.push(mark);
          lastHighlight = m.start + m.length;
        }
        if (highlightRanges.length) {
          CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...highlightRanges));
        }
        return marks;
      } catch {
        useHighlightApi = false;
        highlightRanges.length = 0;
      }
    }

    const marks = [];
    const frag = doc.createDocumentFragment();
    let last = 0;

    for (const m of matchList) {
      if (m.start < last) continue;
      if (m.start > last) {
        frag.appendChild(doc.createTextNode(text.slice(last, m.start)));
      }
      const mark = doc.createElement('mark');
      mark.className = MARK_CLASS;
      mark.setAttribute('data-ws-mark-id', String(++markIdCounter));
      mark.textContent = m.text;
      frag.appendChild(mark);
      marks.push(mark);
      last = m.start + m.length;
    }

    if (last < text.length) {
      frag.appendChild(doc.createTextNode(text.slice(last)));
    }

    textNode.parentNode.replaceChild(frag, textNode);
    return marks;
  }

  function searchRoots(roots, matcher, settings) {
    const excludeConfig = getExcludeConfig(settings);
    const matches = [];

    for (const root of roots) {
      const textNodes = WSDomUtils.collectTextNodesFromRoot(root, excludeConfig, root.ownerDocument || document);
      for (const node of textNodes) {
        matches.push(...highlightInNode(node, matcher));
      }
    }

    return matches;
  }

  async function searchFull(query, options, settings) {
    clearHighlights();
    applyHighlightColors(settings);

    const matcher = await buildMatcher(query, { ...options, morphDepth: settings.morphDepth });
    if (!matcher) {
      return { matches: [], total: 0, currentIndex: -1, warning: null };
    }

    const roots = collectRoots(settings).map((r) => r.root);
    const matches = searchRoots(roots, matcher, settings);

    return {
      matches,
      total: matches.length,
      currentIndex: matches.length ? 0 : -1,
      warning: matcher.warning || null
    };
  }

  async function searchIncremental(changedRoots, query, options, settings) {
    if (!changedRoots?.length) {
      return { matches: null, warning: null };
    }

    applyHighlightColors(settings);

    const matcher = await buildMatcher(query, { ...options, morphDepth: settings.morphDepth });
    if (!matcher) {
      return { matches: [], warning: null };
    }

    const newMatches = searchRoots(changedRoots, matcher, settings);
    return { matches: newMatches, warning: matcher.warning || null };
  }

  async function search(query, options, settings) {
    return searchFull(query, options, settings);
  }

  function scrollMatchIntoView(element) {
    if (element?._wsRange) {
      const rect = element._wsRange.getBoundingClientRect?.();
      if (rect) {
        const temp = document.createElement('span');
        temp.style.position = 'fixed';
        temp.style.left = `${rect.left}px`;
        temp.style.top = `${rect.top}px`;
        temp.style.width = `${rect.width}px`;
        temp.style.height = `${rect.height}px`;
        temp.style.pointerEvents = 'none';
        document.body.appendChild(temp);
        WSDomUtils.scrollElementIntoView(temp);
        temp.remove();
        return;
      }
    }
    WSDomUtils.scrollElementIntoView(element);
  }

  function setCurrentMatch(matches, index, { scroll = false } = {}) {
    for (const m of matches) {
      m?.classList?.remove(CURRENT_CLASS);
    }

    if (supportsHighlightApi && highlightRanges.length) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...highlightRanges));
      CSS.highlights.delete(CURRENT_HIGHLIGHT_NAME);
      currentHighlightRange = null;
    }

    if (index < 0 || index >= matches.length) return -1;

    const current = matches[index];
    if (!current?.isConnected && !current?._wsRange) return -1;

    current.classList?.add(CURRENT_CLASS);

    if (supportsHighlightApi && current._wsRange) {
      currentHighlightRange = current._wsRange;
      CSS.highlights.set(CURRENT_HIGHLIGHT_NAME, new Highlight(current._wsRange));
    }

    if (scroll) {
      scrollMatchIntoView(current);
    }
    return index;
  }

  function filterLiveMatches(matches) {
    return matches.filter((m) => m.isConnected || m._wsRange);
  }

  function findMatchIndexByMarkId(matches, markId) {
    if (!markId) return -1;
    return matches.findIndex((m) => m.getAttribute?.('data-ws-mark-id') === markId);
  }

  function collectChangedRootsFromMutations(mutations) {
    const roots = new Set();

    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const node = mutation.target;
        if (node?.parentElement && !WSDomUtils.isInsideExtensionUi(node)) {
          roots.add(node.parentElement);
        }
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.parentElement && !WSDomUtils.isInsideExtensionUi(node)) {
            roots.add(node.parentElement);
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (!WSDomUtils.isInsideExtensionUi(node)) {
            roots.add(node);
          }
        }
      }
    }

    return [...roots];
  }

  function isRelevantMutation(mutation) {
    if (mutation.type === 'characterData') {
      return !WSDomUtils.isInsideExtensionUi(mutation.target);
    }

    for (const node of mutation.addedNodes) {
      if (!WSDomUtils.isInsideExtensionUi(node)) return true;
    }

    for (const node of mutation.removedNodes) {
      if (!WSDomUtils.isInsideExtensionUi(node)) return true;
    }

    return false;
  }

  function mergeIncrementalMatches(existingMatches, newMatches, preferredMarkId) {
    const live = filterLiveMatches(existingMatches);
    const combined = [...live, ...newMatches];

    if (preferredMarkId) {
      const idx = findMatchIndexByMarkId(combined, preferredMarkId);
      return { matches: combined, currentIndex: idx >= 0 ? idx : live.length ? 0 : -1 };
    }

    return { matches: combined, currentIndex: live.length ? 0 : combined.length ? 0 : -1 };
  }

  return {
    search,
    searchFull,
    searchIncremental,
    clearHighlights,
    setCurrentMatch,
    filterLiveMatches,
    applyHighlightColors,
    invalidateMatcherCache,
    findMatchIndexByMarkId,
    collectChangedRootsFromMutations,
    isRelevantMutation,
    mergeIncrementalMatches,
    collectRoots,
    getExcludeConfig,
    findPhraseMatchesInText
  };
})();
