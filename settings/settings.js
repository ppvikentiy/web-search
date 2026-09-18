const $ = (id) => document.getElementById(id);

const CLIPPER_SAMPLE = {
  text: 'Пример выделенного текста со страницы',
  note: 'Моя заметка к цитате',
  url: 'https://example.com/article',
  title: 'Название статьи',
  date: '08.07.2026, 16:30'
};

const LITERATURE_SAMPLE = {
  url: 'https://example.com/article',
  title: 'Название статьи',
  date: new Date(2026, 6, 8, 16, 30)
};

const els = {
  setCase: $('set-case'),
  setWhole: $('set-whole'),
  setMorph: $('set-morph'),
  setHighlightColor: $('set-highlight-color'),
  setCurrentColor: $('set-current-color'),
  setAnnotationColor: $('set-annotation-color'),
  setAnnotationActiveColor: $('set-annotation-active-color'),
  setAnnotationPopupBg: $('set-annotation-popup-bg'),
  setAnnotationPopupText: $('set-annotation-popup-text'),
  setAnnotationPopupMuted: $('set-annotation-popup-muted'),
  annPopupCustomColors: $('ann-popup-custom-colors'),
  setAnnotationIframes: $('set-annotation-iframes'),
  setAnnotationExcludeTags: $('set-annotation-exclude-tags'),
  setAnnotationExcludeSelectors: $('set-annotation-exclude-selectors'),
  clipperFieldNote: $('clipper-field-note'),
  clipperFieldUrl: $('clipper-field-url'),
  clipperFieldTitle: $('clipper-field-title'),
  clipperFieldDate: $('clipper-field-date'),
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
  setArchiveScrollDelay: $('set-archive-scroll-delay'),
  setArchivePrepareTimeout: $('set-archive-prepare-timeout'),
  setArchiveOmitCredentials: $('set-archive-omit-credentials'),
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
  dictImportStatus: $('dict-import-status'),
  archiveSaveCurrent: $('archive-save-current'),
  archiveStats: $('archive-stats'),
  archiveList: $('archive-list'),
  archiveEmpty: $('archive-empty'),
  archiveClearJournal: $('archive-clear-journal'),
  archiveOpenBtn: $('archive-open-btn'),
  archiveSaveModal: $('archive-save-modal'),
  archiveSaveUrl: $('archive-save-url'),
  archiveSaveError: $('archive-save-error'),
  archiveSaveCancel: $('archive-save-cancel'),
  archiveSaveSubmit: $('archive-save-submit'),
  archiveSaveProgressWrap: $('archive-save-progress-wrap'),
  archiveSaveProgressLabel: $('archive-save-progress-label'),
  archiveSaveProgressBar: $('archive-save-progress-bar'),
  archiveOpenModal: $('archive-open-modal'),
  archiveDropzone: $('archive-dropzone'),
  archiveOpenPick: $('archive-open-pick'),
  archiveOpenFile: $('archive-open-file'),
  archiveOpenFilename: $('archive-open-filename'),
  archiveOpenError: $('archive-open-error'),
  archiveOpenCancel: $('archive-open-cancel'),
  archiveOpenSubmit: $('archive-open-submit'),
  archiveOpenProgressWrap: $('archive-open-progress-wrap'),
  archiveOpenProgressLabel: $('archive-open-progress-label'),
  archiveOpenProgressBar: $('archive-open-progress-bar')
};

let saveTimer = null;
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

function updateAnnotationPopupThemeUi() {
  const custom = getAnnotationPopupTheme() === 'custom';
  if (els.annPopupCustomColors) {
    els.annPopupCustomColors.hidden = !custom;
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
    date: els.clipperFieldDate.checked
  };
}

