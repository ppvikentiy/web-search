const $ = (id) => document.getElementById(id);

const CLIPPER_SAMPLE = {
  text: 'Пример выделенного текста со страницы',
  note: 'Моя заметка к цитате',
  url: 'https://example.com/article',
  title: 'Название статьи',
  date: '08.07.2026, 16:30',
  author: 'Иван Иванов',
  site: 'Example',
  published: '15.03.2024'
};

const LITERATURE_SAMPLE = {
  url: 'https://example.com/article',
  title: 'Название статьи',
  author: 'Иван Иванов',
  site: 'Example',
  published: '2024-03-15',
  date: new Date(2026, 6, 8, 16, 30)
};

const els = {
  setCase: $('set-case'),
  setWhole: $('set-whole'),
  setMorph: $('set-morph'),
  setAccentColor: $('set-accent-color'),
  setHighlightColor: $('set-highlight-color'),
  setCurrentColor: $('set-current-color'),
  setAnnotationColor: $('set-annotation-color'),
  setAnnotationActiveColor: $('set-annotation-active-color'),
  setAnnotationPopupBg: $('set-annotation-popup-bg'),
  setAnnotationPopupText: $('set-annotation-popup-text'),
  setAnnotationPopupMuted: $('set-annotation-popup-muted'),
  annPopupCustomColors: $('ann-popup-custom-colors'),
  setAnnotationPillBg: $('set-annotation-pill-bg'),
  setAnnotationPillText: $('set-annotation-pill-text'),
  setAnnotationPillMuted: $('set-annotation-pill-muted'),
  annPillCustomColors: $('ann-pill-custom-colors'),
  setAnnotationIframes: $('set-annotation-iframes'),
  setAnnotationExcludeTags: $('set-annotation-exclude-tags'),
  setAnnotationExcludeSelectors: $('set-annotation-exclude-selectors'),
  clipperFieldNote: $('clipper-field-note'),
  clipperFieldUrl: $('clipper-field-url'),
  clipperFieldTitle: $('clipper-field-title'),
  clipperFieldDate: $('clipper-field-date'),
  clipperFieldAuthor: $('clipper-field-author'),
  clipperFieldSite: $('clipper-field-site'),
  clipperFieldPublished: $('clipper-field-published'),
  clipperPreview: $('clipper-preview'),
  clipperCustom: $('clipper-custom'),
  clipperAdvanced: $('clipper-advanced'),
  clipperFieldsCard: $('clipper-fields-card'),
  literaturePreview: $('literature-preview'),
  setAnnotationSaveTemplate: $('set-annotation-save-template'),
  setIframes: $('set-iframes'),
  setShadow: $('set-shadow'),
  setExcludeTags: $('set-exclude-tags'),
  setExcludeSelectors: $('set-exclude-selectors'),
  btnReset: $('btn-reset'),
  btnSettingsExport: $('btn-settings-export'),
  btnSettingsImport: $('btn-settings-import'),
  settingsImportFile: $('settings-import-file'),
  annotationStorageStats: $('annotation-storage-stats'),
  annotationStorageClear: $('annotation-storage-clear'),
  saveStatus: $('save-status'),
  dictAddWord: $('dict-add-word'),
  dictAddForms: $('dict-add-forms'),
  dictAddTags: $('dict-add-tags'),
  dictAddGroup: $('dict-add-group'),
  dictAddDesc: $('dict-add-desc'),
  dictAddBtn: $('dict-add-btn'),
  dictFormError: $('dict-form-error'),
  dictList: $('dict-list'),
  dictEmpty: $('dict-empty'),
  dictGroupList: $('dict-group-list'),
  dictAddGroupBtn: $('dict-add-group-btn'),
  dictFilterTag: $('dict-filter-tag'),
  dictSearch: $('dict-search'),
  dictExportBtn: $('dict-export-btn'),
  dictImportBtn: $('dict-import-btn'),
  dictImportFile: $('dict-import-file'),
  dictImportStatus: $('dict-import-status')
};

let saveTimer = null;
const colorSwatchUi = [];

function initColorSwatches() {
  if (!globalThis.WSSwatches) return;
  const { mount, PALETTES } = WSSwatches;
  const bindings = [
    { el: els.setAccentColor, presets: PALETTES.accent },
    { el: els.setHighlightColor, presets: PALETTES.highlight },
    { el: els.setCurrentColor, presets: PALETTES.currentHighlight },
    { el: els.setAnnotationColor, presets: PALETTES.annotation },
    { el: els.setAnnotationActiveColor, presets: PALETTES.annotationActive },
    { el: els.setAnnotationPopupBg, presets: PALETTES.popupBg },
    { el: els.setAnnotationPopupText, presets: PALETTES.popupText },
    { el: els.setAnnotationPopupMuted, presets: PALETTES.popupMuted },
    { el: els.setAnnotationPillBg, presets: PALETTES.pillBg },
    { el: els.setAnnotationPillText, presets: PALETTES.popupText },
    { el: els.setAnnotationPillMuted, presets: PALETTES.popupMuted }
  ];
  for (const { el, presets } of bindings) {
    if (!el) continue;
    const onChange = el === els.setAccentColor
      ? (hex) => WSThemeAccent?.applyAccent?.(hex)
      : undefined;
    colorSwatchUi.push(mount(el, { presets, onChange }));
  }
}

