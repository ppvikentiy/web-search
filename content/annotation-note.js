/**
 * Annotation notes UI: click menu, inline editor, hover popover.
 */
if (globalThis.WSAnnotationNote?.destroy) {
  try { globalThis.WSAnnotationNote.destroy(); } catch { /* stale instance */ }
}
globalThis.WSAnnotationNote = (() => {
  const MARK_CLASS = 'ws-annotation';
  const ID_ATTR = 'data-ws-annotation-id';

  let callbacks = {};
  let destroyed = false;
  let menuEl = null;
  let popoverEl = null;
  let activeGroupId = null;
  let menuOpen = false;
  let editorOpen = false;
  let clickHandler = null;
  let hoverShowTimer = null;
  let hoverHideTimer = null;
  let hoverGroupId = null;
  let outsideClickHandler = null;
  let keydownHandler = null;

  function getMarkGroupId(mark) {
    return mark?.getAttribute?.(ID_ATTR) || null;
  }

  function getFirstMarkForGroup(id) {
    return WSAnnotations.getFirstMarkForGroup(id);
  }

  function positionNearRect(el, rect, preferAbove = true) {
    const margin = 8;
    el.style.left = '0';
    el.style.top = '0';
    el.hidden = false;

    const elRect = el.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - elRect.width / 2;
    left = Math.max(margin, Math.min(window.innerWidth - elRect.width - margin, left));

    let top;
    if (preferAbove) {
      top = rect.top - elRect.height - margin;
      if (top < margin) {
        top = rect.bottom + margin;
      }
    } else {
      top = rect.bottom + margin;
      if (top + elRect.height > window.innerHeight - margin) {
        top = rect.top - elRect.height - margin;
      }
    }

    el.style.left = `${left}px`;
    el.style.top = `${Math.max(margin, top)}px`;
  }

  function closeMenu() {
    if (menuEl) menuEl.hidden = true;
    menuOpen = false;
    editorOpen = false;
    activeGroupId = null;
    detachGlobalDismiss();
  }

  function closePopover() {
    if (popoverEl) popoverEl.hidden = true;
    hoverGroupId = null;
    if (!menuOpen) editorOpen = false;
  }

  function closeAll() {
    closeMenu();
    closePopover();
  }

  function attachGlobalDismiss() {
    if (outsideClickHandler) return;

    outsideClickHandler = (e) => {
      if (menuEl?.contains(e.target)) return;
      if (popoverEl?.contains(e.target)) return;
      closeMenu();
    };

    document.addEventListener('mousedown', outsideClickHandler, true);
  }

  function detachGlobalDismiss() {
    if (outsideClickHandler) {
      document.removeEventListener('mousedown', outsideClickHandler, true);
      outsideClickHandler = null;
    }
  }

  function buildMenu() {
    menuEl = document.createElement('div');
    menuEl.className = 'ws-ann-menu';
    menuEl.hidden = true;
    menuEl.setAttribute('role', 'menu');
    WSDomUtils.decorateExtensionUi?.(menuEl);
    document.documentElement.appendChild(menuEl);
  }

  function buildPopover() {
    popoverEl = document.createElement('div');
    popoverEl.className = 'ws-ann-popover';
    popoverEl.hidden = true;
    popoverEl.addEventListener('mouseenter', cancelHidePopover);
    popoverEl.addEventListener('mouseleave', scheduleHidePopover);
    WSDomUtils.decorateExtensionUi?.(popoverEl);
    document.documentElement.appendChild(popoverEl);
  }

  function appendMenuButton(actions, className, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.setAttribute('role', 'menuitem');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(btn);
    });
    actions.appendChild(btn);
    return btn;
  }

  function fillAnnotationMenuActions(actions, id, meta) {
    const hasNote = Boolean(meta.note);
    const btnClass = 'ws-ann-menu-btn';
    const dangerClass = 'ws-ann-menu-btn ws-ann-menu-btn-danger';

    appendMenuButton(actions, btnClass, hasNote ? 'Редактировать заметку' : 'Добавить заметку', () => {
      openNoteEditor(id, meta.note || '');
    });
    appendMenuButton(actions, btnClass, 'Экспорт цитаты', () => {
      saveAnnotation(id);
      closeMenu();
    });
    appendMenuButton(actions, btnClass, 'Копировать как библиографическую ссылку', (btn) => {
      copyBibliography(id, btn);
    });
    appendMenuButton(actions, btnClass, 'Экспортировать как литературу', (btn) => {
      saveLiterature(id, btn);
    });
    appendMenuButton(actions, dangerClass, 'Удалить аннотацию', () => {
      callbacks.removeGroup?.(id);
      closeAll();
      callbacks.onChange?.();
    });
  }

  function renderMenuActions(id) {
    const meta = callbacks.getMeta?.(id) || { note: '' };

    menuEl.innerHTML = '';

    const actions = document.createElement('div');
    actions.className = 'ws-ann-menu-actions';
    fillAnnotationMenuActions(actions, id, meta);
    menuEl.appendChild(actions);
  }

  function showEditor(id, initialText = '') {
    editorOpen = true;
    menuEl.innerHTML = '';

    const editor = document.createElement('div');
    editor.className = 'ws-ann-note-editor';
    WSDomUtils.decorateExtensionUi?.(editor);

    const textarea = document.createElement('textarea');
    textarea.className = 'ws-ann-note-textarea';
    textarea.placeholder = 'Текст заметки…';
    textarea.value = initialText;
    textarea.rows = 3;

    const actions = document.createElement('div');
    actions.className = 'ws-ann-note-actions';

    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'ws-ann-note-btn ws-ann-note-btn-primary';
    btnSave.textContent = 'Сохранить';

    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'ws-ann-note-btn';
    btnCancel.textContent = 'Отмена';

    btnSave.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.setNote?.(id, textarea.value);
      closeMenu();
      callbacks.onChange?.();
    });

    btnCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
    });

    actions.append(btnCancel, btnSave);
    editor.append(textarea, actions);
    menuEl.appendChild(editor);

    const mark = getFirstMarkForGroup(id);
    if (mark) {
      positionNearRect(menuEl, mark.getBoundingClientRect(), true);
    }

    textarea.focus();
  }

  function showMenu(id, anchorRect) {
    if (!menuEl) buildMenu();

    activeGroupId = id;
    menuOpen = true;
    editorOpen = false;
    closePopover();

    renderMenuActions(id);
    positionNearRect(menuEl, anchorRect, true);
    attachGlobalDismiss();
  }

  function openNoteEditor(id, initialText = '') {
    if (!menuEl) buildMenu();

    activeGroupId = id;
    menuOpen = true;
    closePopover();
    showEditor(id, initialText);
    attachGlobalDismiss();
  }

  function getPageUrlForExport() {
    const readerSource = document.documentElement.dataset.wsReaderSourceUrl;
    return (readerSource || location.href).split('#')[0];
  }

  function getPageSourceMeta() {
    const fromReader = callbacks.getSourceMeta?.();
    if (fromReader) {
      return {
        url: fromReader.url || getPageUrlForExport(),
        title: fromReader.title || '',
        author: fromReader.author || '',
        published: fromReader.published || '',
        site: fromReader.site || '',
        date: new Date()
      };
    }

    const extracted = globalThis.WSPageMeta?.extract?.(document) || {};
    return {
      url: getPageUrlForExport(),
      title: extracted.title || document.title || '',
      author: extracted.author || '',
      published: extracted.published || '',
      site: extracted.site || '',
      date: new Date()
    };
  }

  function saveAnnotation(id) {
    const meta = callbacks.getMeta?.(id) || { note: '' };
    const settings = callbacks.getSettings?.() || WS_DEFAULTS;
    const source = getPageSourceMeta();
    WSAnnotationExport.downloadAnnotation({
      text: WSAnnotations.getGroupText(id),
      note: meta.note || '',
      url: source.url,
      title: source.title,
      author: source.author,
      site: source.site,
      published: source.published,
      date: source.date
    }, settings);
  }

  async function copyBibliography(id, buttonEl) {
    const exporter = globalThis.WSLiteratureExport;
    if (!exporter) {
      if (buttonEl) {
        const originalText = buttonEl.textContent;
        buttonEl.textContent = 'Перезагрузите страницу';
        setTimeout(() => {
          buttonEl.textContent = originalText;
        }, 1500);
      }
      return;
    }

    const settings = callbacks.getSettings?.() || WS_DEFAULTS;
    const ok = await exporter.copyLiterature(getPageSourceMeta(), settings);
    if (!buttonEl) return;

    const originalText = buttonEl.textContent;
    buttonEl.textContent = ok ? 'Скопировано' : 'Не удалось скопировать';
    setTimeout(() => {
      buttonEl.textContent = originalText;
    }, 1500);
  }

  function saveLiterature(id, buttonEl) {
    const exporter = globalThis.WSLiteratureExport;
    if (!exporter) {
      if (buttonEl) {
        const originalText = buttonEl.textContent;
        buttonEl.textContent = 'Перезагрузите страницу';
        setTimeout(() => {
          buttonEl.textContent = originalText;
        }, 1500);
      }
      return;
    }

    const settings = callbacks.getSettings?.() || WS_DEFAULTS;
    const meta = callbacks.getMeta?.(id) || { note: '' };
    exporter.downloadLiterature({
      ...getPageSourceMeta(),
      text: WSAnnotations.getGroupText(id),
      note: meta.note || ''
    }, settings);

    if (!buttonEl) return;

    const originalText = buttonEl.textContent;
    buttonEl.textContent = 'Сохранено';
    setTimeout(() => {
      buttonEl.textContent = originalText;
    }, 1500);
  }

  function positionPopoverNearGroup(id) {
    const mark = getFirstMarkForGroup(id);
    if (!mark?.isConnected) {
      closePopover();
      return false;
    }
    hoverGroupId = id;
    positionNearRect(popoverEl, mark.getBoundingClientRect(), true);
    return true;
  }

  function showPopoverEditor(id, initialText = '') {
    if (!popoverEl) buildPopover();

    editorOpen = true;
    popoverEl.innerHTML = '';

    const editor = document.createElement('div');
    editor.className = 'ws-ann-note-editor';
    WSDomUtils.decorateExtensionUi?.(editor);

    const textarea = document.createElement('textarea');
    textarea.className = 'ws-ann-note-textarea';
    textarea.placeholder = 'Текст заметки…';
    textarea.value = initialText;
    textarea.rows = 3;

    const actions = document.createElement('div');
    actions.className = 'ws-ann-note-actions';

    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'ws-ann-note-btn ws-ann-note-btn-primary';
    btnSave.textContent = 'Сохранить';

    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'ws-ann-note-btn';
    btnCancel.textContent = 'Отмена';

    btnSave.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.setNote?.(id, textarea.value);
      editorOpen = false;
      callbacks.onChange?.();
      renderPopover(id);
    });

    btnCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      editorOpen = false;
      renderPopover(id);
    });

    actions.append(btnCancel, btnSave);
    editor.append(textarea, actions);
    popoverEl.appendChild(editor);

    if (!positionPopoverNearGroup(id)) return;

    textarea.focus();
  }

  function renderPopover(id) {
    const meta = callbacks.getMeta?.(id) || { note: '' };
    const hasNote = Boolean(meta.note);

    if (!popoverEl) buildPopover();

    editorOpen = false;
    popoverEl.innerHTML = '';

    const fragments = [];

    if (hasNote) {
      const text = document.createElement('div');
      text.className = 'ws-ann-popover-text';
      text.textContent = meta.note;
      fragments.push(text);
    }

    const actions = document.createElement('div');
    actions.className = 'ws-ann-popover-actions';

    const btnNote = document.createElement('button');
    btnNote.type = 'button';
    btnNote.className = 'ws-ann-popover-btn';
    btnNote.textContent = hasNote ? 'Редактировать заметку' : 'Добавить заметку';
    btnNote.addEventListener('click', (e) => {
      e.stopPropagation();
      showPopoverEditor(id, meta.note || '');
    });

    const btnExport = document.createElement('button');
    btnExport.type = 'button';
    btnExport.className = 'ws-ann-popover-btn';
    btnExport.textContent = 'Экспорт цитаты';
    btnExport.addEventListener('click', (e) => {
      e.stopPropagation();
      saveAnnotation(id);
    });

    const btnCopyBib = document.createElement('button');
    btnCopyBib.type = 'button';
    btnCopyBib.className = 'ws-ann-popover-btn';
    btnCopyBib.textContent = 'Копировать как библиографическую ссылку';
    btnCopyBib.addEventListener('click', (e) => {
      e.stopPropagation();
      copyBibliography(id, btnCopyBib);
    });

    const btnSaveLit = document.createElement('button');
    btnSaveLit.type = 'button';
    btnSaveLit.className = 'ws-ann-popover-btn';
    btnSaveLit.textContent = 'Экспортировать как литературу';
    btnSaveLit.addEventListener('click', (e) => {
      e.stopPropagation();
      saveLiterature(id, btnSaveLit);
    });

    actions.append(btnNote, btnExport, btnCopyBib, btnSaveLit);

    if (hasNote) {
      const btnDelNote = document.createElement('button');
      btnDelNote.type = 'button';
      btnDelNote.className = 'ws-ann-popover-btn';
      btnDelNote.textContent = 'Удалить заметку';
      btnDelNote.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.deleteNote?.(id);
        callbacks.onChange?.();
        renderPopover(id);
      });
      actions.append(btnDelNote);
    }

    const btnDelAnn = document.createElement('button');
    btnDelAnn.type = 'button';
    btnDelAnn.className = 'ws-ann-popover-btn ws-ann-popover-btn-danger';
    btnDelAnn.textContent = 'Удалить аннотацию';
    btnDelAnn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.removeGroup?.(id);
      closePopover();
      callbacks.onChange?.();
    });
    actions.append(btnDelAnn);

    fragments.push(actions);
    popoverEl.append(...fragments);

    positionPopoverNearGroup(id);
  }

  function cancelHidePopover() {
    clearTimeout(hoverHideTimer);
  }

  function scheduleHidePopover() {
    clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(() => {
      if (menuOpen || editorOpen) return;
      closePopover();
    }, 150);
  }

  function onMarkMouseOver(e) {
    if (destroyed || menuOpen || editorOpen) return;

    const mark = e.target?.closest?.(`mark.${MARK_CLASS}`);
    if (!mark) return;

    const id = getMarkGroupId(mark);
    if (!id) return;

    clearTimeout(hoverHideTimer);
    clearTimeout(hoverShowTimer);

    hoverShowTimer = setTimeout(() => {
      if (menuOpen || editorOpen) return;
      renderPopover(id);
    }, 150);
  }

  function onMarkMouseOut(e) {
    const mark = e.target?.closest?.(`mark.${MARK_CLASS}`);
    if (!mark) return;

    const related = e.relatedTarget;
    if (related?.closest?.(`mark.${MARK_CLASS}[${ID_ATTR}="${getMarkGroupId(mark)}"]`)) return;
    if (related && popoverEl?.contains(related)) return;

    clearTimeout(hoverShowTimer);
    scheduleHidePopover();
  }

  function onMarkClick(e) {
    if (destroyed) return;

    const mark = e.target?.closest?.(`mark.${MARK_CLASS}`);
    if (!mark) return;

    if (!WSAnnotations.isAnnotationMode()) return;

    e.preventDefault();
    e.stopPropagation();

    const id = getMarkGroupId(mark);
    if (!id) return;

    const sel = window.getSelection();
    sel?.removeAllRanges?.();

    showMenu(id, mark.getBoundingClientRect());
  }

  function init(options = {}) {
    destroyed = false;
    callbacks = {
      onChange: options.onChange,
      getMeta: options.getMeta,
      getSettings: options.getSettings,
      getSourceMeta: options.getSourceMeta,
      setNote: options.setNote,
      deleteNote: options.deleteNote,
      removeGroup: options.removeGroup
    };

    if (!clickHandler) {
      clickHandler = onMarkClick;
      document.addEventListener('click', clickHandler, true);
    }

    if (!keydownHandler) {
      keydownHandler = (e) => {
        if (e.key === 'Escape') closeAll();
      };
      document.addEventListener('keydown', keydownHandler, true);
    }

    document.addEventListener('mouseover', onMarkMouseOver, true);
    document.addEventListener('mouseout', onMarkMouseOut, true);
  }

  function destroy() {
    destroyed = true;
    closeAll();

    if (clickHandler) {
      document.removeEventListener('click', clickHandler, true);
      clickHandler = null;
    }

    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }

    document.removeEventListener('mouseover', onMarkMouseOver, true);
    document.removeEventListener('mouseout', onMarkMouseOut, true);
    detachGlobalDismiss();

    clearTimeout(hoverShowTimer);
    clearTimeout(hoverHideTimer);

    menuEl?.remove();
    popoverEl?.remove();
    menuEl = null;
    popoverEl = null;
    callbacks = {};
  }

  return {
    init,
    destroy,
    closeAll
  };
})();
