/**
 * Word boundary helpers for Cyrillic and Latin text.
 */
(() => {
  if (globalThis.__wsWordBoundaryLoaded) return;
  globalThis.__wsWordBoundaryLoaded = true;

  const WS_WORD_CHAR = /[\p{L}\p{N}_]/u;

  function wsIsWordChar(ch) {
    if (!ch) return false;
    return WS_WORD_CHAR.test(ch);
  }

  function wsIsWordBoundary(text, index) {
    const before = index > 0 ? text[index - 1] : '';
    const after = index < text.length ? text[index] : '';
    const left = wsIsWordChar(before);
    const right = wsIsWordChar(after);
    return !left || !right ? left !== right || (!left && !right) : false;
  }

  function wsIsWholeWordMatch(text, start, length) {
    const beforeOk = start === 0 || !wsIsWordChar(text[start - 1]);
    const end = start + length;
    const afterOk = end >= text.length || !wsIsWordChar(text[end]);
    return beforeOk && afterOk;
  }

  function wsEscapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function wsBuildWholeWordPattern(term) {
    const escaped = wsEscapeRegex(term);
    const prefix = '(?<![\\p{L}\\p{N}_])';
    const suffix = '(?![\\p{L}\\p{N}_])';
    return prefix + escaped + suffix;
  }

  function wsBuildSubstringPattern(term) {
    return wsEscapeRegex(term);
  }

  function wsSplitWords(text) {
    return text.trim().split(/\s+/).filter(Boolean);
  }

  function wsIsPhrase(text) {
    return /\s/.test(text.trim());
  }

  globalThis.wsIsWordChar = wsIsWordChar;
  globalThis.wsIsWordBoundary = wsIsWordBoundary;
  globalThis.wsIsWholeWordMatch = wsIsWholeWordMatch;
  globalThis.wsEscapeRegex = wsEscapeRegex;
  globalThis.wsBuildWholeWordPattern = wsBuildWholeWordPattern;
  globalThis.wsBuildSubstringPattern = wsBuildSubstringPattern;
  globalThis.wsSplitWords = wsSplitWords;
  globalThis.wsIsPhrase = wsIsPhrase;
})();