function refreshColorSwatches() {
  for (const ui of colorSwatchUi) {
    ui.refresh?.();
  }
}
let dictSearchTimer = null;
let syncing = false;
let editingDictId = null;
let editingDictError = '';
let dictSelectedGroupId = '';
let dictGroupsCache = [];
let currentSaveFormat = 'txt';
let storedTemplates = {
  txt: WS_DEFAULTS.annotationSaveTemplateTxt,
  md: WS_DEFAULTS.annotationSaveTemplateMd
};

function getPhraseMode() {
  return document.querySelector('input[name="phraseMode"]:checked')?.value || 'exact';
}

function getMatchMode() {
  return document.querySelector('input[name="matchMode"]:checked')?.value || 'whole';
}

function getMorphDepth() {
  return document.querySelector('input[name="morphDepth"]:checked')?.value || 'basic';
}

function getAnnotationStyle() {
  return document.querySelector('input[name="annotationStyle"]:checked')?.value || 'background';
}

function getAnnotationPopupTheme() {
  return document.querySelector('input[name="annotationPopupTheme"]:checked')?.value || 'system';
}

function getAnnotationPillTheme() {
  return document.querySelector('input[name="annotationPillTheme"]:checked')?.value || 'light';
}

function updateAnnotationPopupThemeUi() {
  const custom = getAnnotationPopupTheme() === 'custom';
  if (els.annPopupCustomColors) {
    els.annPopupCustomColors.hidden = !custom;
  }
}

function updateAnnotationPillThemeUi() {
  const custom = getAnnotationPillTheme() === 'custom';
  if (els.annPillCustomColors) {
    els.annPillCustomColors.hidden = !custom;
  }
}

function getAnnotationSaveFormat() {
  return document.querySelector('input[name="annotationSaveFormat"]:checked')?.value || 'txt';
}

function getClipperFields() {
  return {
    note: els.clipperFieldNote.checked,
    url: els.clipperFieldUrl.checked,
    title: els.clipperFieldTitle.checked,
    date: els.clipperFieldDate.checked,
    author: els.clipperFieldAuthor.checked,
    site: els.clipperFieldSite.checked,
    published: els.clipperFieldPublished.checked
  };
}

