/**
 * User dictionary: local storage CRUD, folders, tags, import/export, morphology-aware lookup.
 */
globalThis.WSUserDictionary = (() => {
  const STORAGE_KEY = 'userDictionary';
  const DEFAULT_GROUP_ID = 'default';
  const SCHEMA_VERSION = 2;

  let groups = [];
  let entries = [];
  let loadPromise = null;

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `dict-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function defaultGroup() {
    return { id: DEFAULT_GROUP_ID, name: 'Общие', order: 0 };
  }

  function normalizeWordKey(word) {
    return String(word).toLocaleLowerCase('ru').replace(/ё/g, 'е');
  }

  function normalizeTags(raw) {
    const items = Array.isArray(raw)
      ? raw
      : typeof raw === 'string'
        ? raw.split(/[,;\n]+/)
        : [];

    const seen = new Set();
    const tags = [];

    for (const item of items) {
      const trimmed = String(item).trim().toLowerCase();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      tags.push(trimmed);
    }

    return tags;
  }

  function normalizeForms(rawForms, mainWord) {
    const seen = new Set([normalizeWordKey(mainWord)]);
    const forms = [];

    const items = Array.isArray(rawForms)
      ? rawForms
      : typeof rawForms === 'string'
        ? rawForms.split(/[,;\n]+/)
        : [];

    for (const item of items) {
      const trimmed = String(item).trim();
      if (!trimmed || /\s/.test(trimmed)) continue;
      const key = normalizeWordKey(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      forms.push(trimmed);
    }

    return forms;
  }

  function normalizeGroups(raw) {
    if (!Array.isArray(raw) || !raw.length) {
      return [defaultGroup()];
    }

    const normalized = raw
      .filter((item) => item && typeof item.name === 'string' && item.name.trim())
      .map((item, index) => ({
        id: item.id || generateId(),
        name: item.name.trim(),
        order: Number.isFinite(item.order) ? item.order : index
      }));

    if (!normalized.some((group) => group.id === DEFAULT_GROUP_ID)) {
      normalized.unshift(defaultGroup());
    }

    return normalized.sort((a, b) => a.order - b.order);
  }

  function resolveGroupId(groupId) {
    if (groupId && groups.some((group) => group.id === groupId)) {
      return groupId;
    }
    return DEFAULT_GROUP_ID;
  }

  function normalizeEntries(raw, fallbackGroupId = DEFAULT_GROUP_ID) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item && typeof item.word === 'string' && item.word.trim())
      .map((item) => {
        const word = item.word.trim();
        return {
          id: item.id || generateId(),
          word,
          forms: normalizeForms(item.forms, word),
          description: typeof item.description === 'string' ? item.description : '',
          groupId: resolveGroupId(item.groupId || fallbackGroupId),
          tags: normalizeTags(item.tags)
        };
      });
  }

  function getEntryWords(entry) {
    return [entry.word, ...(entry.forms || [])];
  }

  function findWordConflict(word, excludeId = null) {
    const key = normalizeWordKey(word);
    for (const entry of entries) {
      if (entry.id === excludeId) continue;
      for (const entryWord of getEntryWords(entry)) {
        if (normalizeWordKey(entryWord) === key) return true;
      }
    }
    return false;
  }

  async function findMorphWordConflict(word, excludeId = null) {
    if (!globalThis.WSMorphology?.expandWord) return null;

    await WSMorphology.loadDictionary();
    const key = normalizeWordKey(word);

    for (const entry of entries) {
      if (entry.id === excludeId) continue;
      for (const entryWord of getEntryWords(entry)) {
        for (const form of WSMorphology.expandWord(entryWord, 'basic')) {
          if (normalizeWordKey(form) === key) {
            return entry;
          }
        }
      }
    }

    return null;
  }

  function validateWordAndForms(word, forms, excludeId = null) {
    const trimmed = word.trim();
    if (!trimmed || /\s/.test(trimmed)) {
      throw new Error('Слово не должно быть пустым или содержать пробелы');
    }

    const normalizedForms = normalizeForms(forms, trimmed);

    if (findWordConflict(trimmed, excludeId)) {
      throw new Error('Такое слово уже есть в словаре');
    }

    for (const form of normalizedForms) {
      if (findWordConflict(form, excludeId)) {
        throw new Error(`Форма «${form}» уже есть в словаре`);
      }
    }

    return normalizedForms;
  }

  async function ensureNoConflicts(word, forms, excludeId = null) {
    const trimmed = word.trim();
    const normalizedForms = validateWordAndForms(trimmed, forms, excludeId);

    const morphConflict = await findMorphWordConflict(trimmed, excludeId);
    if (morphConflict) {
      throw new Error(`«${trimmed}» уже есть в словаре как форма слова «${morphConflict.word}»`);
    }

    for (const form of normalizedForms) {
      const formConflict = await findMorphWordConflict(form, excludeId);
      if (formConflict) {
        throw new Error(`Форма «${form}» уже есть в словаре как форма слова «${formConflict.word}»`);
      }
    }

    return normalizedForms;
  }

  async function persist() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        version: SCHEMA_VERSION,
        groups,
        entries
      }
    });
    loadPromise = Promise.resolve({ groups, entries });
    return { groups, entries };
  }

  function migrateV1(rawEntries) {
    groups = [defaultGroup()];
    entries = normalizeEntries(rawEntries, DEFAULT_GROUP_ID);
  }

  function applyStored(raw) {
    if (Array.isArray(raw)) {
      migrateV1(raw);
      return;
    }

    if (raw && raw.version === SCHEMA_VERSION) {
      groups = normalizeGroups(raw.groups);
      entries = normalizeEntries(raw.entries, DEFAULT_GROUP_ID);
      return;
    }

    groups = [defaultGroup()];
    entries = [];
  }

  async function load() {
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      try {
        const stored = await chrome.storage.local.get({ [STORAGE_KEY]: null });
        applyStored(stored[STORAGE_KEY]);
      } catch {
        groups = [defaultGroup()];
        entries = [];
      }
      return { groups, entries };
    })();

    return loadPromise;
  }

  async function reload() {
    loadPromise = null;
    return load();
  }

  async function getGroups() {
    await load();
    return [...groups].sort((a, b) => a.order - b.order);
  }

  async function getGroup(id) {
    await load();
    return groups.find((group) => group.id === id) || null;
  }

  async function getAll(filters = {}) {
    await load();
    let result = [...entries];

    if (filters.groupId) {
      result = result.filter((entry) => entry.groupId === filters.groupId);
    }

    if (filters.tag) {
      const tag = String(filters.tag).trim().toLowerCase();
      result = result.filter((entry) => entry.tags.includes(tag));
    }

    return result;
  }

  async function getAllTags() {
    await load();
    const tagSet = new Set();
    for (const entry of entries) {
      for (const tag of entry.tags) tagSet.add(tag);
    }
    return [...tagSet].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  async function addGroup(name) {
    await load();
    const trimmed = String(name).trim();
    if (!trimmed) throw new Error('Название папки не может быть пустым');

    const duplicate = groups.find((group) => group.name.toLocaleLowerCase('ru') === trimmed.toLocaleLowerCase('ru'));
    if (duplicate) throw new Error('Папка с таким названием уже есть');

    const group = {
      id: generateId(),
      name: trimmed,
      order: groups.length
    };
    groups = [...groups, group];
    await persist();
    return group;
  }

  async function updateGroup(id, name) {
    await load();
    if (id === DEFAULT_GROUP_ID) {
      throw new Error('Нельзя переименовать папку по умолчанию');
    }

    const index = groups.findIndex((group) => group.id === id);
    if (index < 0) throw new Error('Папка не найдена');

    const trimmed = String(name).trim();
    if (!trimmed) throw new Error('Название папки не может быть пустым');

    const duplicate = groups.find(
      (group) => group.id !== id && group.name.toLocaleLowerCase('ru') === trimmed.toLocaleLowerCase('ru')
    );
    if (duplicate) throw new Error('Папка с таким названием уже есть');

    groups = [...groups];
    groups[index] = { ...groups[index], name: trimmed };
    await persist();
    return groups[index];
  }

  async function removeGroup(id, { moveToGroupId = DEFAULT_GROUP_ID } = {}) {
    await load();
    if (id === DEFAULT_GROUP_ID) {
      throw new Error('Нельзя удалить папку по умолчанию');
    }

    const index = groups.findIndex((group) => group.id === id);
    if (index < 0) throw new Error('Папка не найдена');

    const targetGroupId = resolveGroupId(moveToGroupId);
    entries = entries.map((entry) => (
      entry.groupId === id ? { ...entry, groupId: targetGroupId } : entry
    ));
    groups = groups.filter((group) => group.id !== id);
    await persist();
    return true;
  }

  async function add(word, description = '', forms = [], options = {}) {
    await load();
    const trimmed = word.trim();
    const normalizedForms = await ensureNoConflicts(trimmed, forms);

    const entry = {
      id: generateId(),
      word: trimmed,
      forms: normalizedForms,
      description: description.trim(),
      groupId: resolveGroupId(options.groupId),
      tags: normalizeTags(options.tags)
    };
    entries = [...entries, entry];
    await persist();
    return entry;
  }

  async function update(id, word, description = '', forms = [], options = {}) {
    await load();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error('Запись не найдена');
    }

    const trimmed = word.trim();
    const normalizedForms = await ensureNoConflicts(trimmed, forms, id);

    const updated = {
      ...entries[index],
      word: trimmed,
      forms: normalizedForms,
      description: description.trim(),
      groupId: options.groupId != null ? resolveGroupId(options.groupId) : entries[index].groupId,
      tags: options.tags != null ? normalizeTags(options.tags) : entries[index].tags
    };
    entries = [...entries];
    entries[index] = updated;
    await persist();
    return updated;
  }

  async function moveEntry(id, groupId) {
    await load();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error('Запись не найдена');

    entries = [...entries];
    entries[index] = { ...entries[index], groupId: resolveGroupId(groupId) };
    await persist();
    return entries[index];
  }

  async function remove(id) {
    await load();
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) {
      throw new Error('Запись не найдена');
    }
    entries = next;
    await persist();
    return true;
  }

  async function exportDictionary() {
    await load();
    return {
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      groups: [...groups],
      entries: [...entries]
    };
  }

  function findGroupByName(name, sourceGroups) {
    const key = String(name).trim().toLocaleLowerCase('ru');
    return sourceGroups.find((group) => group.name.toLocaleLowerCase('ru') === key) || null;
  }

  async function importDictionary(data, { mode = 'merge' } = {}) {
    if (!data || typeof data !== 'object') {
      throw new Error('Некорректный файл словаря');
    }

    const incomingGroups = normalizeGroups(data.groups || [defaultGroup()]);
    const incomingEntries = Array.isArray(data.entries) ? data.entries : Array.isArray(data) ? data : [];

    if (mode === 'replace') {
      groups = normalizeGroups(incomingGroups);
      entries = [];
      for (const rawEntry of incomingEntries) {
        try {
          const word = rawEntry?.word?.trim();
          if (!word) continue;
          const normalizedForms = normalizeForms(rawEntry.forms, word);
          entries.push({
            id: rawEntry.id || generateId(),
            word,
            forms: normalizedForms,
            description: typeof rawEntry.description === 'string' ? rawEntry.description : '',
            groupId: resolveGroupId(rawEntry.groupId),
            tags: normalizeTags(rawEntry.tags)
          });
        } catch {
          /* skip invalid rows */
        }
      }
      await persist();
      return {
        groupsAdded: groups.length,
        entriesAdded: entries.length,
        entriesUpdated: 0,
        entriesSkipped: 0
      };
    }

    await load();

    const stats = {
      groupsAdded: 0,
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesSkipped: 0
    };

    const groupIdMap = new Map();

    for (const incomingGroup of incomingGroups) {
      if (incomingGroup.id === DEFAULT_GROUP_ID) {
        groupIdMap.set(incomingGroup.id, DEFAULT_GROUP_ID);
        continue;
      }

      const existing = findGroupByName(incomingGroup.name, groups);
      if (existing) {
        groupIdMap.set(incomingGroup.id, existing.id);
      } else {
        const created = {
          id: generateId(),
          name: incomingGroup.name,
          order: groups.length
        };
        groups = [...groups, created];
        groupIdMap.set(incomingGroup.id, created.id);
        stats.groupsAdded += 1;
      }
    }

    groupIdMap.set(DEFAULT_GROUP_ID, DEFAULT_GROUP_ID);

    for (const rawEntry of incomingEntries) {
      const word = rawEntry?.word?.trim();
      if (!word) continue;

      const mappedGroupId = groupIdMap.get(rawEntry.groupId) || DEFAULT_GROUP_ID;
      const entryPayload = {
        word,
        description: typeof rawEntry.description === 'string' ? rawEntry.description : '',
        forms: rawEntry.forms,
        groupId: mappedGroupId,
        tags: normalizeTags(rawEntry.tags)
      };

      const existingIndex = entries.findIndex(
        (entry) => normalizeWordKey(entry.word) === normalizeWordKey(word)
      );

      if (existingIndex >= 0) {
        try {
          await update(
            entries[existingIndex].id,
            entryPayload.word,
            entryPayload.description,
            entryPayload.forms,
            { groupId: entryPayload.groupId, tags: entryPayload.tags }
          );
          stats.entriesUpdated += 1;
        } catch {
          stats.entriesSkipped += 1;
        }
        continue;
      }

      try {
        await add(
          entryPayload.word,
          entryPayload.description,
          entryPayload.forms,
          { groupId: entryPayload.groupId, tags: entryPayload.tags }
        );
        stats.entriesAdded += 1;
      } catch {
        stats.entriesSkipped += 1;
      }
    }

    return stats;
  }

  function applyCaseLike(reference, word) {
    if (!word) return word;

    if (reference === reference.toUpperCase() && /[a-zA-ZА-ЯЁ]/.test(reference)) {
      return word.toUpperCase();
    }

    if (reference === reference.toLowerCase()) {
      return word.toLowerCase();
    }

    if (
      reference.length > 0
      && reference[0] === reference[0].toUpperCase()
      && reference.slice(1) === reference.slice(1).toLowerCase()
    ) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }

    return word;
  }

  function matchesSelection(word, selection, selectionKey) {
    if (word === selection) return true;
    if (normalizeWordKey(word) === selectionKey) return true;
    if (applyCaseLike(selection, word) === selection) return true;
    return false;
  }

  function withGroupName(entry) {
    if (!entry) return null;
    const group = groups.find((item) => item.id === entry.groupId);
    return {
      ...entry,
      groupName: group?.name || 'Общие'
    };
  }

  async function lookupWord(text, options = {}) {
    const selection = text.trim();
    if (!/^\S+$/.test(selection)) return null;

    await load();

    const selectionKey = normalizeWordKey(selection);

    for (const entry of entries) {
      for (const entryWord of getEntryWords(entry)) {
        if (matchesSelection(entryWord, selection, selectionKey)) {
          return withGroupName(entry);
        }
      }
    }

    if (!globalThis.WSMorphology?.expandWord) return null;

    await WSMorphology.loadDictionary();
    const morphDepth = options.morphDepth || 'basic';

    for (const entry of entries) {
      for (const lemma of getEntryWords(entry)) {
        const forms = WSMorphology.expandWord(lemma, morphDepth);
        for (const form of forms) {
          if (matchesSelection(form, selection, selectionKey)) {
            return withGroupName(entry);
          }
        }
      }
    }

    return null;
  }

  return {
    STORAGE_KEY,
    DEFAULT_GROUP_ID,
    load,
    reload,
    getGroups,
    getGroup,
    getAll,
    getAllTags,
    addGroup,
    updateGroup,
    removeGroup,
    add,
    update,
    moveEntry,
    remove,
    exportDictionary,
    importDictionary,
    lookupWord
  };
})();
