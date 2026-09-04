/**
 * Progressive enhancement: wrap native <select multiple> with a compact
 * trigger + modal panel matching the requested UX (Select All / OK / Cancel).
 * Safe no-op when no multi-selects exist.
 */
(function () {
  function buildPanel(select) {
    if (select.dataset.msEnhanced === '1') return;
    select.dataset.msEnhanced = '1';
    select.style.position = 'absolute';
    select.style.opacity = '0';
    select.style.pointerEvents = 'none';
    select.style.width = '1px';
    select.style.height = '1px';

    const wrap = document.createElement('div');
    wrap.className = 'custom-dropdown-container';
    wrap.style.position = 'relative';
    wrap.style.width = '100%';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'teacher-select-trigger';
    trigger.textContent = select.getAttribute('data-placeholder') || 'اختر... ▾';
    wrap.appendChild(trigger);

    const panel = document.createElement('div');
    panel.className = 'custom-dropdown-modal fet-ms-panel';
    panel.innerHTML =
      '<div class="dropdown-header fet-ms-header"><span>تحديد الكل</span><input type="checkbox" class="fet-ms-all" /></div>' +
      '<div class="dropdown-search-box fet-ms-search" style="padding:6px 8px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">' +
      '<input type="text" class="dropdown-search-input fet-ms-search-input" placeholder="بحث سريع..." style="width:100%;padding:6px 10px;font-size:0.8rem;border:1px solid #cbd5e1;border-radius:6px;outline:none;" />' +
      '</div>' +
      '<div class="dropdown-list fet-ms-list" style="max-height:190px;overflow-y:auto;padding:4px;"></div>' +
      '<div class="dropdown-actions fet-ms-actions">' +
      '<button type="button" class="btn-cancel fet-ms-cancel">إلغاء</button>' +
      '<button type="button" class="btn-confirm fet-ms-ok">موافق</button></div>';
    wrap.appendChild(panel);

    const list = panel.querySelector('.fet-ms-list');
    const allCb = panel.querySelector('.fet-ms-all');
    const searchInput = panel.querySelector('.fet-ms-search-input');
    let snapshot = [];

    function refreshList() {
      list.innerHTML = '';
      if (searchInput) searchInput.value = '';
      Array.from(select.options).forEach((opt, idx) => {
        if (!opt.value && opt.disabled) return;
        const row = document.createElement('label');
        row.className = 'dropdown-item fet-ms-item';
        const cb = document.createElement('input');
        cb.type = select.multiple ? 'checkbox' : 'radio';
        cb.checked = opt.selected;
        cb.dataset.idx = String(idx);
        const span = document.createElement('span');
        span.textContent = opt.textContent;
        row.appendChild(span);
        row.appendChild(cb);
        list.appendChild(row);
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        list.querySelectorAll('.fet-ms-item').forEach(item => {
          const txt = item.querySelector('span')?.textContent.toLowerCase() || '';
          item.style.display = txt.includes(q) ? 'flex' : 'none';
        });
      });
    }

    function updateTrigger() {
      const selected = Array.from(select.options).filter(o => o.selected && o.value);
      trigger.textContent = selected.length
        ? selected.map(o => o.textContent).slice(0, 3).join('، ') + (selected.length > 3 ? '…' : '')
        : (select.getAttribute('data-placeholder') || 'اختر... ▾');
    }

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.custom-dropdown-modal.active').forEach(m => {
        if (m !== panel) m.classList.remove('active');
      });
      snapshot = Array.from(select.options).map(o => o.selected);
      refreshList();
      panel.classList.toggle('active');
    });

    allCb.addEventListener('change', () => {
      list.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = allCb.checked; });
    });

    panel.querySelector('.fet-ms-ok').addEventListener('click', () => {
      list.querySelectorAll('input[type=checkbox]').forEach(cb => {
        const i = Number(cb.dataset.idx);
        if (select.options[i]) select.options[i].selected = cb.checked;
      });
      select.dispatchEvent(new Event('change', { bubbles: true }));
      updateTrigger();
      panel.classList.remove('active');
    });

    panel.querySelector('.fet-ms-cancel').addEventListener('click', () => {
      select.options.forEach((o, i) => { o.selected = !!snapshot[i]; });
      panel.classList.remove('active');
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) panel.classList.remove('active');
    });

    updateTrigger();
  }

  function scan() {
    document.querySelectorAll('select[multiple]').forEach(buildPanel);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
  // React mounts later
  const obs = new MutationObserver(() => scan());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