function buildClipperTemplate(format, fields) {
  const lines = [];

  if (format === 'md') {
    lines.push('> {text}');
    if (fields.note) lines.push('', '{note}');

    const footerParts = [];
    if (fields.author) footerParts.push('{author}');
    if (fields.title && fields.url) footerParts.push('[{title}]({url})');
    else if (fields.url) footerParts.push('{url}');
    else if (fields.title) footerParts.push('{title}');
    if (fields.site) footerParts.push('{site}');
    if (fields.published) footerParts.push('{published}');
    if (fields.date) footerParts.push('{date}');

    if (footerParts.length) lines.push('', `— ${footerParts.join(', ')}`);
  } else {
    lines.push('{text}');
    if (fields.note) lines.push('', '{note}');

    const meta = [];
    if (fields.author) meta.push('Автор: {author}');
    if (fields.site) meta.push('Сайт: {site}');
    if (fields.published) meta.push('Опубликовано: {published}');
    if (fields.url) meta.push('Источник: {url}');
    if (fields.title) meta.push('Страница: {title}');
    if (fields.date) meta.push('Дата сохранения: {date}');

    if (meta.length) {
      lines.push('', ...meta);
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderClipperPreviewContent(template) {
  const values = { ...CLIPPER_SAMPLE, note: els.clipperFieldNote.checked ? CLIPPER_SAMPLE.note : '' };
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

function getActiveClipperTemplate() {
  if (els.clipperCustom.checked) {
    return els.setAnnotationSaveTemplate.value;
  }
  return buildClipperTemplate(currentSaveFormat, getClipperFields());
}

function syncClipperTemplateToStorage() {
  storedTemplates[currentSaveFormat] = getActiveClipperTemplate();
}

function updateClipperUi() {
  const custom = els.clipperCustom.checked;

  els.clipperFieldsCard.style.opacity = custom ? '0.55' : '1';
  els.clipperFieldsCard.style.pointerEvents = custom ? 'none' : 'auto';

  els.setAnnotationSaveTemplate.disabled = !custom;

  if (!custom) {
    els.setAnnotationSaveTemplate.value = buildClipperTemplate(currentSaveFormat, getClipperFields());
  }

  els.clipperPreview.textContent = renderClipperPreviewContent(getActiveClipperTemplate());
}

function getLiteraturePreset() {
  return document.querySelector('input[name="literatureCitationPreset"]:checked')?.value
    || WS_DEFAULTS.literatureCitationPreset
    || 'gost';
}

function updateLiteraturePreview() {
  if (!els.literaturePreview) return;
  els.literaturePreview.textContent = WSCitationFormats.formatBibliography(
    getLiteraturePreset(),
    LITERATURE_SAMPLE
  );
}

function loadLiteratureForm(stored) {
  const preset = stored.literatureCitationPreset || WS_DEFAULTS.literatureCitationPreset || 'gost';
  const radio = document.querySelector(`input[name="literatureCitationPreset"][value="${preset}"]`);
  if (radio) radio.checked = true;
  updateLiteraturePreview();
}

function loadClipperForm(stored) {
  storedTemplates.txt = stored.annotationSaveTemplateTxt || WS_DEFAULTS.annotationSaveTemplateTxt;
  storedTemplates.md = stored.annotationSaveTemplateMd || WS_DEFAULTS.annotationSaveTemplateMd;

  const saveFormatRadio = document.querySelector(`input[name="annotationSaveFormat"][value="${stored.annotationSaveFormat || 'txt'}"]`);
  if (saveFormatRadio) saveFormatRadio.checked = true;
  currentSaveFormat = getAnnotationSaveFormat();

  const fields = stored.annotationClipperFields || WS_DEFAULTS.annotationClipperFields;
  els.clipperFieldNote.checked = fields.note ?? true;
  els.clipperFieldUrl.checked = fields.url ?? true;
  els.clipperFieldTitle.checked = fields.title ?? true;
  els.clipperFieldDate.checked = fields.date ?? true;
  els.clipperFieldAuthor.checked = fields.author ?? true;
  els.clipperFieldSite.checked = fields.site ?? true;
  els.clipperFieldPublished.checked = fields.published ?? true;

  const autoTemplate = buildClipperTemplate(currentSaveFormat, getClipperFields());
  const storedTemplate = storedTemplates[currentSaveFormat];
  const useCustom = stored.annotationClipperCustom
    ?? (storedTemplate.trim() !== autoTemplate.trim());

  els.clipperCustom.checked = useCustom;
  els.setAnnotationSaveTemplate.value = storedTemplate;

  if (useCustom) {
    els.clipperAdvanced.open = true;
  }

  updateClipperUi();
}

function loadForm(stored) {
  els.setCase.checked = stored.caseSensitive ?? true;
  els.setWhole.checked = stored.wholeWord ?? true;
  els.setMorph.checked = stored.useMorphology ?? false;

  const phraseRadio = document.querySelector(`input[name="phraseMode"][value="${stored.phraseMode || 'exact'}"]`);
  if (phraseRadio) phraseRadio.checked = true;

  const matchRadio = document.querySelector(`input[name="matchMode"][value="${stored.matchMode || 'whole'}"]`);
  if (matchRadio) matchRadio.checked = true;

  if (els.setAccentColor) {
    els.setAccentColor.value = stored.accentColor || WS_DEFAULTS.accentColor || '#7c6cf0';
  }
  WSThemeAccent?.applyFromSettings?.(stored);

  els.setHighlightColor.value = stored.highlightColor || '#ffff00';
  els.setCurrentColor.value = stored.currentHighlightColor || '#ff9632';
  els.setAnnotationColor.value = stored.annotationColor || '#7bed9f';
  els.setAnnotationActiveColor.value = stored.annotationActiveColor || '#1e90ff';
  els.setAnnotationIframes.checked = stored.annotationIframes ?? true;

  const annTags = Array.isArray(stored.annotationExcludeTags)
    ? stored.annotationExcludeTags
    : (stored.annotationExcludeTags || 'script, style, noscript, textarea').toString().split(',');
  els.setAnnotationExcludeTags.value = annTags.map((t) => t.trim()).filter(Boolean).join(', ');

  const annSelectors = Array.isArray(stored.annotationExcludeSelectors)
    ? stored.annotationExcludeSelectors
    : (stored.annotationExcludeSelectors || '').toString().split('\n');
  els.setAnnotationExcludeSelectors.value = annSelectors.map((s) => s.trim()).filter(Boolean).join('\n');

  const annStyleRadio = document.querySelector(`input[name="annotationStyle"][value="${stored.annotationStyle || 'background'}"]`);
  if (annStyleRadio) annStyleRadio.checked = true;

  const popupThemeRadio = document.querySelector(`input[name="annotationPopupTheme"][value="${stored.annotationPopupTheme || 'system'}"]`);
  if (popupThemeRadio) popupThemeRadio.checked = true;
  els.setAnnotationPopupBg.value = stored.annotationPopupBg || WS_DEFAULTS.annotationPopupBg;
  els.setAnnotationPopupText.value = stored.annotationPopupText || WS_DEFAULTS.annotationPopupText;
  els.setAnnotationPopupMuted.value = stored.annotationPopupMuted || WS_DEFAULTS.annotationPopupMuted;

  const pillThemeRadio = document.querySelector(`input[name="annotationPillTheme"][value="${stored.annotationPillTheme || WS_DEFAULTS.annotationPillTheme || 'light'}"]`);
  if (pillThemeRadio) pillThemeRadio.checked = true;
  if (els.setAnnotationPillBg) {
    els.setAnnotationPillBg.value = stored.annotationPillBg || WS_DEFAULTS.annotationPillBg;
  }
  if (els.setAnnotationPillText) {
    els.setAnnotationPillText.value = stored.annotationPillText || WS_DEFAULTS.annotationPillText;
  }
  if (els.setAnnotationPillMuted) {
    els.setAnnotationPillMuted.value = stored.annotationPillMuted || WS_DEFAULTS.annotationPillMuted;
  }
  updateAnnotationPillThemeUi();
  updateAnnotationPopupThemeUi();

  loadClipperForm(stored);
  loadLiteratureForm(stored);

  els.setIframes.checked = stored.searchIframes ?? false;
  els.setShadow.checked = stored.searchShadowDom ?? false;

  const tags = Array.isArray(stored.excludeTags)
    ? stored.excludeTags
    : (stored.excludeTags || 'script, style, noscript, textarea').toString().split(',');
  els.setExcludeTags.value = tags.map((t) => t.trim()).filter(Boolean).join(', ');

  const selectors = Array.isArray(stored.excludeSelectors)
    ? stored.excludeSelectors
    : (stored.excludeSelectors || '').toString().split('\n');
  els.setExcludeSelectors.value = selectors.map((s) => s.trim()).filter(Boolean).join('\n');

  const depthRadio = document.querySelector(`input[name="morphDepth"][value="${stored.morphDepth || 'basic'}"]`);
  if (depthRadio) depthRadio.checked = true;

  refreshColorSwatches();
}

function collectSettings() {
  const tags = els.setExcludeTags.value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const selectors = els.setExcludeSelectors.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const annTags = els.setAnnotationExcludeTags.value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const annSelectors = els.setAnnotationExcludeSelectors.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const phraseMode = getPhraseMode();
  const matchMode = getMatchMode();

  syncClipperTemplateToStorage();

  return {
    caseSensitive: els.setCase.checked,
    wholeWord: els.setWhole.checked,
    useMorphology: els.setMorph.checked || phraseMode === 'morph',
    phraseMode,
    matchMode,
    morphDepth: getMorphDepth(),
    accentColor: els.setAccentColor?.value || WS_DEFAULTS.accentColor,
    highlightColor: els.setHighlightColor.value,
    currentHighlightColor: els.setCurrentColor.value,
    annotationColor: els.setAnnotationColor.value,
    annotationActiveColor: els.setAnnotationActiveColor.value,
    annotationStyle: getAnnotationStyle(),
    annotationPopupTheme: getAnnotationPopupTheme(),
    annotationPopupBg: els.setAnnotationPopupBg.value,
    annotationPopupText: els.setAnnotationPopupText.value,
    annotationPopupMuted: els.setAnnotationPopupMuted.value,
    annotationPillTheme: getAnnotationPillTheme(),
    annotationPillBg: els.setAnnotationPillBg?.value || WS_DEFAULTS.annotationPillBg,
    annotationPillText: els.setAnnotationPillText?.value || WS_DEFAULTS.annotationPillText,
    annotationPillMuted: els.setAnnotationPillMuted?.value || WS_DEFAULTS.annotationPillMuted,
    annotationIframes: els.setAnnotationIframes.checked,
    annotationExcludeTags: annTags.length ? annTags : WS_DEFAULTS.annotationExcludeTags,
    annotationExcludeSelectors: annSelectors,
    annotationSaveFormat: getAnnotationSaveFormat(),
    annotationSaveTemplateTxt: storedTemplates.txt,
    annotationSaveTemplateMd: storedTemplates.md,
    annotationClipperFields: getClipperFields(),
    annotationClipperCustom: els.clipperCustom.checked,
    literatureCitationPreset: getLiteraturePreset(),
    searchIframes: els.setIframes.checked,
    searchShadowDom: els.setShadow.checked,
    excludeTags: tags.length ? tags : WS_DEFAULTS.excludeTags,
    excludeSelectors: selectors
  };
}

function showSaved() {
  els.saveStatus.textContent = 'Сохранено';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    els.saveStatus.textContent = '';
  }, 2000);
}

function truncateDictDesc(text, max = 120) {
  const value = (text || '').trim();
  if (value.length <= max) return value || '—';
  return `${value.slice(0, max)}…`;
}

function showDictError(text) {
  if (editingDictId) {
    editingDictError = text || '';
    loadDictionaryUi();
    return;
  }

  editingDictError = '';
  if (!els.dictFormError) return;
  if (text) {
    els.dictFormError.textContent = text;
    els.dictFormError.hidden = false;
  } else {
    els.dictFormError.textContent = '';
    els.dictFormError.hidden = true;
  }
}

async function broadcastDictionaryUpdate() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;

    if (tab.url?.includes('/reader/reader.html')) {
      try {
        await chrome.runtime.sendMessage({ type: 'UPDATE_DICTIONARY', targetTabId: tab.id });
      } catch {
        /* reader tab not ready */
      }
      continue;
    }

    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://')) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_DICTIONARY' }, { frameId: 0 });
    } catch {
      /* tab without content script */
    }
  }
}

