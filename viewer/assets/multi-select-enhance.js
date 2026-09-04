/**
 * Smart custom multi-select modals:
 * - Compact trigger with dynamic selected text
 * - Real-time search filter
 * - Select All / OK / Cancel
 * Progressive enhancement for select[multiple] and [data-smart-dropdown]
 */
(function () {
  'use strict';

  function selectedLabels(select) {
    return Array.from(select.options)
      .filter(function (o) { return o.selected && o.value; })
      .map(function (o) { return o.textContent.trim(); });
  }

  function updateTriggerText(trigger, select, placeholder) {
    var labels = selectedLabels(select);
    var text = placeholder || 'اختر... ▾';
    if (labels.length === 1) text = labels[0] + ' ▾';
    else if (labels.length > 1) text = labels.slice(0, 2).join('، ') + (labels.length > 2 ? ' +' + (labels.length - 2) : '') + ' ▾';
    trigger.textContent = text;
    trigger.setAttribute('data-selected-count', String(labels.length));
  }

  function buildPanel(select) {
    if (select.dataset.msEnhanced === '1') return;
    select.dataset.msEnhanced = '1';

    select.style.position = 'absolute';
    select.style.opacity = '0';
    select.style.pointerEvents = 'none';
    select.style.width = '1px';
    select.style.height = '1px';

    var wrap = document.createElement('div');
    wrap.className = 'custom-dropdown-container smart-dropdown-container';
    wrap.style.position = 'relative';
    wrap.style.width = '100%';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    var placeholder = select.getAttribute('data-placeholder') || 'اختر... ▾';
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'teacher-select-trigger smart-dropdown-trigger';
    wrap.appendChild(trigger);

    var panel = document.createElement('div');
    panel.className = 'custom-dropdown-modal smart-dropdown-modal fet-ms-panel';
    panel.innerHTML =
      '<div class="dropdown-header fet-ms-header">' +
        '<label class="fet-ms-all-label"><input type="checkbox" class="fet-ms-all" /> تحديد الكل</label>' +
      '</div>' +
      '<div class="dropdown-search-wrap">' +
        '<input type="search" class="dropdown-search-input" placeholder="بحث..." autocomplete="off" />' +
      '</div>' +
      '<div class="dropdown-list fet-ms-list"></div>' +
      '<div class="dropdown-actions fet-ms-actions">' +
        '<button type="button" class="btn-cancel fet-ms-cancel">إلغاء</button>' +
        '<button type="button" class="btn-confirm fet-ms-ok">موافق</button>' +
      '</div>';
    wrap.appendChild(panel);

    var list = panel.querySelector('.fet-ms-list');
    var allCb = panel.querySelector('.fet-ms-all');
    var searchInput = panel.querySelector('.dropdown-search-input');
    var snapshot = [];

    function refreshList(filter) {
      list.innerHTML = '';
      var q = (filter || '').trim().toLowerCase();
      Array.from(select.options).forEach(function (opt, idx) {
        if (!opt.value && opt.disabled) return;
        var label = (opt.textContent || '').trim();
        if (q && label.toLowerCase().indexOf(q) === -1) return;
        var row = document.createElement('label');
        row.className = 'dropdown-item fet-ms-item';
        row.setAttribute('data-value', opt.value);
        var span = document.createElement('span');
        span.textContent = label;
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!opt.selected;
        cb.dataset.idx = String(idx);
        row.appendChild(span);
        row.appendChild(cb);
        list.appendChild(row);
      });
    }

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.custom-dropdown-modal.active').forEach(function (m) {
        if (m !== panel) m.classList.remove('active');
      });
      snapshot = Array.from(select.options).map(function (o) { return o.selected; });
      searchInput.value = '';
      refreshList('');
      panel.classList.toggle('active');
      if (panel.classList.contains('active')) {
        setTimeout(function () { searchInput.focus(); }, 30);
      }
    });

    searchInput.addEventListener('input', function () {
      refreshList(searchInput.value);
    });
    searchInput.addEventListener('click', function (e) { e.stopPropagation(); });

    allCb.addEventListener('change', function () {
      list.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
        cb.checked = allCb.checked;
      });
    });

    panel.querySelector('.fet-ms-ok').addEventListener('click', function () {
      // Apply only visible checkboxes; keep hidden (filtered-out) as-is
      var visible = {};
      list.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
        visible[cb.dataset.idx] = cb.checked;
      });
      Array.from(select.options).forEach(function (opt, i) {
        if (Object.prototype.hasOwnProperty.call(visible, String(i))) {
          opt.selected = !!visible[String(i)];
        }
      });
      select.dispatchEvent(new Event('change', { bubbles: true }));
      updateTriggerText(trigger, select, placeholder);
      panel.classList.remove('active');
    });

    panel.querySelector('.fet-ms-cancel').addEventListener('click', function () {
      Array.from(select.options).forEach(function (o, i) { o.selected = !!snapshot[i]; });
      panel.classList.remove('active');
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) panel.classList.remove('active');
    });

    updateTriggerText(trigger, select, placeholder);
  }

  function scan() {
    document.querySelectorAll('select[multiple]').forEach(buildPanel);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
  var obs = new MutationObserver(function () { scan(); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
