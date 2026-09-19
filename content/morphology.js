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
    { pattern: /(ия)$/i, strip: 0, replace: (w) => w.replace(/ия$/i, 'и') },
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

  function addCaseVariants(target, form) {
    if (!form) return;
    target.add(form);
    const lower = form.toLowerCase();
    target.add(lower);
    target.add(form.toUpperCase());
    if (lower.length) {
      target.add(lower.charAt(0).toUpperCase() + lower.slice(1));
    }
  }

  const INFLECTION_ENDINGS = [
    '', 'а', 'я', 'у', 'ю', 'е', 'о', 'и', 'ы',
    'ой', 'ей', 'ом', 'ем', 'ём', 'ам', 'ям',
    'ов', 'ев', 'ёв', 'ах', 'ях', 'ами', 'ями',
    'ью', 'ия', 'ии', 'ий', 'ья', 'ье'
  ];

  function generateRuleBasedForms(word) {
    const forms = new Set();
    const stems = generateLemmaCandidates(word);
    stems.add(normalize(word));
    for (const stem of stems) {
      if (!stem || stem.length < 2) continue;
      for (const ending of INFLECTION_ENDINGS) {
        forms.add(stem + ending);
      }
    }
    return forms;
  }

  function fallbackForms(word, depth) {
    const forms = new Set();
    addCaseVariants(forms, word);

    const directLemma = findLemma(word);
    if (directLemma && dict?.[directLemma]) {
      for (const f of getLemmaForms(directLemma, depth)) {
        forms.add(f);
      }
      return forms;
    }

    let foundInDict = false;
    for (const candidate of generateLemmaCandidates(word)) {
      const lemma = findLemma(candidate);
      if (lemma && dict?.[lemma]) {
        foundInDict = true;
        for (const f of getLemmaForms(lemma, depth)) {
          forms.add(f);
        }
      }
    }

    if (!foundInDict) {
      for (const f of generateRuleBasedForms(word)) {
        forms.add(f);
      }
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

    const withCase = new Set();
    for (const form of forms) {
      addCaseVariants(withCase, form);
    }
    addCaseVariants(withCase, word);
    return withCase;
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
        addCaseVariants(set, trimmed);
      }
      return set;
    }

    return expandWord(trimmed, morphDepth);
  }

  function shouldUseMorphology(options = {}) {
    return Boolean(options.useMorphology || options.phraseMode === 'morph');
  }

  function getPhraseWordFormSets(words, options = {}) {
    const useMorphology = shouldUseMorphology(options);
    const morphDepth = options.morphDepth || 'basic';
    const caseSensitive = options.caseSensitive !== false;

    return words.map((word) => {
      if (useMorphology) {
        return expandWord(word, morphDepth);
      }
      const set = new Set([word]);
      if (!caseSensitive) {
        addCaseVariants(set, word);
      }
      return set;
    });
  }

  return {
    loadDictionary,
    expandQuery,
    expandWord,
    generateLemmaCandidates,
    getPhraseWordFormSets,
    shouldUseMorphology,
    normalize
  };
})();