function formatDictForms(forms) {
  return Array.isArray(forms) && forms.length ? forms.join(', ') : '';
}

function formatDictTags(tags) {
  return Array.isArray(tags) && tags.length ? tags.join(', ') : '';
}

function getGroupName(groupId) {
  const group = dictGroupsCache.find((item) => item.id === groupId);
  return group?.name || 'Общие';
}

function populateDictGroupSelect(selectedId) {
  if (!els.dictAddGroup) return;

  els.dictAddGroup.innerHTML = '';
  for (const group of dictGroupsCache) {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.name;
    els.dictAddGroup.append(option);
  }

  if (selectedId && dictGroupsCache.some((group) => group.id === selectedId)) {
    els.dictAddGroup.value = selectedId;
  } else if (dictSelectedGroupId) {
    els.dictAddGroup.value = dictSelectedGroupId;
  }
}

function populateDictTagFilter(tags, selectedTag) {
  if (!els.dictFilterTag) return;

  const current = selectedTag ?? els.dictFilterTag.value;
  els.dictFilterTag.innerHTML = '<option value="">Все теги</option>';

  for (const tag of tags) {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    els.dictFilterTag.append(option);
  }

  els.dictFilterTag.value = current;
}

function renderDictGroupList(groups, entryCounts) {
  if (!els.dictGroupList) return;

  els.dictGroupList.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `dict-group-item${dictSelectedGroupId === '' ? ' dict-group-item-active' : ''}`;
  allBtn.textContent = `Все папки (${entryCounts.all || 0})`;
  allBtn.addEventListener('click', () => {
    dictSelectedGroupId = '';
    loadDictionaryUi();
  });
  els.dictGroupList.append(allBtn);

  for (const group of groups) {
    const row = document.createElement('div');
    row.className = 'dict-group-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dict-group-item${dictSelectedGroupId === group.id ? ' dict-group-item-active' : ''}`;
    btn.textContent = `${group.name} (${entryCounts[group.id] || 0})`;
    btn.addEventListener('click', () => {
      dictSelectedGroupId = group.id;
      loadDictionaryUi();
    });

    row.append(btn);

    if (group.id !== WSUserDictionary.DEFAULT_GROUP_ID) {
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'dict-group-action';
      renameBtn.title = 'Переименовать';
      renameBtn.textContent = '✎';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameDictionaryGroup(group.id, group.name);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'dict-group-action dict-group-action-danger';
      deleteBtn.title = 'Удалить';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteDictionaryGroup(group.id, group.name);
      });

      row.append(renameBtn, deleteBtn);
    }

    els.dictGroupList.append(row);
  }
}

