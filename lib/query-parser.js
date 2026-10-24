/**
 * On-page query language.
 *
 *   words        phrase, in order
 *   a | b        either branch
 *   a & b        both branches in the same block
 *   "exact"      literal words, no wildcards
 *   -word        drop the block when this phrase is present
 *   (a | b) c    grouping
 *   * and ?      wildcard inside an unquoted word
 */
globalThis.WSQueryParser = (() => {
  const MAX_BRANCHES = 32;

  function isTermChar(ch) {
    if (!ch || /\s/u.test(ch)) return false;
    return !'|&()"«»'.includes(ch);
  }

  function tokenize(input) {
    const src = String(input || '');
    const tokens = [];
    let i = 0;

    while (i < src.length) {
      const ch = src[i];
      if (/\s/u.test(ch)) {
        i += 1;
        continue;
      }
      if (ch === '|') {
        tokens.push({ type: 'or' });
        i += 1;
        continue;
      }
      if (ch === '&') {
        tokens.push({ type: 'and' });
        i += 1;
        continue;
      }
      if (ch === '(') {
        tokens.push({ type: 'lp' });
        i += 1;
        continue;
      }
      if (ch === ')') {
        tokens.push({ type: 'rp' });
        i += 1;
        continue;
      }
      if (ch === '"' || ch === '«') {
        const end = ch === '«' ? '»' : '"';
        i += 1;
        let value = '';
        while (i < src.length && src[i] !== end) {
          value += src[i];
          i += 1;
        }
        if (src[i] === end) i += 1;
        tokens.push({ type: 'term', value: value.trim(), quoted: true });
        continue;
      }
      if (ch === '-') {
        const next = src[i + 1];
        if (!next || /\s/u.test(next) || next === '"' || next === '«' || next === '(' || isTermChar(next)) {
          tokens.push({ type: 'not' });
          i += 1;
          continue;
        }
      }

      let value = '';
      while (i < src.length && isTermChar(src[i])) {
        value += src[i];
        i += 1;
      }
      if (value) tokens.push({ type: 'term', value, quoted: false });
      else i += 1;
    }

    return tokens;
  }

  function termAtoms(value, quoted) {
    const clean = String(value || '').trim();
    if (!clean) return [];
    if (quoted) {
      return clean.split(/\s+/).filter(Boolean).map((word) => ({
        value: word,
        quoted: true,
        wildcard: false
      }));
    }
    return [{
      value: clean,
      quoted: false,
      wildcard: /[*?]/.test(clean)
    }];
  }

  function parse(input) {
    const tokens = tokenize(input);
    let index = 0;
    let truncated = false;

    function peek() {
      return tokens[index] || null;
    }

    function eat() {
      return tokens[index++] || null;
    }

    function parseExpr() {
      const ands = [];
      const first = parseAnd();
      if (first) ands.push(first);
      while (peek()?.type === 'or') {
        eat();
        const next = parseAnd();
        if (next) ands.push(next);
      }
      return ands;
    }

    function parseAnd() {
      const sequences = [];
      while (peek() && peek().type !== 'or' && peek().type !== 'rp') {
        if (peek().type === 'and') {
          eat();
          continue;
        }
        const seq = parseSeq();
        if (seq.length) sequences.push(seq);
        else break;
      }
      return sequences.length ? sequences : null;
    }

    function parseSeq() {
      const atoms = [];
      while (peek() && !['or', 'and', 'rp'].includes(peek().type)) {
        const atom = parseAtom();
        if (!atom) break;
        atoms.push(atom);
      }
      return atoms;
    }

    function parseAtom() {
      if (!peek()) return null;
      if (peek().type === 'not') {
        eat();
        const inner = parseAtom();
        if (!inner) return null;
        inner.negative = true;
        return inner;
      }
      if (peek().type === 'lp') {
        eat();
        const expr = parseExpr();
        if (peek()?.type === 'rp') eat();
        if (!expr.length) return null;
        return { type: 'group', expr, negative: false };
      }
      if (peek().type === 'term') {
        const tok = eat();
        if (!tok.value) return null;
        return { type: 'term', value: tok.value, quoted: Boolean(tok.quoted), negative: false };
      }
      eat();
      return null;
    }

    function cut(list) {
      if (list.length > MAX_BRANCHES) {
        truncated = true;
        return list.slice(0, MAX_BRANCHES);
      }
      return list;
    }

    function finalize(list) {
      return cut(list.map((branch) => ({
        required: (branch.required || []).filter((phrase) => phrase.length),
        banned: (branch.banned || []).filter((phrase) => phrase.length)
      })).filter((branch) => branch.required.length));
    }

    function negativePhrases(atom) {
      if (!atom) return [];
      if (atom.type === 'term') {
        const phrase = termAtoms(atom.value, atom.quoted);
        return phrase.length ? [phrase] : [];
      }
      const phrases = [];
      for (const branch of expandExpr(atom.expr || [])) {
        for (const phrase of branch.required) {
          if (phrase.length) phrases.push(phrase);
        }
      }
      return phrases;
    }

    function positiveChoices(atom) {
      if (!atom) return [];
      if (atom.type === 'term') {
        const phrase = termAtoms(atom.value, atom.quoted);
        if (!phrase.length) return [];
        return [{ required: [phrase], banned: [] }];
      }
      return expandExpr(atom.expr || []);
    }

    function expandSequence(atoms) {
      let acc = [{ required: [[]], banned: [] }];
      for (const atom of atoms) {
        if (atom.negative) {
          const bans = negativePhrases(atom);
          for (const item of acc) item.banned.push(...bans);
          continue;
        }

        const choices = positiveChoices(atom);
        if (!choices.length) continue;
        const next = [];
        for (const left of acc) {
          for (const choice of choices) {
            const required = left.required.map((phrase) => phrase.slice());
            const open = required.pop() || [];
            const phrases = choice.required || [];
            if (phrases.length <= 1) {
              required.push(open.concat(phrases[0] || []));
            } else if (open.length) {
              required.push(open);
              for (const phrase of phrases) required.push(phrase.slice());
              required.push([]);
            } else {
              for (const phrase of phrases) required.push(phrase.slice());
              required.push([]);
            }
            next.push({
              required,
              banned: left.banned.concat(choice.banned || [])
            });
            if (next.length >= MAX_BRANCHES) break;
          }
          if (next.length >= MAX_BRANCHES) break;
        }
        if (next.length >= MAX_BRANCHES) truncated = true;
        if (next.length) acc = next;
      }
      return finalize(acc);
    }

    function expandAnd(sequences) {
      let acc = [{ required: [], banned: [] }];
      for (const seq of sequences) {
        const alts = expandSequence(seq);
        if (!alts.length) continue;
        const next = [];
        for (const left of acc) {
          for (const alt of alts) {
            next.push({
              required: left.required.concat(alt.required),
              banned: left.banned.concat(alt.banned)
            });
            if (next.length >= MAX_BRANCHES) break;
          }
          if (next.length >= MAX_BRANCHES) break;
        }
        if (next.length >= MAX_BRANCHES) truncated = true;
        if (next.length) acc = next;
      }
      return finalize(acc);
    }

    function expandExpr(ands) {
      const out = [];
      for (const sequences of ands) {
        out.push(...expandAnd(sequences));
        if (out.length >= MAX_BRANCHES) {
          truncated = true;
          break;
        }
      }
      return cut(out);
    }

    const branches = expandExpr(parseExpr());
    return { branches, truncated };
  }

  return { parse, tokenize };
})();
