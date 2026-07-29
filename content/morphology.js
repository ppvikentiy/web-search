/**
 * Russian morphology: offline dictionary + rule-based stemming fallback.
 */
globalThis.WSMorphology = (() => {
  let dict = null;
  let formToLemma = null;
  let loadPromise = null;

  const STEM_RULES = [
    { pattern: /(овать|ировать)$/i, strip: 0, replace: (w) => w.replace(/(овать|ировать)$/i, '') },
    { pattern: /(ение|ание|ство|ость)$/i, strip: 0, replace: (w) => w.replace(/(ение|ание|ство|ость)$/i, '') },
    { pattern: /(ия)$/i, strip: 0, replace: (w) => w.replace(/ия$/i, 'ия') },
    { pattern: /(ский|цкий|ческий)$/i, strip: 0, replace: (w) => w.replace(/(ский|цкий|ческий)$/i, '') + 'ий' },
    { pattern: /(ая|яя|ое|ее|ые|ие|ой|ий|ый)$/i, strip: 0, replace: (w) => w.replace(/(ая|яя|ое|ее|ые|ие|ой|ий|ый)$/i, '') },
    { pattern: /(ами|ями|ах|ях|ов|ев|ей|ом|ем|ам|ям|у|ю|а|я|е|и|ы|о)$/i, strip: 0, replace: (w) => w.replace(/(ами|ями|ах|ях|ов|ев|ей|ом|ем|ам|ям|у|ю|а|я|е|и|ы|о)$/i, '') }
  ];

  function normalize(word) {
    return word.toLowerCase().replace(/ё/g, 'е');
  }

  function buildReverseIndex(data) {
    const reverse = new Map();
    for (const [lemma, entry] of Object.entries(data)) {
      const allForms = new Set([
        lemma,
        ...(entry.basic || []),
        ...(entry.extended || [])
      ]);
      for (const form of allForms) {
        const key = normalize(form);
        if (!reverse.has(key)) {
          reverse.set(key, lemma);
        }
      }
    }
    return reverse;
  }

  async function loadDictionary() {
    if (dict) return dict;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      if (!chrome.runtime?.id) {
        throw new Error('Extension context invalidated');
      }
      const url = chrome.runtime.getURL('content/morphology-dict.json');
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load morphology dict: ${response.status}`);
      }
      dict = await response.json();
      formToLemma = buildReverseIndex(dict);
      return dict;
    })().catch((err) => {
      loadPromise = null;
      console.error('[web-search] morphology dict load failed:', err);
      dict = {};
      formToLemma = new Map();
      return dict;
    });

    return loadPromise;
  }

  function findLemma(word) {
    const key = normalize(word);
    if (formToLemma?.has(key)) {
      return formToLemma.get(key);
    }
    if (dict?.[key]) {
      return key;
    }
    return null;
  }

  function getLemmaForms(lemma, depth) {
    const entry = dict?.[lemma];
    if (!entry) return new Set([lemma]);

    const forms = new Set([lemma, ...(entry.basic || [])]);
    if (depth === 'extended') {
      for (const f of entry.extended || []) {
        forms.add(f);
      }
    }
    return forms;
  }

  function generateLemmaCandidates(word) {
    const base = normalize(word);
    const candidates = new Set([base]);

    for (const rule of STEM_RULES) {
      if (!rule.pattern.test(base)) continue;

      if (rule.replace) {
        const candidate = rule.replace(base);
        if (candidate && candidate.length >= 2) {
          candidates.add(candidate);
        }
      } else if (rule.strip > 0 && base.length > rule.strip + 2) {
        candidates.add(base.slice(0, -rule.strip));
      }
    }

    if (base.endsWith('ь')) {
      candidates.add(base.slice(0, -1));
    }
    if (base.endsWith('й')) {
      candidates.add(base.slice(0, -1));
    }

    return candidates;
  }

  function fallbackForms(word, depth) {
    const forms = new Set([word, word.toLowerCase()]);

    const directLemma = findLemma(word);
    if (directLemma && dict?.[directLemma]) {
      for (const f of getLemmaForms(directLemma, depth)) {
        forms.add(f);
      }
      return forms;
    }

    for (const candidate of generateLemmaCandidates(word)) {
      const lemma = findLemma(candidate);
      if (lemma && dict?.[lemma]) {
        for (const f of getLemmaForms(lemma, depth)) {
          forms.add(f);
        }
      }
    }

    forms.add(word);
    forms.add(word.toLowerCase());
    if (word !== word.toLowerCase()) {
      forms.add(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    }

    return forms;
  }

  function expandWord(word, depth) {
    const lemma = findLemma(word);
    let forms;

    if (lemma && dict?.[lemma]) {
      forms = getLemmaForms(lemma, depth);
    } else {
      forms = fallbackForms(word, depth);
    }

    forms.add(word);
    forms.add(word.toLowerCase());
    if (word !== word.toLowerCase()) {
      forms.add(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    }

    return forms;
  }

  function expandQuery(query, options = {}) {
    const { useMorphology = false, morphDepth = 'basic', caseSensitive = true } = options;
    const trimmed = query.trim();
    if (!trimmed) return new Set();

    if (wsIsPhrase(trimmed)) {
      return new Set([trimmed]);
    }

    if (!useMorphology) {
      const set = new Set([trimmed]);
      if (!caseSensitive) {
        set.add(trimmed.toLowerCase());
        set.add(trimmed.toUpperCase());
        set.add(trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase());
      }
      return set;
    }

    const allForms = new Set();
    for (const form of expandWord(trimmed, morphDepth)) {
      allForms.add(form);
      if (!caseSensitive) {
        allForms.add(form.toLowerCase());
        allForms.add(form.toUpperCase());
        allForms.add(form.charAt(0).toUpperCase() + form.slice(1).toLowerCase());
      }
    }

    return allForms;
  }

  const MAX_PHRASE_COMBINATIONS = 2000;

  function shouldUseMorphology(options = {}) {
    return Boolean(options.useMorphology || options.phraseMode === 'morph');
  }

  function expandPhraseWords(words, options) {
    const { useMorphology = false, morphDepth = 'basic' } = options;
    const perWord = words.map((word) => {
      if (!useMorphology) {
        return [word];
      }
      return [...expandWord(word, morphDepth)];
    });

    let total = 1;
    for (const list of perWord) {
      total *= list.length;
      if (total > MAX_PHRASE_COMBINATIONS) {
        return null;
      }
    }

    const combinations = [];
    function combine(index, current) {
      if (index === perWord.length) {
        combinations.push([...current]);
        return;
      }
      for (const form of perWord[index]) {
        current.push(form);
        combine(index + 1, current);
        current.pop();
        if (combinations.length >= MAX_PHRASE_COMBINATIONS) return;
      }
    }
    combine(0, []);
    return combinations;
  }

  function getPhraseWordFormSets(words, options = {}) {
    const useMorphology = shouldUseMorphology(options);
    const morphDepth = options.morphDepth || 'basic';
    const caseSensitive = options.caseSensitive !== false;

    return words.map((word) => {
      const forms = useMorphology ? expandWord(word, morphDepth) : new Set([word]);
      const set = new Set(forms);
      if (!caseSensitive) {
        for (const form of forms) {
          set.add(form.toLowerCase());
          set.add(form.toUpperCase());
          set.add(form.charAt(0).toUpperCase() + form.slice(1).toLowerCase());
        }
      }
      return set;
    });
  }

  return {
    loadDictionary,
    expandQuery,
    expandWord,
    expandPhraseWords,
    getPhraseWordFormSets,
    shouldUseMorphology,
    normalize,
    MAX_PHRASE_COMBINATIONS
  };
})();