function createDictMeta(entry) {
  const meta = document.createElement('div');
  meta.className = 'dict-item-meta';

  const folder = document.createElement('span');
  folder.className = 'dict-item-folder';
  folder.textContent = getGroupName(entry.groupId);
  meta.append(folder);

  if (entry.tags?.length) {
    const tags = document.createElement('div');
    tags.className = 'dict-item-tags';
    for (const tag of entry.tags) {
      const chip = document.createElement('span');
      chip.className = 'dict-tag-chip';
      chip.textContent = tag;
      tags.append(chip);
    }
    meta.append(tags);
  }

  return meta;
}

function createDictGroupSelect(selectedGroupId) {
  const select = document.createElement('select');
  select.className = 'dict-edit-group';
  for (const group of dictGroupsCache) {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.name;
    if (group.id === selectedGroupId) option.selected = true;
    select.append(option);
  }
  return select;
}

function renderDictionaryList(entries) {
  if (!els.dictList || !els.dictEmpty) return;

  els.dictList.innerHTML = '';
  els.dictEmpty.hidden = entries.length > 0;
  if (!entries.length) {
    els.dictEmpty.textContent = dictSelectedGroupId || els.dictFilterTag?.value || els.dictSearch?.value
      ? 'Ничего не найдено. Измените фильтр или поисковый запрос.'
      : 'Словарь пуст. Добавьте первое слово выше.';
  }

  for (const entry of entries) {
    const item = document.createElement('article');
    item.className = 'dict-item';
    item.dataset.id = entry.id;

    const view = document.createElement('div');
    view.className = 'dict-item-view';
    view.hidden = editingDictId === entry.id;

    const main = document.createElement('div');
    main.className = 'dict-item-main';

    const word = document.createElement('div');
    word.className = 'dict-item-word';
    word.textContent = entry.word;

    main.append(word, createDictMeta(entry));

    if (entry.forms?.length) {
      const forms = document.createElement('div');
      forms.className = 'dict-item-forms';
      forms.textContent = formatDictForms(entry.forms);
      main.append(forms);
    }

    const desc = document.createElement('div');
    desc.className = 'dict-item-desc';
    desc.textContent = truncateDictDesc(entry.description);
    main.append(desc);

    const actions = document.createElement('div');
    actions.className = 'dict-item-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'dict-item-btn';
    editBtn.textContent = 'Изменить';
    editBtn.addEventListener('click', () => startDictionaryEdit(entry.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'dict-item-btn dict-item-btn-danger';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', () => deleteDictionaryEntry(entry.id));

    actions.append(editBtn, deleteBtn);
    view.append(main, actions);

    const edit = document.createElement('div');
    edit.className = 'dict-item-edit';
    edit.hidden = editingDictId !== entry.id;

    const editGroup = createDictGroupSelect(entry.groupId);
    const editWord = document.createElement('input');
    editWord.type = 'text';
    editWord.className = 'dict-edit-word';
    editWord.value = entry.word;

    const editForms = document.createElement('input');
    editForms.type = 'text';
    editForms.className = 'dict-edit-forms';
    editForms.placeholder = 'гомозиготная, гомозиготное';
    editForms.value = formatDictForms(entry.forms);

    const editTags = document.createElement('input');
    editTags.type = 'text';
    editTags.className = 'dict-edit-tags';
    editTags.placeholder = 'биология, экзамен';
    editTags.value = formatDictTags(entry.tags);

    const editDesc = document.createElement('textarea');
    editDesc.className = 'dict-edit-desc';
    editDesc.rows = 3;
    editDesc.value = entry.description || '';

    const editActions = document.createElement('div');
    editActions.className = 'dict-item-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'dict-item-btn';
    saveBtn.textContent = 'Сохранить';
    saveBtn.addEventListener('click', () => saveDictionaryEdit(
      entry.id,
      editWord.value,
      editDesc.value,
      editForms.value,
      editGroup.value,
      editTags.value
    ));

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'dict-item-btn';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.addEventListener('click', cancelDictionaryEdit);

    editActions.append(saveBtn, cancelBtn);

    if (editingDictId === entry.id && editingDictError) {
      const editError = document.createElement('p');
      editError.className = 'dict-form-error';
      editError.textContent = editingDictError;
      edit.append(editGroup, editWord, editForms, editTags, editDesc, editError, editActions);
    } else {
      edit.append(editGroup, editWord, editForms, editTags, editDesc, editActions);
    }

    item.append(view, edit);
    els.dictList.append(item);
  }
}

async function loadDictionaryUi() {
  const [groups, allEntries, tags] = await Promise.all([
    WSUserDictionary.getGroups(),
    WSUserDictionary.getAll(),
    WSUserDictionary.getAllTags()
  ]);

  dictGroupsCache = groups;

  const entryCounts = { all: allEntries.length };
  for (const group of groups) {
    entryCounts[group.id] = allEntries.filter((entry) => entry.groupId === group.id).length;
  }

  renderDictGroupList(groups, entryCounts);
  populateDictGroupSelect();
  populateDictTagFilter(tags);

  const filters = {};
  if (dictSelectedGroupId) filters.groupId = dictSelectedGroupId;
  if (els.dictFilterTag?.value) filters.tag = els.dictFilterTag.value;

  const entries = Object.keys(filters).length
    ? await WSUserDictionary.getAll(filters)
    : allEntries;

  const query = (els.dictSearch?.value || '').trim().toLowerCase();
  const filtered = query
    ? entries.filter((entry) => {
      const haystack = [
        entry.word,
        entry.description,
        ...(entry.forms || []),
        ...(entry.tags || [])
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    })
    : entries;

  renderDictionaryList(filtered);
}

function showDictImportStatus(text, isError = false) {
  if (!els.dictImportStatus) return;
  if (!text) {
    els.dictImportStatus.hidden = true;
    els.dictImportStatus.textContent = '';
    return;
  }
  els.dictImportStatus.hidden = false;
  els.dictImportStatus.textContent = text;
  els.dictImportStatus.classList.toggle('dict-import-status-error', isError);
}

async function exportDictionaryJson() {
  const data = await WSUserDictionary.exportDictionary();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dictionary-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showDictImportStatus('Словарь экспортирован.');
}

async function importDictionaryJson(file) {
  if (!file) return;

  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    showDictImportStatus('Не удалось прочитать JSON-файл.', true);
    return;
  }

  const replace = window.confirm(
    'Заменить текущий словарь импортом?\n\nOK — заменить полностью\nОтмена — объединить с существующим'
  );
  const mode = replace ? 'replace' : 'merge';

  try {
    const stats = await WSUserDictionary.importDictionary(data, { mode });
    await saveDictionaryAndBroadcast();
    showDictImportStatus(
      mode === 'replace'
        ? `Импорт завершён: ${stats.entriesAdded} записей, ${stats.groupsAdded} папок.`
        : `Импорт: +${stats.entriesAdded}, обновлено ${stats.entriesUpdated}, пропущено ${stats.entriesSkipped}, папок +${stats.groupsAdded}.`
    );
  } catch (err) {
    showDictImportStatus(err.message || 'Не удалось импортировать словарь.', true);
  }
}

async function addDictionaryGroup() {
  const name = window.prompt('Название новой папки');
  if (!name) return;

  try {
    const group = await WSUserDictionary.addGroup(name);
    dictSelectedGroupId = group.id;
    await saveDictionaryAndBroadcast();
  } catch (err) {
    showDictError(err.message || 'Не удалось создать папку');
  }
}

async function renameDictionaryGroup(id, currentName) {
  const name = window.prompt('Новое название папки', currentName);
  if (!name || name.trim() === currentName) return;

  try {
    await WSUserDictionary.updateGroup(id, name);
    await saveDictionaryAndBroadcast();
  } catch (err) {
    showDictError(err.message || 'Не удалось переименовать папку');
  }
}

async function deleteDictionaryGroup(id, name) {
  const confirmed = window.confirm(`Удалить папку «${name}»? Слова будут перенесены в «Общие».`);
  if (!confirmed) return;

  try {
    await WSUserDictionary.removeGroup(id);
    if (dictSelectedGroupId === id) dictSelectedGroupId = '';
    await saveDictionaryAndBroadcast();
  } catch (err) {
    showDictError(err.message || 'Не удалось удалить папку');
  }
}

async function saveDictionaryAndBroadcast() {
  await broadcastDictionaryUpdate();
  await loadDictionaryUi();
  if (els.saveStatus) {
    els.saveStatus.textContent = 'Словарь сохранён';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      els.saveStatus.textContent = '';
    }, 2000);
  }
}