function buildClipperTemplate(format, fields) {
  const lines = [];

  if (format === 'md') {
    lines.push('> {text}');
    if (fields.note) lines.push('', '{note}');

    const footerParts = [];
    if (fields.title && fields.url) footerParts.push('— [{title}]({url})');
    else if (fields.url) footerParts.push('— {url}');
    else if (fields.title) footerParts.push('— {title}');

    if (fields.date) {
      footerParts.push(footerParts.length ? ', {date}' : '{date}');
    }

    if (footerParts.length) lines.push('', footerParts.join(''));
  } else {
    lines.push('{text}');
    if (fields.note) lines.push('', '{note}');

    const meta = [];
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

  if (els.setArchiveScrollDelay) {
    els.setArchiveScrollDelay.value = stored.archiveScrollStepDelayMs ?? WS_DEFAULTS.archiveScrollStepDelayMs;
  }
  if (els.setArchivePrepareTimeout) {
    els.setArchivePrepareTimeout.value = stored.archivePrepareTimeoutMs ?? WS_DEFAULTS.archivePrepareTimeoutMs;
  }
  if (els.setArchiveOmitCredentials) {
    els.setArchiveOmitCredentials.checked = Boolean(stored.archiveOmitCredentials);
  }
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
    highlightColor: els.setHighlightColor.value,
    currentHighlightColor: els.setCurrentColor.value,
    annotationColor: els.setAnnotationColor.value,
    annotationActiveColor: els.setAnnotationActiveColor.value,
    annotationStyle: getAnnotationStyle(),
    annotationPopupTheme: getAnnotationPopupTheme(),
    annotationPopupBg: els.setAnnotationPopupBg.value,
    annotationPopupText: els.setAnnotationPopupText.value,
    annotationPopupMuted: els.setAnnotationPopupMuted.value,
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
    excludeSelectors: selectors,
    archiveScrollStepDelayMs: Number(els.setArchiveScrollDelay?.value) || WS_DEFAULTS.archiveScrollStepDelayMs,
    archivePrepareTimeoutMs: Number(els.setArchivePrepareTimeout?.value) || WS_DEFAULTS.archivePrepareTimeoutMs,
    archiveOmitCredentials: Boolean(els.setArchiveOmitCredentials?.checked)
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

const ABOUT_I18N = {
  ru: {
    title: 'О нас',
    desc: 'Версия расширения, лицензия и наша миссия.',
    versionLabel: 'Версия',
    licenseLabel: 'Лицензия',
    missionTitle: 'Миссия',
    missionDesc: 'Текст доступен на трёх языках.',
    langGroup: 'Язык текста',
    paragraphs: [
      'Сегодня крупнейшие корпорации и научные издательства возводят цифровые стены, требуя плату за доступ к знаниям. Актуальные научные открытия, медицинские исследования и важнейшие данные человечества становятся роскошью, доступной лишь избранным.',
      'Это в корне неверно. Знание не должно быть товаром. Оно не принадлежит корпорациям — оно принадлежит всему человечеству.',
      'Мы глубоко убеждены: право на информацию фундаментально. Доступ к знаниям должен быть открыт для каждого человека на Земле — независимо от его бюджета, национальности, происхождения или географии. Границы и кошельки не должны определять, насколько человек может быть образован и свободен.',
      'У нас нет многомиллионных бюджетов, чтобы разрушить эти стены в одиночку.',
      'Но у нас есть общая цель и технологии.',
      'Наше небольшое расширение позволит просто удобно читать статьи в интернете. Просматривать, аннотировать, читать и даже сохранять.'
    ]
  },
  en: {
    title: 'About us',
    desc: 'Extension version, license, and our mission.',
    versionLabel: 'Version',
    licenseLabel: 'License',
    missionTitle: 'Mission',
    missionDesc: 'This text is available in three languages.',
    langGroup: 'Text language',
    paragraphs: [
      'Today the largest corporations and scientific publishers erect digital walls, demanding payment for access to knowledge. Current scientific discoveries, medical research, and humanity’s most important data are becoming a luxury available only to a chosen few.',
      'This is fundamentally wrong. Knowledge must not be a commodity. It does not belong to corporations — it belongs to all of humanity.',
      'We firmly believe that the right to information is fundamental. Access to knowledge must be open to every person on Earth — regardless of budget, nationality, origin, or geography. Borders and wallets must not decide how educated and free a person can be.',
      'We do not have multimillion-dollar budgets to tear these walls down alone.',
      'But we share a common goal and the technology.',
      'Our small extension lets you conveniently read articles on the internet — browse, annotate, read, and even save them.'
    ]
  },
  uk: {
    title: 'Про нас',
    desc: 'Версія розширення, ліцензія та наша місія.',
    versionLabel: 'Версія',
    licenseLabel: 'Ліцензія',
    missionTitle: 'Місія',
    missionDesc: 'Текст доступний трьома мовами.',
    langGroup: 'Мова тексту',
    paragraphs: [
      'Сьогодні найбільші корпорації та наукові видавництва зводять цифрові стіни, вимагаючи плату за доступ до знань. Актуальні наукові відкриття, медичні дослідження та найважливіші дані людства стають розкішшю, доступною лише обраним.',
      'Це докорінно неправильно. Знання не повинно бути товаром. Воно не належить корпораціям — воно належить усьому людству.',
      'Ми глибоко переконані: право на інформацію є фундаментальним. Доступ до знань має бути відкритим для кожної людини на Землі — незалежно від її бюджету, національності, походження чи географії. Кордони та гаманці не повинні визначати, наскільки людина може бути освіченою і вільною.',
      'У нас немає багатомільйонних бюджетів, щоб зруйнувати ці стіни наодинці.',
      'Але у нас є спільна мета і технології.',
      'Наше невелике розширення дозволить просто зручно читати статті в інтернеті. Переглядати, анотувати, читати і навіть зберігати.'
    ]
  }
};

let aboutLang = 'ru';

function setAboutLang(lang) {
  const locale = ABOUT_I18N[lang] ? lang : 'ru';
  aboutLang = locale;
  const copy = ABOUT_I18N[locale];

  const title = $('about-title');
  const desc = $('about-desc');
  const versionLabel = $('about-version-label');
  const licenseLabel = $('about-license-label');
  const missionTitle = $('about-mission-title');
  const missionDesc = $('about-mission-desc');
  const missionText = $('about-mission-text');
  const langGroup = document.querySelector('.about-lang-switch');

  if (title) title.textContent = copy.title;
  if (desc) desc.textContent = copy.desc;
  if (versionLabel) versionLabel.textContent = copy.versionLabel;
  if (licenseLabel) licenseLabel.textContent = copy.licenseLabel;
  if (missionTitle) missionTitle.textContent = copy.missionTitle;
  if (missionDesc) missionDesc.textContent = copy.missionDesc;
  if (langGroup) langGroup.setAttribute('aria-label', copy.langGroup);

  if (missionText) {
    missionText.lang = locale;
    missionText.replaceChildren(
      ...copy.paragraphs.map((text) => {
        const p = document.createElement('p');
        p.textContent = text;
        return p;
      })
    );
  }

  document.querySelectorAll('.about-lang-btn').forEach((btn) => {
    const active = btn.dataset.aboutLang === locale;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function initAbout() {
  const versionEl = $('about-version');
  try {
    const manifest = chrome.runtime.getManifest();
    if (versionEl) versionEl.textContent = manifest.version || '—';
  } catch {
    if (versionEl) versionEl.textContent = '—';
  }

  document.querySelectorAll('.about-lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => setAboutLang(btn.dataset.aboutLang));
  });

  setAboutLang(aboutLang);
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

  if (sectionId === 'archive') {
    loadArchiveUi().catch(() => {});
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatArchiveDate(ts) {
  try {
    return new Date(ts).toLocaleString('ru-RU');
  } catch {
    return '';
  }
}

function archiveStageLabel(stage) {
  const labels = {
    loading: 'Загрузка страницы…',
    prepare: 'Подготовка страницы…',
    collect: 'Сбор содержимого…',
    build: 'Создание архива…',
    download: 'Скачивание…',
    done: 'Готово'
  };
  return labels[stage] || stage;
}

const ARCHIVE_STAGE_PROGRESS = {
  loading: 10,
  prepare: 25,
  collect: 45,
  build: 70,
  download: 90,
  done: 100
};

let archiveSaveInProgress = false;
let archiveOpenSelectedFile = null;

function normalizeArchiveInputUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function setArchiveSaveProgress(stage) {
  if (!els.archiveSaveProgressWrap) return;
  els.archiveSaveProgressWrap.hidden = false;
  if (els.archiveSaveProgressLabel) {
    els.archiveSaveProgressLabel.textContent = archiveStageLabel(stage);
  }
  if (els.archiveSaveProgressBar) {
    els.archiveSaveProgressBar.classList.remove('is-error');
    els.archiveSaveProgressBar.style.width = `${ARCHIVE_STAGE_PROGRESS[stage] ?? 0}%`;
  }
}

function resetArchiveSaveModal() {
  archiveSaveInProgress = false;
  if (els.archiveSaveUrl) els.archiveSaveUrl.value = '';
  if (els.archiveSaveError) {
    els.archiveSaveError.hidden = true;
    els.archiveSaveError.textContent = '';
  }
  if (els.archiveSaveProgressWrap) els.archiveSaveProgressWrap.hidden = true;
  if (els.archiveSaveProgressBar) {
    els.archiveSaveProgressBar.style.width = '0%';
    els.archiveSaveProgressBar.classList.remove('is-error');
  }
  if (els.archiveSaveSubmit) els.archiveSaveSubmit.disabled = false;
  if (els.archiveSaveCancel) els.archiveSaveCancel.disabled = false;
}

function openArchiveSaveModal() {
  resetArchiveSaveModal();
  if (!els.archiveSaveModal) return;
  els.archiveSaveModal.hidden = false;
  els.archiveSaveUrl?.focus();
}

function closeArchiveSaveModal() {
  if (archiveSaveInProgress) return;
  if (els.archiveSaveModal) els.archiveSaveModal.hidden = true;
  resetArchiveSaveModal();
}

function showArchiveSaveError(message) {
  if (els.archiveSaveError) {
    els.archiveSaveError.hidden = false;
    els.archiveSaveError.textContent = message;
  }
  if (els.archiveSaveProgressBar) {
    els.archiveSaveProgressBar.classList.add('is-error');
  }
  archiveSaveInProgress = false;
  if (els.archiveSaveSubmit) els.archiveSaveSubmit.disabled = false;
  if (els.archiveSaveCancel) els.archiveSaveCancel.disabled = false;
}

async function submitArchiveSave() {
  if (archiveSaveInProgress) return;

  const url = normalizeArchiveInputUrl(els.archiveSaveUrl?.value);
  if (!url || isArchiveRestrictedUrl(url)) {
    showArchiveSaveError('Укажите корректный адрес страницы (http или https).');
    return;
  }

  archiveSaveInProgress = true;
  if (els.archiveSaveError) els.archiveSaveError.hidden = true;
  if (els.archiveSaveSubmit) els.archiveSaveSubmit.disabled = true;
  if (els.archiveSaveCancel) els.archiveSaveCancel.disabled = true;
  setArchiveSaveProgress('loading');

  const response = await runtimeMessage('ARCHIVE_PAGE_URL', { url });
  if (!response?.ok) {
    showArchiveSaveError(response?.message || response?.error || 'Не удалось сохранить страницу.');
    return;
  }

  setArchiveSaveProgress('done');
  archiveSaveInProgress = false;
  await loadArchiveUi();
  if (els.archiveSaveModal) els.archiveSaveModal.hidden = true;
  resetArchiveSaveModal();
}

function setArchiveOpenProgress(percent, label, isError = false) {
  if (!els.archiveOpenProgressWrap) return;
  els.archiveOpenProgressWrap.hidden = false;
  if (els.archiveOpenProgressLabel && label) {
    els.archiveOpenProgressLabel.textContent = label;
  }
  if (els.archiveOpenProgressBar) {
    els.archiveOpenProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    els.archiveOpenProgressBar.classList.toggle('is-error', isError);
  }
}

function resetArchiveOpenModal() {
  archiveOpenSelectedFile = null;
  if (els.archiveOpenFile) els.archiveOpenFile.value = '';
  if (els.archiveOpenFilename) {
    els.archiveOpenFilename.hidden = true;
    els.archiveOpenFilename.textContent = '';
  }
  if (els.archiveOpenError) {
    els.archiveOpenError.hidden = true;
    els.archiveOpenError.textContent = '';
  }
  if (els.archiveOpenProgressWrap) els.archiveOpenProgressWrap.hidden = true;
  if (els.archiveOpenProgressBar) {
    els.archiveOpenProgressBar.style.width = '0%';
    els.archiveOpenProgressBar.classList.remove('is-error');
  }
  if (els.archiveDropzone) els.archiveDropzone.classList.remove('is-dragover');
  if (els.archiveOpenSubmit) els.archiveOpenSubmit.disabled = true;
  if (els.archiveOpenCancel) els.archiveOpenCancel.disabled = false;
}

function openArchiveOpenModal() {
  resetArchiveOpenModal();
  if (!els.archiveOpenModal) return;
  els.archiveOpenModal.hidden = false;
  els.archiveDropzone?.focus();
}

function closeArchiveOpenModal() {
  if (els.archiveOpenModal) els.archiveOpenModal.hidden = true;
  resetArchiveOpenModal();
}

function isZipFile(file) {
  if (!file) return false;
  const name = (file.name || '').toLowerCase();
  return name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

function selectArchiveOpenFile(file) {
  if (!isZipFile(file)) {
    if (els.archiveOpenError) {
      els.archiveOpenError.hidden = false;
      els.archiveOpenError.textContent = 'Выберите файл в формате .zip';
    }
    archiveOpenSelectedFile = null;
    if (els.archiveOpenSubmit) els.archiveOpenSubmit.disabled = true;
    return;
  }

  archiveOpenSelectedFile = file;
  if (els.archiveOpenError) els.archiveOpenError.hidden = true;
  if (els.archiveOpenFilename) {
    els.archiveOpenFilename.hidden = false;
    els.archiveOpenFilename.textContent = file.name;
  }
  if (els.archiveOpenSubmit) els.archiveOpenSubmit.disabled = false;
}

function showArchiveOpenError(message) {
  if (els.archiveOpenError) {
    els.archiveOpenError.hidden = false;
    els.archiveOpenError.textContent = message;
  }
  setArchiveOpenProgress(100, message, true);
  if (els.archiveOpenSubmit) els.archiveOpenSubmit.disabled = false;
  if (els.archiveOpenCancel) els.archiveOpenCancel.disabled = false;
}

async function submitArchiveOpen() {
  const file = archiveOpenSelectedFile;
  if (!file) return;

  if (els.archiveOpenSubmit) els.archiveOpenSubmit.disabled = true;
  if (els.archiveOpenCancel) els.archiveOpenCancel.disabled = true;
  if (els.archiveOpenError) els.archiveOpenError.hidden = true;
  setArchiveOpenProgress(10, 'Чтение файла…');

  try {
    const buffer = await file.arrayBuffer();
    const zipBytes = WSArchiveBytes.normalizeZipBytes(buffer);
    if (!zipBytes?.byteLength) {
      showArchiveOpenError('Пустой файл архива');
      return;
    }
    if (!WSArchiveBytes.isZipBytes(zipBytes)) {
      showArchiveOpenError('Повреждённый архив: файл не является ZIP');
      return;
    }

    setArchiveOpenProgress(50, 'Сохранение в кэш…');
    const id = `pick-${crypto.randomUUID()}`;
    await WSArchiveCache.put(id, zipBytes, {
      savedAt: Date.now(),
      title: file.name.replace(/\.zip$/i, '') || 'Офлайн-страница',
      filename: file.name
    });

    setArchiveOpenProgress(80, 'Открытие архива…');
    const response = await runtimeMessage('ARCHIVE_OPEN', { id });
    if (!response?.ok) {
      showArchiveOpenError(response?.error || 'Не удалось открыть архив');
      return;
    }

    setArchiveOpenProgress(100, 'Готово');
    closeArchiveOpenModal();
  } catch (err) {
    showArchiveOpenError(err.message || 'Не удалось открыть архив');
  }
}

async function clearArchiveJournal() {
  const confirmed = confirm('Удалить все записи журнала? Файлы на диске не удаляются.');
  if (!confirmed) return;

  await runtimeMessage('ARCHIVE_JOURNAL_CLEAR');
  await loadArchiveUi();
}

async function runtimeMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) resolve({ ok: false, error: err.message });
      else resolve(response || { ok: false });
    });
  });
}

function isArchiveRestrictedUrl(url) {
  if (!url) return true;
  if (url.includes('/reader/reader.html')) return true;
  return url.startsWith('chrome://')
    || url.startsWith('edge://')
    || url.startsWith('about:')
    || url.startsWith('chrome-extension://')
    || url.startsWith('moz-extension://');
}

async function loadArchiveUi() {
  const [listResponse, statsResponse] = await Promise.all([
    runtimeMessage('ARCHIVE_JOURNAL_LIST'),
    runtimeMessage('ARCHIVE_JOURNAL_STATS')
  ]);

  const entries = listResponse?.entries || [];

  if (els.archiveStats) {
    const stats = statsResponse?.stats || { count: entries.length, totalBytes: 0 };
    els.archiveStats.textContent = `${stats.count} сохранений в журнале · ~${formatBytes(stats.totalBytes)} суммарно`;
  }

  if (!els.archiveList || !els.archiveEmpty) return;

  els.archiveList.innerHTML = '';
  els.archiveEmpty.hidden = entries.length > 0;

  for (const entry of entries) {
    const card = document.createElement('article');
    card.className = 'archive-item';

    const title = document.createElement('h3');
    title.className = 'archive-item-title';
    title.textContent = entry.title || 'Без названия';

    const meta = document.createElement('p');
    meta.className = 'archive-item-meta';
    meta.textContent = `${formatArchiveDate(entry.savedAt)} · ${formatBytes(entry.sizeBytes)} · ${entry.filename || 'page.zip'}`;

    const link = document.createElement('a');
    link.className = 'archive-item-url';
    link.href = entry.url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = entry.url || '—';

    const warnings = document.createElement('p');
    warnings.className = 'archive-item-warnings';
    if (entry.warnings?.length) {
      warnings.textContent = entry.warnings.slice(0, 3).join(' · ');
    } else {
      warnings.hidden = true;
    }

    const actions = document.createElement('div');
    actions.className = 'archive-item-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-text archive-delete-btn';
    deleteBtn.textContent = 'Удалить из списка';
    deleteBtn.title = 'Файл на диске не удаляется';
    deleteBtn.addEventListener('click', async () => {
      deleteBtn.disabled = true;
      await runtimeMessage('ARCHIVE_JOURNAL_DELETE', { id: entry.id });
      await loadArchiveUi();
    });

    actions.appendChild(deleteBtn);
    card.append(title, meta, link, warnings, actions);
    els.archiveList.appendChild(card);
  }

  if (els.archiveClearJournal) {
    els.archiveClearJournal.disabled = entries.length === 0;
  }
}

async function onArchiveOpenFileSelected(event) {
  const file = event.target.files?.[0];
  if (file) selectArchiveOpenFile(file);
}

function bindArchive() {
  els.archiveSaveCurrent?.addEventListener('click', openArchiveSaveModal);
  els.archiveSaveCancel?.addEventListener('click', closeArchiveSaveModal);
  els.archiveSaveSubmit?.addEventListener('click', () => {
    submitArchiveSave().catch((err) => {
      showArchiveSaveError(err.message || 'Ошибка сохранения');
    });
  });
  els.archiveSaveUrl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitArchiveSave().catch((err) => {
        showArchiveSaveError(err.message || 'Ошибка сохранения');
      });
    }
  });

  els.archiveOpenBtn?.addEventListener('click', openArchiveOpenModal);
  els.archiveOpenCancel?.addEventListener('click', closeArchiveOpenModal);
  els.archiveOpenSubmit?.addEventListener('click', () => {
    submitArchiveOpen().catch((err) => {
      showArchiveOpenError(err.message || 'Не удалось открыть архив');
    });
  });
  els.archiveOpenPick?.addEventListener('click', (event) => {
    event.stopPropagation();
    els.archiveOpenFile?.click();
  });
  els.archiveOpenFile?.addEventListener('change', onArchiveOpenFileSelected);

  els.archiveDropzone?.addEventListener('click', (event) => {
    if (event.target === els.archiveOpenPick) return;
    els.archiveOpenFile?.click();
  });
  els.archiveDropzone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      els.archiveOpenFile?.click();
    }
  });
  els.archiveDropzone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.archiveDropzone?.classList.add('is-dragover');
  });
  els.archiveDropzone?.addEventListener('dragleave', () => {
    els.archiveDropzone?.classList.remove('is-dragover');
  });
  els.archiveDropzone?.addEventListener('drop', (event) => {
    event.preventDefault();
    els.archiveDropzone?.classList.remove('is-dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) selectArchiveOpenFile(file);
  });

  els.archiveClearJournal?.addEventListener('click', () => {
    clearArchiveJournal().catch(() => {});
  });

  document.querySelectorAll('[data-archive-modal-close]').forEach((el) => {
    el.addEventListener('click', () => {
      const target = el.getAttribute('data-archive-modal-close');
      if (target === 'save') closeArchiveSaveModal();
      if (target === 'open') closeArchiveOpenModal();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (els.archiveSaveModal && !els.archiveSaveModal.hidden) closeArchiveSaveModal();
    if (els.archiveOpenModal && !els.archiveOpenModal.hidden) closeArchiveOpenModal();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'ARCHIVE_PROGRESS' || !archiveSaveInProgress) return;
    if (message.stage === 'done') {
      setArchiveSaveProgress('done');
      loadArchiveUi().catch(() => {});
      return;
    }
    if (message.stage) {
      setArchiveSaveProgress(message.stage);
    }
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
    if (input.id === 'set-whole') return;
    if (input.id === 'clipper-field-note') return;
    if (input.id === 'clipper-field-url') return;
    if (input.id === 'clipper-field-title') return;
    if (input.id === 'clipper-field-date') return;
    if (input.id === 'clipper-custom') return;
    if (input.id === 'set-annotation-save-template') return;
    if (input.id === 'settings-import-file') return;
    if (input.id === 'archive-save-url') return;
    if (input.id === 'archive-open-file') return;
    if (input.name === 'matchMode' || input.name === 'phraseMode' || input.name === 'annotationStyle' || input.name === 'annotationSaveFormat' || input.name === 'annotationPopupTheme') return;
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
    bindSync();
    bindClipper();
    bindLiterature();
    bindDictionary();
    bindArchive();
    initAbout();
    await loadDictionaryUi();
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
