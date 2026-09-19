/**

 * Floating annotation pill: drag handle, navigation, counter, expandable list.

 */

if (globalThis.WSAnnotationPill?.destroy) {

  try { globalThis.WSAnnotationPill.destroy(); } catch { /* stale instance */ }

}

globalThis.WSAnnotationPill = (() => {

  const PILL_ID = 'ws-annotation-pill';

  const PANEL_ID = 'ws-pill-panel';

  const POS_KEY = 'ws-pill-pos';

  const I = (name, size) => WSIcons.svg(name, size);



  let root = null;

  let barEl = null;

  let panelEl = null;

  let listEl = null;

  let dragHandle = null;

  let counterEl = null;

  let btnPrev = null;

  let btnNext = null;

  let btnToggle = null;

  let btnClose = null;

  let callbacks = {};

  let dragging = false;

  let dragOffset = { x: 0, y: 0 };

  let panelOpen = false;

  let activeId = null;



  function truncateText(text, max = 80) {

    const t = (text || '').replace(/\s+/g, ' ').trim();

    if (t.length <= max) return t;

    return `${t.slice(0, max - 1)}…`;

  }



  function loadPosition() {

    try {

      const raw = sessionStorage.getItem(POS_KEY);

      if (!raw) return null;

      return JSON.parse(raw);

    } catch {

      return null;

    }

  }



  function savePosition(left, top) {

    try {

      sessionStorage.setItem(POS_KEY, JSON.stringify({ left, top }));

    } catch {

      /* ignore */

    }

  }



  function applyDefaultPosition() {

    if (!root) return;

    root.style.left = '50%';

    root.style.top = '12px';

    root.style.transform = 'translateX(-50%)';

  }



  function applySavedPosition() {

    const pos = loadPosition();

    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') {

      applyDefaultPosition();

      return;

    }

    root.style.left = `${pos.left}px`;

    root.style.top = `${pos.top}px`;

    root.style.transform = 'none';

  }



  function setPanelOpen(open) {

    panelOpen = open;

    if (!panelEl || !btnToggle) return;



    panelEl.hidden = !open;

    btnToggle.setAttribute('aria-expanded', open ? 'true' : 'false');

    btnToggle.classList.toggle('ws-pill-toggle-open', open);

  }



  function togglePanel() {

    setPanelOpen(!panelOpen);

  }



  function onDragStart(e) {

    if (e.button !== 0) return;

    dragging = true;

    const rect = root.getBoundingClientRect();

    dragOffset.x = e.clientX - rect.left;

    dragOffset.y = e.clientY - rect.top;

    root.style.transform = 'none';

    e.preventDefault();

  }



  function onDragMove(e) {

    if (!dragging || !root) return;

    const left = Math.max(0, Math.min(window.innerWidth - root.offsetWidth, e.clientX - dragOffset.x));

    const top = Math.max(0, Math.min(window.innerHeight - root.offsetHeight, e.clientY - dragOffset.y));

    root.style.left = `${left}px`;

    root.style.top = `${top}px`;

  }



  function onDragEnd() {

    if (!dragging || !root) return;

    dragging = false;

    const left = parseFloat(root.style.left) || 0;

    const top = parseFloat(root.style.top) || 0;

    savePosition(left, top);

  }



  function iconBtn(className, title, iconName, size = 14) {

    const btn = document.createElement('button');

    btn.type = 'button';

    btn.className = className;

    btn.title = title;

    btn.setAttribute('aria-label', title);

    btn.innerHTML = I(iconName, size);

    return btn;

  }



  function buildPill() {

    root = document.createElement('div');

    root.id = PILL_ID;

    root.setAttribute('role', 'toolbar');

    root.setAttribute('aria-label', 'Навигация по аннотациям');



    barEl = document.createElement('div');

    barEl.className = 'ws-pill-bar';



    dragHandle = document.createElement('button');

    dragHandle.type = 'button';

    dragHandle.className = 'ws-pill-drag';

    dragHandle.title = 'Переместить';

    dragHandle.setAttribute('aria-label', 'Переместить панель');

    dragHandle.innerHTML = I('gripVertical', 14);



    btnPrev = iconBtn('ws-pill-btn ws-pill-prev', 'Предыдущая аннотация', 'chevronLeft');

    counterEl = document.createElement('span');

    counterEl.className = 'ws-pill-counter';

    counterEl.textContent = '0 из 0';

    btnNext = iconBtn('ws-pill-btn ws-pill-next', 'Следующая аннотация', 'chevronRight');

    btnToggle = iconBtn('ws-pill-btn ws-pill-toggle', 'Список аннотаций', 'chevronDown');

    btnToggle.setAttribute('aria-expanded', 'false');

    btnToggle.setAttribute('aria-controls', PANEL_ID);

    btnClose = iconBtn('ws-pill-btn ws-pill-close', 'Снять все выделения', 'x', 14);



    barEl.append(dragHandle, btnPrev, counterEl, btnNext, btnToggle, btnClose);



    panelEl = document.createElement('div');

    panelEl.id = PANEL_ID;

    panelEl.className = 'ws-pill-panel';

    panelEl.hidden = true;

    panelEl.setAttribute('role', 'listbox');

    panelEl.setAttribute('aria-label', 'Список аннотаций');



    listEl = document.createElement('div');

    listEl.className = 'ws-pill-list';

    panelEl.appendChild(listEl);



    root.append(barEl, panelEl);
    WSDomUtils.decorateExtensionUi?.(root);

    document.documentElement.appendChild(root);



    dragHandle.addEventListener('mousedown', onDragStart);

    document.addEventListener('mousemove', onDragMove);

    document.addEventListener('mouseup', onDragEnd);



    btnPrev.addEventListener('click', (e) => {

      e.stopPropagation();

      callbacks.onPrev?.();

    });



    btnNext.addEventListener('click', (e) => {

      e.stopPropagation();

      callbacks.onNext?.();

    });



    btnToggle.addEventListener('click', (e) => {

      e.stopPropagation();

      togglePanel();

      callbacks.onToggleList?.(panelOpen);

    });



    btnClose.addEventListener('click', (e) => {

      e.stopPropagation();

      setPanelOpen(false);

      callbacks.onClose?.();

    });

  }



  function renderList(items = [], currentActiveId = null) {

    if (!listEl) return;



    activeId = currentActiveId;

    listEl.innerHTML = '';



    if (!items.length) {

      const empty = document.createElement('div');

      empty.className = 'ws-pill-list-empty';

      empty.textContent = 'Нет аннотаций';

      listEl.appendChild(empty);

      return;

    }



    for (const item of items) {

      const row = document.createElement('button');

      row.type = 'button';

      row.className = 'ws-pill-list-item';

      row.setAttribute('role', 'option');

      row.dataset.id = item.id;



      if (item.id === activeId) {

        row.classList.add('ws-pill-list-item-active');

        row.setAttribute('aria-selected', 'true');

      } else {

        row.setAttribute('aria-selected', 'false');

      }



      const textEl = document.createElement('span');

      textEl.className = 'ws-pill-list-text';

      textEl.textContent = truncateText(item.text);



      row.appendChild(textEl);



      if (item.missing) {

        row.classList.add('ws-pill-list-item-missing');

        const missingLabel = document.createElement('span');

        missingLabel.className = 'ws-pill-list-missing';

        missingLabel.title = 'Текст не найден на странице';

        missingLabel.innerHTML = I('alertTriangle', 12);

        row.appendChild(missingLabel);

      } else if (item.hasNote) {

        const noteIcon = document.createElement('span');

        noteIcon.className = 'ws-pill-list-note';

        noteIcon.title = 'Есть заметка';

        noteIcon.innerHTML = I('penLine', 12);

        row.appendChild(noteIcon);

      }



      row.addEventListener('click', (e) => {

        e.stopPropagation();

        callbacks.onSelectItem?.(item.id);

      });



      listEl.appendChild(row);

    }

  }



  function init(options = {}) {

    callbacks = {

      onPrev: options.onPrev,

      onNext: options.onNext,

      onClose: options.onClose,

      onToggleList: options.onToggleList,

      onSelectItem: options.onSelectItem

    };



    if (!root) {

      buildPill();

    }



    root.hidden = true;

    setPanelOpen(false);

    applySavedPosition();

    updateCounter(0, 0);

    renderList([]);

  }



  function show() {

    if (!root) buildPill();

    root.hidden = false;

    applySavedPosition();

  }



  function hide() {

    if (root) {

      root.hidden = true;

      setPanelOpen(false);

    }

  }



  function updateCounter(current, total) {

    if (!counterEl) return;

    counterEl.textContent = `${current} из ${total}`;

    const disabled = total === 0;

    btnPrev.disabled = disabled;

    btnNext.disabled = disabled;

    if (btnToggle) btnToggle.disabled = disabled;

  }



  function resetPosition() {

    try {

      sessionStorage.removeItem(POS_KEY);

    } catch {

      /* ignore */

    }

    applyDefaultPosition();

  }



  function showMessage(text) {
    if (!root) buildPill();
    let status = root.querySelector('.ws-pill-status');
    if (!status) {
      status = document.createElement('p');
      status.className = 'ws-pill-status';
      status.setAttribute('role', 'status');
      root.appendChild(status);
    }
    status.textContent = text || '';
    status.hidden = !text;
    if (text) {
      clearTimeout(status._wsTimer);
      status._wsTimer = setTimeout(() => {
        status.textContent = '';
        status.hidden = true;
      }, 4000);
    }
  }

  function destroy() {

    document.removeEventListener('mousemove', onDragMove);

    document.removeEventListener('mouseup', onDragEnd);

    root?.remove();

    root = null;

    barEl = null;

    panelEl = null;

    listEl = null;

    dragHandle = null;

    counterEl = null;

    btnPrev = null;

    btnNext = null;

    btnToggle = null;

    btnClose = null;

    callbacks = {};

    panelOpen = false;

    activeId = null;

  }



  return {

    init,

    show,

    hide,

    updateCounter,

    renderList,

    resetPosition,

    showMessage,

    destroy

  };

})();