async function addDictionaryEntry() {
  showDictError('');
  const word = els.dictAddWord?.value || '';
  const forms = els.dictAddForms?.value || '';
  const description = els.dictAddDesc?.value || '';
  const tags = els.dictAddTags?.value || '';
  const groupId = els.dictAddGroup?.value || WSUserDictionary.DEFAULT_GROUP_ID;

  try {
    await WSUserDictionary.add(word, description, forms, { groupId, tags });
    editingDictError = '';
    if (els.dictAddWord) els.dictAddWord.value = '';
    if (els.dictAddForms) els.dictAddForms.value = '';
    if (els.dictAddTags) els.dictAddTags.value = '';
    if (els.dictAddDesc) els.dictAddDesc.value = '';
    await saveDictionaryAndBroadcast();
  } catch (err) {
    showDictError(err.message || 'Не удалось добавить слово');
  }
}

function startDictionaryEdit(id) {
  editingDictId = id;
  editingDictError = '';
  showDictError('');
  loadDictionaryUi();
}

function cancelDictionaryEdit() {
  editingDictId = null;
  editingDictError = '';
  showDictError('');
  loadDictionaryUi();
}

async function saveDictionaryEdit(id, word, description, forms = '', groupId = '', tags = '') {
  showDictError('');
  try {
    await WSUserDictionary.update(id, word, description, forms, {
      groupId: groupId || undefined,
      tags
    });
    editingDictId = null;
    editingDictError = '';
    await saveDictionaryAndBroadcast();
  } catch (err) {
    showDictError(err.message || 'Не удалось сохранить запись');
  }
}

