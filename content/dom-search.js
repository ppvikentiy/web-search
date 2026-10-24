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

  const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'details',
    'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
    'button', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li',
    'main', 'nav', 'ol', 'option', 'p', 'pre', 'section', 'select', 'summary',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'svg', 'math'
  ]);

  function foldYo(value) {
    return String(value || '').replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  }

  function foldYoInPattern(pattern, caseSensitive) {
    if (!caseSensitive) return pattern.replace(/[еёЕЁ]/g, '[её]');
    return pattern.replace(/[её]/g, '[её]').replace(/[ЕЁ]/g, '[ЕЁ]');
  }

  function buildTermPattern(term, wholeWord, caseSensitive) {
    const base = wholeWord ? wsBuildWholeWordPattern(term) : wsBuildSubstringPattern(term);
    return foldYoInPattern(base, caseSensitive);
  }

  function compileWildcardSource(value, wholeWord, caseSensitive) {
    let literals = 0;
    let wildcards = 0;
    let body = '';
    for (const ch of value) {
      if (ch === '*') {
        wildcards += 1;
        body += '[\\p{L}\\p{N}_]*';
        continue;
      }
      if (ch === '?') {
        wildcards += 1;
        literals += 1;
        body += '[\\p{L}\\p{N}_]';
        continue;
      }
      if (/[\p{L}\p{N}]/u.test(ch)) literals += 1;
      const yo = ch === 'е' || ch === 'ё' || ch === 'Е' || ch === 'Ё';
      if (yo) {
        if (!caseSensitive || ch === 'е' || ch === 'ё') body += '[её]';
        else body += '[ЕЁ]';
      } else {
        body += wsEscapeRegex(ch);
      }
    }
    if (!literals || wildcards > 2) return null;
    const prefix = wholeWord ? '(?<![\\p{L}\\p{N}_])' : '';
    const suffix = wholeWord ? '(?![\\p{L}\\p{N}_])' : '';
    return prefix + body + suffix;
  }

  function formsForAtom(atom, options) {
    const value = atom.value;
    if (!value) return [];
    if (atom.quoted || !options.useMorphology) {
      const forms = [value];
      if (!options.caseSensitive) {
        forms.push(value.toLowerCase(), value.toUpperCase());
        const lower = value.toLowerCase();
        if (lower) forms.push(lower.charAt(0).toUpperCase() + lower.slice(1));
      }
      return [...new Set(forms)];
    }
    try {
      return [...WSMorphology.expandWord(value, options.morphDepth || 'basic')];
    } catch {
      return [value];
    }
  }

  function needlesForAtom(atom) {
    if (!atom.wildcard) return atom.value ? [atom.value] : [];
    const parts = atom.value.split(/[*?]+/).filter((part) => part.length >= 2);
    if (parts.length) return parts;
    return atom.value.split(/[*?]+/).filter((part) => part.length >= 1);
  }

  function compileAtom(atom, options) {
    const wholeWord = options.matchMode === 'whole' || options.wholeWord;
    const caseSensitive = Boolean(options.caseSensitive);
    const flagsG = caseSensitive ? 'gu' : 'giu';
    const flagsY = caseSensitive ? 'yu' : 'yiu';
    let source = null;
    let needles = [];

    if (atom.wildcard) {
      source = compileWildcardSource(atom.value, wholeWord, caseSensitive);
      if (!source) return null;
      needles = needlesForAtom(atom);
    } else {
      const forms = formsForAtom(atom, options)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length || a.localeCompare(b));
      if (!forms.length) return null;
      source = forms.map((form) => buildTermPattern(form, wholeWord, caseSensitive)).join('|');
      needles = forms;
    }

    try {
      return {
        quoted: Boolean(atom.quoted),
        needles,
        searchRegex: new RegExp(source, flagsG),
        stickyRegex: new RegExp(source, flagsY)
      };
    } catch {
      return null;
    }
  }

  function compilePhrase(atoms, options) {
    const compiled = [];
    for (const atom of atoms) {
      const next = compileAtom(atom, options);
      if (next) compiled.push(next);
    }
    return compiled;
  }

  function compileMatcher(query, options) {
    const parsed = globalThis.WSQueryParser?.parse(query) || { branches: [], truncated: false };
    const branches = [];

    for (const branch of parsed.branches || []) {
      const required = [];
      for (const phrase of branch.required || []) {
        const compiled = compilePhrase(phrase, options);
        if (compiled.length) required.push(compiled);
      }
      if (!required.length) continue;
      const banned = [];
      for (const phrase of branch.banned || []) {
        const compiled = compilePhrase(phrase, options);
        if (compiled.length) banned.push(compiled);
      }
      branches.push({ required, banned });
    }

    if (!branches.length) return null;

    let warning = null;
    if (parsed.truncated) {
      warning = 'Запрос слишком сложный, часть вариантов пропущена';
    }

    return {
      type: 'query',
      branches,
      warning,
      options: {
        caseSensitive: Boolean(options.caseSensitive),
        wholeWord: options.matchMode === 'whole' || options.wholeWord,
        phraseMode: options.phraseMode || 'exact'
      }
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

    const matcher = compileMatcher(trimmed, options);
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

  function gapIsFlexible(prev, next, phraseMode) {
    if (prev?.quoted && next?.quoted) return false;
    return phraseMode === 'flexible';
  }

  function matchAtomAt(text, pos, atom) {
    if (!atom?.stickyRegex) return -1;
    atom.stickyRegex.lastIndex = pos;
    const match = atom.stickyRegex.exec(text);
    if (!match || match.index !== pos || !match[0].length) return -1;
    return pos + match[0].length;
  }

  function findSequenceMatches(text, atoms, phraseMode) {
    if (!atoms.length) return [];
    const matches = [];
    const first = atoms[0].searchRegex;
    first.lastIndex = 0;
    let match;
    while ((match = first.exec(text)) !== null) {
      let pos = match.index + match[0].length;
      let ok = true;
      for (let w = 1; w < atoms.length; w += 1) {
        const next = skipSeparator(text, pos, gapIsFlexible(atoms[w - 1], atoms[w], phraseMode));
        if (next === pos) {
          ok = false;
          break;
        }
        const end = matchAtomAt(text, next, atoms[w]);
        if (end < 0) {
          ok = false;
          break;
        }
        pos = end;
      }
      if (ok && pos > match.index) {
        matches.push({ start: match.index, length: pos - match.index, text: text.slice(match.index, pos) });
        first.lastIndex = pos;
      } else if (match[0].length === 0) {
        first.lastIndex += 1;
      }
    }
    return matches;
  }

  function branchBanned(text, branch, phraseMode) {
    for (const phrase of branch.banned) {
      if (findSequenceMatches(text, phrase, phraseMode).length) return true;
    }
    return false;
  }

  function collapseOverlaps(matches) {
    matches.sort((a, b) => a.start - b.start || b.length - a.length);
    const picked = [];
    let end = -1;
    for (const match of matches) {
      if (match.start < end) continue;
      picked.push(match);
      end = match.start + match.length;
    }
    return picked;
  }

  function segmentMightMatch(text, matcher) {
    const hay = foldYo(text).toLowerCase();
    for (const branch of matcher.branches) {
      let ok = true;
      for (const phrase of branch.required) {
        const needles = phrase.flatMap((atom) => atom.needles || []);
        if (!needles.length) continue;
        if (!needles.some((needle) => hay.includes(foldYo(needle).toLowerCase()))) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  function findCompiledMatches(text, matcher) {
    if (!text || !matcher?.branches?.length) return [];
    const phraseMode = matcher.options?.phraseMode || 'exact';
    const all = [];
    for (const branch of matcher.branches) {
      if (branchBanned(text, branch, phraseMode)) continue;
      const lists = branch.required.map((phrase) => findSequenceMatches(text, phrase, phraseMode));
      if (lists.some((list) => !list.length)) continue;
      for (const list of lists) all.push(...list);
    }
    return collapseOverlaps(all);
  }

  function nodeSlice(piece, segLo, segHi) {
    const localStart = segLo - piece.start;
    const localEnd = segHi - piece.start;
    if (piece.map) {
      const nodeStart = piece.map[localStart];
      const nodeEnd = piece.map[localEnd - 1] + 1;
      return {
        start: nodeStart,
        length: nodeEnd - nodeStart,
        text: piece.node.nodeValue.slice(nodeStart, nodeEnd)
      };
    }
    return {
      start: localStart,
      length: localEnd - localStart,
      text: piece.node.nodeValue.slice(localStart, localEnd)
    };
  }

  function locateMatchPieces(segment, match) {
    const end = match.start + match.length;
    const parts = [];
    for (const piece of segment.pieces) {
      if (!piece.node) continue;
      const lo = Math.max(piece.start, match.start);
      const hi = Math.min(piece.end, end);
      if (hi <= lo) continue;
      const slice = nodeSlice(piece, lo, hi);
      if (!slice.text || !slice.text.trim()) continue;
      parts.push({ node: piece.node, ...slice });
    }
    return parts;
  }

  function applyRangesToTextNode(textNode, ranges, doc) {
    const text = textNode.nodeValue || '';
    const parent = textNode.parentNode;
    if (!parent || !ranges.length) return [];

    const ordered = [...ranges].sort((a, b) => a.start - b.start || b.length - a.length);
    const frag = doc.createDocumentFragment();
    const marks = [];
    let last = 0;

    for (const range of ordered) {
      const start = Math.max(0, range.start);
      const end = Math.min(text.length, range.start + range.length);
      if (start < last || end <= start) continue;
      if (start > last) {
        frag.appendChild(doc.createTextNode(text.slice(last, start)));
      }
      const mark = doc.createElement('mark');
      mark.className = MARK_CLASS;
      mark.setAttribute('data-ws-group', range.groupId);
      if (range.primary) {
        mark.setAttribute('data-ws-primary', '1');
        mark.setAttribute('data-ws-mark-id', range.groupId);
      }
      mark.textContent = text.slice(start, end);
      frag.appendChild(mark);
      marks.push(mark);
      last = end;
    }

    if (last < text.length) {
      frag.appendChild(doc.createTextNode(text.slice(last)));
    }

    parent.replaceChild(frag, textNode);
    return marks;
  }

  function highlightSegmentMatches(segment, found, doc) {
    const perNode = new Map();
    for (const match of found) {
      const parts = locateMatchPieces(segment, match);
      if (!parts.length) continue;
      const groupId = String(++markIdCounter);
      parts.forEach((part, index) => {
        let list = perNode.get(part.node);
        if (!list) {
          list = [];
          perNode.set(part.node, list);
        }
        list.push({
          start: part.start,
          length: part.length,
          text: part.text,
          groupId,
          primary: index === 0
        });
      });
      match.groupId = groupId;
    }

    const primaryByGroup = new Map();
    for (const [node, ranges] of perNode) {
      for (const mark of applyRangesToTextNode(node, ranges, doc)) {
        if (mark.getAttribute('data-ws-primary') === '1') {
          primaryByGroup.set(mark.getAttribute('data-ws-group'), mark);
        }
      }
    }

    const ordered = [];
    for (const match of found) {
      const mark = match.groupId ? primaryByGroup.get(match.groupId) : null;
      if (mark) ordered.push(mark);
    }
    return ordered;
  }

  function appendSegmentText(segment, node, value, preserveSpace, pending) {
    if (!value) return pending;
    if (!preserveSpace && !value.trim()) {
      return true;
    }

    let chunk = '';
    const map = [];
    let needsMap = false;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === '\u00ad' || ch === '\u200b' || ch === '\u200c' || ch === '\u200d' || ch === '\ufeff') {
        needsMap = true;
        continue;
      }
      chunk += ch;
      map.push(i);
    }
    if (!chunk) return pending;

    if (!preserveSpace && pending && segment.text && !/\s$/u.test(segment.text) && !/^\s/u.test(chunk)) {
      segment.text += ' ';
    }
    const start = segment.text.length;
    segment.text += chunk;
    const piece = { node, start, end: start + chunk.length };
    if (needsMap) piece.map = map;
    segment.pieces.push(piece);
    return false;
  }

  function collectSearchSegments(root, config) {
    const segments = [];
    if (!root) return segments;
    let current = null;
    let pendingSpace = false;

    function flush() {
      if (current?.text?.trim()) segments.push(current);
      current = null;
      pendingSpace = false;
    }

    function ensure() {
      if (!current) current = { text: '', pieces: [] };
      return current;
    }

    function walk(node, preserveSpace) {
      if (!node) return;
      if (node.nodeType === 3) {
        if (WSDomUtils.isExcludedNode(node, config)) return;
        pendingSpace = appendSegmentText(ensure(), node, node.nodeValue || '', preserveSpace, pendingSpace);
        return;
      }
      if (node.nodeType !== 1 && node.nodeType !== 11) return;
      if (node.nodeType === 1 && WSDomUtils.isExcludedNode(node, config)) return;

      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (tag === 'template' || tag === 'iframe' || tag === 'object' || node.hidden) return;
      if (tag === 'br' || tag === 'hr') {
        flush();
        return;
      }

      const preserve = preserveSpace || tag === 'pre';
      const blocked = BLOCK_TAGS.has(tag) && node !== root;
      if (blocked) flush();
      for (const child of node.childNodes || []) walk(child, preserve);
      if (blocked) flush();
    }

    walk(root, false);
    flush();
    return segments;
  }

  function searchRoots(roots, matcher, settings) {
    const excludeConfig = getExcludeConfig(settings);
    const matches = [];

    for (const root of roots) {
      const doc = root?.ownerDocument || document;
      const segments = collectSearchSegments(root, excludeConfig);
      for (const segment of segments) {
        if (!segmentMightMatch(segment.text, matcher)) continue;
        const found = findCompiledMatches(segment.text, matcher);
        if (!found.length) continue;
        matches.push(...highlightSegmentMatches(segment, found, doc));
      }
    }

    return matches;
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

  async function searchFull(query, options, settings, rootOverride = null) {
    clearHighlights();
    applyHighlightColors(settings);

    const matcher = await buildMatcher(query, { ...options, morphDepth: settings.morphDepth });
    if (!matcher) {
      return { matches: [], total: 0, currentIndex: -1, warning: null };
    }

    const roots = rootOverride
      ? [rootOverride]
      : collectRoots(settings).map((r) => r.root);
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

  function groupMarks(mark) {
    if (!mark?.getAttribute) return mark ? [mark] : [];
    const group = mark.getAttribute('data-ws-group');
    const root = typeof mark.getRootNode === 'function' ? mark.getRootNode() : document;
    if (!group || !root?.querySelectorAll) return [mark];
    const list = root.querySelectorAll(`mark.${MARK_CLASS}[data-ws-group="${group}"]`);
    return list.length ? [...list] : [mark];
  }

  function setCurrentMatch(matches, index, { scroll = false } = {}) {
    const roots = new Set();
    for (const mark of matches) {
      const root = mark?.getRootNode?.() || document;
      if (root) roots.add(root);
    }
    for (const root of roots) {
      root.querySelectorAll?.(`mark.${MARK_CLASS}.${CURRENT_CLASS}`)?.forEach((el) => {
        el.classList.remove(CURRENT_CLASS);
      });
    }

    if (supportsHighlightApi && highlightRanges.length) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...highlightRanges));
      CSS.highlights.delete(CURRENT_HIGHLIGHT_NAME);
      currentHighlightRange = null;
    }

    if (index < 0 || index >= matches.length) return -1;

    const current = matches[index];
    if (!current?.isConnected && !current?._wsRange) return -1;

    for (const mark of groupMarks(current)) {
      mark.classList?.add(CURRENT_CLASS);
    }

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
    findPhraseMatchesInText,
    compileMatcher,
    findCompiledMatches,
    collectSearchSegments,
    locateMatchPieces
  };
})();
