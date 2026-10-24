/** Author, publication date and site from meta tags and schema.org JSON-LD. */
globalThis.WSPageMeta = globalThis.WSPageMeta ?? (() => {
  const AUTHOR_KEYS = new Set([
    'author',
    'article:author',
    'og:article:author',
    'parsely-author',
    'dc:creator',
    'dcterm:creator',
    'citation_author',
    'citation_authors'
  ]);

  const DATE_PRIORITY = [
    'article:published_time',
    'article:published',
    'og:published_time',
    'citation_publication_date',
    'citation_date',
    'parsely-pub-date',
    'dc:date',
    'dcterm:created',
    'dcterm:date',
    'pubdate',
    'publish_date',
    'citation_online_date',
    'date'
  ];
  const DATE_KEYS = new Set(DATE_PRIORITY);

  const SITE_KEYS = new Set([
    'og:site_name',
    'application-name',
    'citation_journal_title'
  ]);

  const TITLE_KEYS = new Set([
    'og:title',
    'dc:title',
    'dcterm:title',
    'twitter:title',
    'parsely-title',
    'citation_title'
  ]);

  const DESC_KEYS = new Set([
    'description',
    'og:description',
    'dc:description',
    'dcterm:description',
    'twitter:description'
  ]);

  const ARTICLE_TYPE = /Article|BlogPosting|NewsArticle|ScholarlyArticle|Report|WebPage|Recipe|Review|TechArticle|Chapter|MedicalWebPage/i;

  function isUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function cleanPersonName(value) {
    let name = String(value || '').replace(/\s+/g, ' ').trim();
    name = name.replace(/^(?:by|автор|written by|posted by)\s*[:\-]?\s+/i, '');
    name = name.replace(/\s*[|•·]\s*(?:\d+\s*(?:min|мин|minute).*|updated.*|обновлено.*)$/i, '').trim();
    if (!name || name.length > 180 || isUrl(name)) return '';
    return name;
  }

  function metaKey(element) {
    const raw = element.getAttribute('property') || element.getAttribute('name') || '';
    return raw.toLowerCase().replace(/\s/g, '').replace(/\./g, ':');
  }

  function readMeta(doc) {
    const authors = [];
    const dates = new Map();
    let site = '';
    let title = '';
    let description = '';

    doc.querySelectorAll('meta').forEach((element) => {
      const key = metaKey(element);
      const content = String(element.getAttribute('content') || '').trim();
      if (!key || !content) return;

      if (AUTHOR_KEYS.has(key) && !isUrl(content)) {
        authors.push(content);
        return;
      }
      if (DATE_KEYS.has(key)) {
        if (!dates.has(key)) dates.set(key, content);
        return;
      }
      if (!site && SITE_KEYS.has(key)) site = content;
      else if (!title && TITLE_KEYS.has(key)) title = content;
      else if (!description && DESC_KEYS.has(key)) description = content;
    });

    const published = DATE_PRIORITY.map((key) => dates.get(key)).find(Boolean) || '';
    return { authors, published, site, title, description };
  }

  function collectNames(value, out, depth) {
    if (value == null || depth > 5 || out.length >= 12) return;

    if (typeof value === 'string') {
      const name = cleanPersonName(value);
      if (name) out.push(name);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collectNames(item, out, depth + 1));
      return;
    }

    if (typeof value !== 'object') return;

    if (typeof value.givenName === 'string' || typeof value.familyName === 'string') {
      const combined = [value.givenName, value.familyName].filter(Boolean).join(' ');
      const name = cleanPersonName(combined);
      if (name) out.push(name);
      return;
    }

    if (value.name != null) {
      collectNames(value.name, out, depth + 1);
    }
  }

  function flattenNodes(data, out) {
    if (!data) return;
    if (Array.isArray(data)) {
      data.forEach((item) => flattenNodes(item, out));
      return;
    }
    if (typeof data !== 'object') return;
    if (data['@graph']) flattenNodes(data['@graph'], out);
    if (data['@type'] || data.author || data.creator || data.datePublished || data.headline) {
      out.push(data);
    }
  }

  function typeText(node) {
    const value = node['@type'];
    if (Array.isArray(value)) return value.join(' ');
    return String(value || '');
  }

  function nodeScore(node) {
    let score = 0;
    if (ARTICLE_TYPE.test(typeText(node))) score += 5;
    if (node.headline || node.name) score += 1;
    if (node.author || node.creator) score += 2;
    if (node.datePublished) score += 2;
    if (/^WebSite$/i.test(typeText(node))) score -= 4;
    return score;
  }

  function textValue(value) {
    if (typeof value === 'string') return value.trim();
    if (value && typeof value.name === 'string') return value.name.trim();
    return '';
  }

  function readSchema(doc) {
    const nodes = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      const text = String(script.textContent || '').trim();
      if (!text || text.length > 200000) return;
      try {
        flattenNodes(JSON.parse(text), nodes);
      } catch {
        /* ignore broken JSON-LD */
      }
    });

    if (!nodes.length) return {};

    const best = nodes.slice().sort((a, b) => nodeScore(b) - nodeScore(a))[0];
    const authors = [];
    collectNames(best.author || best.creator, authors, 0);

    let site = textValue(best.publisher) || textValue(best.sourceOrganization) || textValue(best.isPartOf);
    if (!site) {
      const website = nodes.find((node) => /^WebSite$/i.test(typeText(node)) && textValue(node.name));
      if (website) site = textValue(website.name);
    }

    return {
      authors,
      published: typeof best.datePublished === 'string' ? best.datePublished.trim() : '',
      site,
      title: (typeof best.headline === 'string' && best.headline.trim())
        || (typeof best.name === 'string' && !/^WebSite$/i.test(typeText(best)) ? best.name.trim() : ''),
      description: typeof best.description === 'string' ? best.description.trim() : ''
    };
  }

  function dedupe(names) {
    const seen = new Set();
    const result = [];
    names.forEach((name) => {
      const cleaned = cleanPersonName(name);
      const key = cleaned.toLowerCase();
      if (!cleaned || seen.has(key)) return;
      seen.add(key);
      result.push(cleaned);
    });
    return result;
  }

  function extract(doc) {
    const meta = readMeta(doc);
    const schema = readSchema(doc);
    const site = String(schema.site || meta.site || '').replace(/\s+/g, ' ').trim();
    let authors = dedupe(schema.authors?.length ? schema.authors : meta.authors);
    if (site && authors.length === 1 && authors[0].toLowerCase() === site.toLowerCase()) {
      authors = [];
    }

    return {
      author: authors.join(', '),
      authors,
      published: schema.published || meta.published || '',
      site,
      title: String(schema.title || meta.title || doc.title || '').trim(),
      description: String(schema.description || meta.description || '').trim()
    };
  }

  return {
    extract,
    cleanPersonName
  };
})();

var WSPageMeta = globalThis.WSPageMeta;