async function deleteDictionaryEntry(id) {
  showDictError('');
  try {
    await WSUserDictionary.remove(id);
    if (editingDictId === id) editingDictId = null;
    await saveDictionaryAndBroadcast();
  } catch (err) {
    showDictError(err.message || 'Не удалось удалить запись');
  }
}

function bindDictionary() {
  els.dictAddBtn?.addEventListener('click', addDictionaryEntry);
  els.dictAddWord?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addDictionaryEntry();
    }
  });
  els.dictAddGroupBtn?.addEventListener('click', addDictionaryGroup);
  els.dictFilterTag?.addEventListener('change', loadDictionaryUi);
  els.dictSearch?.addEventListener('input', () => {
    clearTimeout(dictSearchTimer);
    dictSearchTimer = setTimeout(loadDictionaryUi, 180);
  });
  els.dictExportBtn?.addEventListener('click', exportDictionaryJson);
  els.dictImportBtn?.addEventListener('click', () => els.dictImportFile?.click());
  els.dictImportFile?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    await importDictionaryJson(file);
  });
}

async function broadcastSettingsUpdate() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;

    if (tab.url?.includes('/reader/reader.html')) {
      try {
        await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', targetTabId: tab.id });
      } catch {
        /* reader tab not ready */
      }
      continue;
    }

    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://')) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_SETTINGS' }, { frameId: 0 });
    } catch {
      /* tab without content script */
    }
  }
}

async function save() {
  if (syncing) return;

  const settings = collectSettings();
  await WSSettingsStorage.set(settings);
  WSThemeAccent?.applyFromSettings?.(settings);

  await broadcastSettingsUpdate();

  showSaved();
}

function syncWholeToMatchMode() {
  syncing = true;
  const val = els.setWhole.checked ? 'whole' : 'substring';
  const radio = document.querySelector(`input[name="matchMode"][value="${val}"]`);
  if (radio) radio.checked = true;
  syncing = false;
}

function syncMatchModeToWhole() {
  syncing = true;
  els.setWhole.checked = getMatchMode() === 'whole';
  syncing = false;
}

function initAbout() {
  const versionEl = $('about-version');
  const sidebarVersionEl = $('sidebar-version');
  try {
    const manifest = chrome.runtime.getManifest();
    const version = manifest.version || '—';
    if (versionEl) versionEl.textContent = version;
    if (sidebarVersionEl) sidebarVersionEl.textContent = `v${version}`;
  } catch {
    if (versionEl) versionEl.textContent = '—';
    if (sidebarVersionEl) sidebarVersionEl.textContent = '';
  }
}

function switchSection(sectionId) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    const active = btn.dataset.section === sectionId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  document.querySelectorAll('.panel').forEach((panel) => {
    const active = panel.id === `panel-${sectionId}`;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });

}

function onClipperChange() {
  updateClipperUi();
  save();
}

function bindLiterature() {
  document.querySelectorAll('input[name="literatureCitationPreset"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      updateLiteraturePreview();
      save();
    });
  });
}

function bindClipper() {
  [
    els.clipperFieldNote,
    els.clipperFieldUrl,
    els.clipperFieldTitle,
    els.clipperFieldDate,
    els.clipperFieldAuthor,
    els.clipperFieldSite,
    els.clipperFieldPublished,
    els.clipperCustom
  ].forEach((input) => {
    input.addEventListener('change', onClipperChange);
  });

  document.querySelectorAll('input[name="annotationSaveFormat"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      syncClipperTemplateToStorage();
      currentSaveFormat = getAnnotationSaveFormat();

      if (!els.clipperCustom.checked) {
        els.setAnnotationSaveTemplate.value = buildClipperTemplate(currentSaveFormat, getClipperFields());
      } else {
        els.setAnnotationSaveTemplate.value = storedTemplates[currentSaveFormat];
      }

      updateClipperUi();
      save();
    });
  });

  els.setAnnotationSaveTemplate.addEventListener('input', () => {
    if (!els.clipperCustom.checked) return;
    els.clipperPreview.textContent = renderClipperPreviewContent(els.setAnnotationSaveTemplate.value);
  });

  els.setAnnotationSaveTemplate.addEventListener('blur', () => {
    if (!els.clipperCustom.checked) return;
    syncClipperTemplateToStorage();
    save();
  });
}

function bindAutoSave() {
  document.querySelectorAll('input, textarea').forEach((input) => {
    if (input.closest('.swatch-btn-custom')) return;
    if (input.id === 'set-whole') return;
    if (input.id === 'clipper-field-note') return;
    if (input.id === 'clipper-field-url') return;
    if (input.id === 'clipper-field-title') return;
    if (input.id === 'clipper-field-date') return;
    if (input.id === 'clipper-field-author') return;
    if (input.id === 'clipper-field-site') return;
    if (input.id === 'clipper-field-published') return;
    if (input.id === 'clipper-custom') return;
    if (input.id === 'set-annotation-save-template') return;
    if (input.id === 'settings-import-file') return;
    if (input.name === 'matchMode' || input.name === 'phraseMode' || input.name === 'annotationStyle' || input.name === 'annotationSaveFormat' || input.name === 'annotationPopupTheme' || input.name === 'annotationPillTheme') return;
    input.addEventListener('change', save);
  });

  els.setExcludeTags.addEventListener('blur', save);
  els.setExcludeSelectors.addEventListener('blur', save);
  els.setAnnotationExcludeTags.addEventListener('blur', save);
  els.setAnnotationExcludeSelectors.addEventListener('blur', save);
}

function bindSync() {
  els.setWhole.addEventListener('change', () => {
    syncWholeToMatchMode();
    save();
  });

  document.querySelectorAll('input[name="matchMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      syncMatchModeToWhole();
      save();
    });
  });

  document.querySelectorAll('input[name="phraseMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (getPhraseMode() === 'morph') {
        syncing = true;
        els.setMorph.checked = true;
        syncing = false;
      }
      save();
    });
  });

  document.querySelectorAll('input[name="annotationStyle"]').forEach((radio) => {
    radio.addEventListener('change', save);
  });

  document.querySelectorAll('input[name="annotationPopupTheme"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      updateAnnotationPopupThemeUi();
      save();
    });
  });

  document.querySelectorAll('input[name="annotationPillTheme"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      updateAnnotationPillThemeUi();
      save();
    });
  });

  for (const input of [els.setAnnotationPillBg, els.setAnnotationPillText, els.setAnnotationPillMuted]) {
    input?.addEventListener('change', save);
  }
}

async function loadAnnotationStorageUi() {
  if (!els.annotationStorageStats) return;
  try {
    const stats = await WSAnnotationStorage.stats();
    const pages = stats.pages || 0;
    els.annotationStorageStats.textContent = pages
      ? `Аннотации сохранены для ${pages} страниц`
      : 'Сохранённых аннотаций нет';
    if (els.annotationStorageClear) {
      els.annotationStorageClear.disabled = pages === 0;
    }
  } catch {
    els.annotationStorageStats.textContent = 'Не удалось прочитать хранилище аннотаций';
  }
}

async function clearAnnotationStorage() {
  if (!window.confirm('Удалить все сохранённые аннотации?')) return;
  await WSAnnotationStorage.clearAll();
  await loadAnnotationStorageUi();
  els.saveStatus.textContent = 'Аннотации удалены';
}

async function exportSettingsJson() {
  const stored = await WSSettingsStorage.get(WS_DEFAULTS);
  const payload = {
    type: 'web-search-settings',
    version: 1,
    settings: WSSettingsStorage.pickSettings(stored)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `web-search-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  els.saveStatus.textContent = 'Настройки экспортированы';
}

async function importSettingsJson(file) {
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    els.saveStatus.textContent = 'Не удалось прочитать JSON-файл';
    return;
  }
  const incoming = data?.settings && typeof data.settings === 'object' ? data.settings : data;
  const picked = WSSettingsStorage.pickSettings(incoming);
  if (!Object.keys(picked).length) {
    els.saveStatus.textContent = 'В файле нет настроек';
    return;
  }
  await WSSettingsStorage.set(picked);
  const stored = await WSSettingsStorage.get(WS_DEFAULTS);
  loadForm(stored);
  await broadcastSettingsUpdate();
  els.saveStatus.textContent = 'Настройки импортированы';
}

async function reset() {
  await WSSettingsStorage.set(WS_DEFAULTS);
  loadForm(WS_DEFAULTS);
  await save();
  els.saveStatus.textContent = 'Настройки сброшены';
  saveTimer = setTimeout(() => {
    els.saveStatus.textContent = '';
  }, 2000);
}

async function init() {
  try {
    globalThis.WSIcons?.hydrate?.(document);
    initColorSwatches();

    const stored = await WSSettingsStorage.get(WS_DEFAULTS);
    loadForm(stored);

    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchSection(btn.dataset.section));
    });

    els.btnReset?.addEventListener('click', reset);
    els.btnSettingsExport?.addEventListener('click', exportSettingsJson);
    els.btnSettingsImport?.addEventListener('click', () => els.settingsImportFile?.click());
    els.settingsImportFile?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      importSettingsJson(file).finally(() => {
        event.target.value = '';
      });
    });
    els.annotationStorageClear?.addEventListener('click', clearAnnotationStorage);
    bindAutoSave();
    els.setAccentColor?.addEventListener('input', () => {
      WSThemeAccent?.applyAccent?.(els.setAccentColor.value);
    });
    const selectPillCustomTheme = () => {
      const radio = document.querySelector('input[name="annotationPillTheme"][value="custom"]');
      if (radio && !radio.checked) {
        radio.checked = true;
        updateAnnotationPillThemeUi();
      }
    };
    for (const input of [els.setAnnotationPillBg, els.setAnnotationPillText, els.setAnnotationPillMuted]) {
      input?.addEventListener('input', selectPillCustomTheme);
    }
    bindSync();
    bindClipper();
    bindLiterature();
    initAbout();
    await loadAnnotationStorageUi();
  } catch (err) {
    if (els.saveStatus) {
      els.saveStatus.textContent = err.message || 'Ошибка загрузки настроек';
      els.saveStatus.classList.add('error');
    }
    console.error('[web-search] settings init failed:', err);
  }
}

function startInit() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

startInit();
