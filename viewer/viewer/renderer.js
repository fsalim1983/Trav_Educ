// renderer.js — runs in the browser-like renderer process.
// Owns: parsing the .fet input file, parsing the solved *_activities.xml,
// building printable timetable grids (per group/teacher/room + combined),
// the vacant-rooms report, and the aSc Timetables XML export.

(function () {
  'use strict';

  // ===================== Small DOM/XML helpers =====================
  function txt(el, tag) {
    if (!el) return '';
    const n = el.getElementsByTagName(tag)[0];
    return n ? (n.textContent || '').trim() : '';
  }
  function allDirect(parent, tag) {
    if (!parent) return [];
    return Array.from(parent.children).filter(c => c.tagName === tag);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
  function setStatus(el, msg, type) {
    el.textContent = msg;
    el.className = 'status ' + (type || '');
  }

  // ===================== Application state =====================
  function defaultSettings() {
    return {
      institution: { name: '', municipality: '', wilaya: '', season: '', defaultWeeklyHours: 20, headerLines: ['', '', ''] },
      teacherAlias: {},  // originalName -> { display, hours, code }
      classAlias: {},    // originalName -> displayName
      roomAlias: {},     // originalName -> displayName
      subjectAlias: {},  // originalName -> displayName
      dayLabels: [],      // overrides realDayNames by index, if set
      periodLabels: [],   // overrides periodLabel() by (period-1) index, if set
      // V4.0: per-entity colors (one map per dimension), subject icons, and
      // the last-used engine paths so they survive an app restart.
      colors: { subjects: {}, teachers: {}, classes: {}, rooms: {} },
      subjectIcons: {},   // subjectName -> data URL (small uploaded icon)
      colorBy: 'subjects',
      colorsEnabled: true,
      fetClPath: '',
      outputDir: ''
    };
  }
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('fetAppSettings') || '{}'); } catch (e) { saved = {}; }
    return Object.assign(defaultSettings(), saved);
  }
  function saveSettingsToDisk() {
    localStorage.setItem('fetAppSettings', JSON.stringify(state.settings));
  }

  // Display-name helpers: apply the user's aliases from Settings wherever a
  // name is shown on screen or printed, WITHOUT ever touching the underlying
  // FET data. Falls back to the real name when no alias was set.
  function dispTeacher(name) { const a = state.settings.teacherAlias[name]; return (a && a.display) ? a.display : name; }
  function dispClass(name) { return state.settings.classAlias[name] || name; }
  function dispRoom(name) { return state.settings.roomAlias[name] || name; }
  function dispSubject(name) { return state.settings.subjectAlias[name] || name; }
  function dispDay(index) { return (state.settings.dayLabels && state.settings.dayLabels[index]) || (state.data && state.data.realDayNames[index]) || ''; }

  // ---- V4.0: per-entity colors ----
  // Auto-generates a soft pastel color the first time an entity is seen, so
  // the whole app is colorful by default with zero setup, while staying
  // fully user-customizable from the "الألوان" settings page.
  function generatePastelColor() {
    const hue = Math.floor(Math.random() * 360);
    return 'hsl(' + hue + ', 65%, 85%)';
  }
  function getEntityColor(dimension, name) {
    if (!name) return '';
    const map = state.settings.colors[dimension];
    if (!map[name]) {
      map[name] = generatePastelColor();
      saveSettingsToDisk();
    }
    return map[name];
  }
  // Resolves the color for one schedule entry according to the currently
  // selected coloring dimension (state.settings.colorBy).
  function colorForEntry(e) {
    if (!state.settings.colorsEnabled) return '';
    const by = state.settings.colorBy || 'subjects';
    if (by === 'subjects') return getEntityColor('subjects', e.subject);
    if (by === 'teachers') return getEntityColor('teachers', (e.teacher || '').split(' + ')[0]);
    if (by === 'rooms') return getEntityColor('rooms', (e.room || '').split(' + ')[0]);
    if (by === 'classes') {
      const g = (e.group || '').split(' + ')[0];
      return getEntityColor('classes', state.data && state.data.subgroupToClass[g] || g);
    }
    return '';
  }

  const state = {
    settings: loadSettings(),
    currentRunId: null,
    trackProgress: {},
    fetPath: null,
    fetDoc: null,          // parsed input .fet DOM
    fetText: '',
    data: null,             // parsed static data (teachers/subjects/rooms/groups/activities/constraints)
    scheduleEntries: null,  // solved schedule (array), built after generation or import
    solvedSource: null      // 'generated' | 'imported' | 'embedded' (from input file constraints)
  };

  // ===================== Parsing the input .fet file =====================
  function parseFetStaticData(fetText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(fetText, 'text/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('ملف FET غير صالح (خطأ في تحليل XML)');
    }

    const numHoursPerHalf = parseInt(
      txt(doc.getElementsByTagName('Hours_List')[0], 'Number_of_Hours') || '4', 10
    ) || 4;

    const daysListEl = doc.getElementsByTagName('Days_List')[0];
    const dayNames = allDirect(daysListEl, 'Day').map(d => txt(d, 'Name'));

    const realDaysEl = doc.getElementsByTagName('Real_Days_List')[0];
    const realDayNames = allDirect(realDaysEl, 'Real_Day').map(d => txt(d, 'Name'));

    const hoursEl = doc.getElementsByTagName('Hours_List')[0];
    const hourNames = allDirect(hoursEl, 'Hour').map(h => txt(h, 'Name'));
    const realHoursEl = doc.getElementsByTagName('Real_Hours_List')[0];
    const realHours = allDirect(realHoursEl, 'Real_Hour').map(h => ({
      name: txt(h, 'Name'),
      start: txt(h, 'Long_Name') || txt(h, 'Name')
    }));

    // Teachers / Subjects / Rooms
    const teachers = allDirect(doc.getElementsByTagName('Teachers_List')[0], 'Teacher')
      .map(t => ({ name: txt(t, 'Name') }));
    const subjects = allDirect(doc.getElementsByTagName('Subjects_List')[0], 'Subject')
      .map(s => ({ name: txt(s, 'Name') }));
    const rooms = allDirect(doc.getElementsByTagName('Rooms_List')[0], 'Room')
      .map(r => ({ name: txt(r, 'Name'), capacity: txt(r, 'Capacity') }));

    // Classes (Year > Group). We work ONLY with full classes everywhere in
    // the UI (lists, dropdowns, printing) — subgroups (Subgroup) are never
    // shown on their own. We still need to know which subgroup names belong
    // to which class internally, purely so that two subgroups running
    // parallel activities (e.g. فيزياء_TP for فوج1 و علوم_TP for فوج2) can be
    // merged back into their parent class's single cell when printing.
    const classes = [];
    const subgroupToClass = Object.create(null); // "1م1_ف1" -> "1م1" (internal use only)
    const studentsList = doc.getElementsByTagName('Students_List')[0];
    allDirect(studentsList, 'Year').forEach(year => {
      allDirect(year, 'Group').forEach(g => {
        const className = txt(g, 'Name');
        classes.push({ name: className });
        allDirect(g, 'Subgroup').forEach(sg => {
          subgroupToClass[txt(sg, 'Name')] = className;
        });
      });
    });

    // Activities (definitions only — no schedule yet)
    const activitiesList = doc.getElementsByTagName('Activities_List')[0];
    const activities = allDirect(activitiesList, 'Activity')
      .filter(a => txt(a, 'Active') !== 'false')
      .map(a => ({
        id: txt(a, 'Id'),
        teacher: allDirect(a, 'Teacher').map(t => t.textContent.trim()).join(' + ') || txt(a, 'Teacher'),
        subject: txt(a, 'Subject'),
        students: allDirect(a, 'Students').map(s => s.textContent.trim()).join(' + ') || txt(a, 'Students'),
        duration: parseInt(txt(a, 'Duration') || '1', 10) || 1
      }));

    // Embedded (already-solved) schedule, if the .fet file was saved after
    // generation and contains locked starting-time / room constraints.
    const embeddedStartTimes = Object.create(null);
    Array.from(doc.getElementsByTagName('ConstraintActivityPreferredStartingTime')).forEach(c => {
      if (txt(c, 'Active') === 'false') return;
      embeddedStartTimes[txt(c, 'Activity_Id')] = { day: txt(c, 'Day'), hour: txt(c, 'Hour') };
    });
    const embeddedRooms = Object.create(null);
    Array.from(doc.getElementsByTagName('ConstraintActivityPreferredRoom')).forEach(c => {
      if (txt(c, 'Active') === 'false') return;
      embeddedRooms[txt(c, 'Activity_Id')] = txt(c, 'Room');
    });

    // Generic constraint browser list (works for ANY constraint type without
    // needing to hard-code each of FET's ~50 constraint schemas).
    const constraints = [];
    ['Time_Constraints_List', 'Space_Constraints_List'].forEach(listTag => {
      const listEl = doc.getElementsByTagName(listTag)[0];
      if (!listEl) return;
      Array.from(listEl.children).forEach(cEl => {
        const parts = [];
        Array.from(cEl.children).forEach(child => {
          if (child.children.length === 0) {
            const v = (child.textContent || '').trim();
            if (v) parts.push(child.tagName + '=' + v);
          } else {
            parts.push(child.tagName + '(' + child.children.length + ')');
          }
        });
        constraints.push({
          category: listTag === 'Time_Constraints_List' ? 'قيد زمني' : 'قيد مكاني',
          type: cEl.tagName,
          summary: parts.join('، ')
        });
      });
    });

    return {
      numHoursPerHalf, dayNames, hourNames, realDayNames, realHours,
      teachers, subjects, rooms, classes, subgroupToClass, activities,
      embeddedStartTimes, embeddedRooms, constraints
    };
  }

  // Robust FET day/hour -> {dayIndex(0-4), period(1..2*numHoursPerHalf)}.
  // Supports Arabic numeric names (01 ... 10), paired names such as
  // Sunday1/Monday2, and guard-file clock labels such as 08:30/10:00.
  function mapDayAndPeriod(dayNames, numHoursPerHalf, fetDayName, fetHour) {
    const name = String(fetDayName || '').trim();
    const normalized = name.toLowerCase().replace(/\s+/g, ' ');
    let dayIndex = -1;
    let isAfternoon = false;
    const numericDay = normalized.match(/^(\d{1,2})/);
    if (numericDay) {
      const num = parseInt(numericDay[1], 10);
      dayIndex = Math.floor((num - 1) / 2);
      isAfternoon = (num % 2) === 0;
    } else {
      const exactIndex = dayNames.findIndex(d => String(d || '').trim().toLowerCase() === normalized);
      if (exactIndex >= 0) {
        dayIndex = dayNames.length >= 8 ? Math.floor(exactIndex / 2) : exactIndex;
        isAfternoon = dayNames.length >= 8 && (exactIndex % 2 === 1);
      } else {
        const pair = normalized.match(/^(.*?)([12])$/);
        const base = pair ? pair[1].trim() : normalized;
        const baseIndex = dayNames.findIndex(d => {
          const dn = String(d || '').trim().toLowerCase();
          return dn === base || dn.replace(/[12]$/, '') === base;
        });
        if (baseIndex >= 0) {
          dayIndex = dayNames.length >= 8 ? Math.floor(baseIndex / 2) : baseIndex;
          isAfternoon = pair ? pair[2] === '2' : /(?:م|pm|afternoon)$/i.test(normalized);
        } else {
          const realNames = (state.data && state.data.realDayNames) || [];
          dayIndex = realNames.findIndex(d => String(d || '').trim().toLowerCase() === base);
          isAfternoon = pair ? pair[2] === '2' : /(?:م|pm|afternoon)$/i.test(normalized);
        }
      }
    }
    if (dayIndex < 0 || dayIndex > 4) return null;

    const h = String(fetHour || '').trim().toLowerCase();
    const hourNames = (state.data && state.data.hourNames) || [];
    let hourIndex = hourNames.findIndex(x => String(x || '').trim().toLowerCase() === h);
    if (hourIndex < 0) {
      const hm = h.match(/(\d{1,2})(?::(\d{2}))?/);
      if (hm) {
        const hourValue = parseInt(hm[1], 10);
        hourIndex = hourNames.findIndex(x => {
          const m = String(x || '').match(/(\d{1,2})(?::(\d{2}))?/);
          return m && parseInt(m[1], 10) === hourValue;
        });
      }
    }
    if (hourIndex < 0) {
      const realIndex = ((state.data && state.data.realHours) || []).findIndex(x => String(x.name || '').toLowerCase() === h);
      if (realIndex >= 0) {
        hourIndex = realIndex % numHoursPerHalf;
        isAfternoon = isAfternoon || realIndex >= numHoursPerHalf;
      }
    }
    if (hourIndex < 0 || hourIndex >= numHoursPerHalf) return null;
    return { dayIndex, period: hourIndex + 1 + (isAfternoon ? numHoursPerHalf : 0) };
  }

  // ===================== Parsing a solved *_activities.xml =====================
  // FET's CLI documents this as the most useful machine-readable result file.
  // We look for <Activity> elements anywhere in the document (defensive,
  // since exact nesting/tag naming can vary slightly between FET versions)
  // and read common child tags by name.
  function parseActivitiesXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('ملف الحصص المولّد غير صالح (خطأ في تحليل XML)');
    }
    const activityEls = Array.from(doc.getElementsByTagName('Activity'));
    // A "placed" activity in FET's own _activities.xml output is fully and
    // exclusively defined by having a Day + Hour — that's it. Real exports
    // routinely contain entries with an EMPTY <Room></Room> tag (e.g. no
    // room constraint was set for that activity) that are still validly
    // placed; requiring teacher/subject/students/room in addition to
    // day+hour was silently dropping every such entry. Confirmed directly
    // against a real export: 616 activities have day+hour, but only 529
    // also had a non-empty room — the other 87 were being lost, which is
    // exactly what caused whole subgroups/double-periods to appear missing
    // (their activities were among the dropped 87, not actually absent).
    return activityEls.map((a, index) => ({
      id: txt(a, 'Id') || txt(a, 'Activity_Id') || ('xml-activity-' + (index + 1)),
      day: txt(a, 'Day') || txt(a, 'Real_Day'),
      hour: txt(a, 'Hour') || txt(a, 'Real_Hour'),
      room: txt(a, 'Room'),
      teacher: txt(a, 'Teacher'),
      subject: txt(a, 'Subject'),
      students: txt(a, 'Students') || txt(a, 'Group') || txt(a, 'Class'),
      // Leave duration UNSET (not defaulted to 1) when the XML has no
      // <Duration> tag — which is the normal case for real fet-cl output,
      // since it only ever writes Id/Day/Hour/Room. Defaulting to 1 here
      // would make every double-period activity's `s.duration` a truthy 1,
      // which then permanently blocks the `s.duration || a.duration || 1`
      // fallback in buildScheduleEntries from ever reaching the REAL
      // duration recorded in the base .fet — rendering every 2-hour
      // activity as a single-period cell. Confirmed as the exact cause.
      duration: (function () { const t = txt(a, 'Duration'); const n = t ? parseInt(t, 10) : NaN; return Number.isFinite(n) && n > 0 ? n : undefined; })()
    })).filter(a => a.day && a.hour);
  }

  // ===================== Build the unified, canonical schedule =====================
  function buildScheduleEntries() {
    const d = state.data;
    if (!d) return [];

    let solved; // array of {id, day, hour, room?}
    if (state.solvedSource === 'generated' || state.solvedSource === 'imported') {
      solved = state.solvedActivities;
    } else {
      // Fall back to whatever the loaded .fet file already had embedded.
      solved = Object.keys(d.embeddedStartTimes).map(id => ({
        id,
        day: d.embeddedStartTimes[id].day,
        hour: d.embeddedStartTimes[id].hour,
        room: d.embeddedRooms[id] || ''
      }));
      state.solvedSource = solved.length ? 'embedded' : null;
    }

    const bySolvedId = Object.create(null);
    solved.forEach(s => { bySolvedId[s.id] = s; });

    const entries = [];
    const matchedIds = new Set();
    d.activities.forEach(a => {
      const s = bySolvedId[a.id];
      if (!s) return;
      const dp = mapDayAndPeriod(d.dayNames, d.numHoursPerHalf, s.day, s.hour);
      if (!dp) return;
      matchedIds.add(a.id);
      const dayName = d.realDayNames[dp.dayIndex] || s.day;
      entries.push({
        activityId: a.id,
        group: s.students || a.students || '',
        teacher: s.teacher || a.teacher || '',
        subject: s.subject || a.subject || '',
        room: (s.room || d.embeddedRooms[a.id] || '').trim(),
        duration: s.duration || a.duration || 1,
        dayIndex: dp.dayIndex,
        dayName,
        period: dp.period
      });
    });

    // Also retain solved XML activities not present in the base .fet file.
    // This is essential for guard-duty/limited exports whose Activity nodes
    // contain only the fields that are actually assigned.
    solved.forEach(s => {
      if (matchedIds.has(s.id)) return;
      const dp = mapDayAndPeriod(d.dayNames, d.numHoursPerHalf, s.day, s.hour);
      if (!dp) return;
      entries.push({
        activityId: s.id,
        group: s.students || '',
        teacher: s.teacher || '',
        subject: s.subject || '',
        room: (s.room || '').trim(),
        duration: s.duration || 1,
        dayIndex: dp.dayIndex,
        dayName: d.realDayNames[dp.dayIndex] || s.day,
        period: dp.period
      });
    });
    entries.sort((x, y) => x.dayIndex - y.dayIndex || x.period - y.period);
    return entries;
  }

  // Period -> clock-time label, built from Real_Hours_List (period 1 = first
  // real hour, period 2 = second, …). Falls back to plain numbers.
  function periodLabel(period) {
    if (state.settings.periodLabels && state.settings.periodLabels[period - 1]) return state.settings.periodLabels[period - 1];
    const rh = state.data.realHours;
    const idx = period - 1;
    if (rh && rh[idx] && rh[idx].start) return 'ف' + period + ' (' + rh[idx].start + ')';
    return 'الفترة ' + period;
  }

  // ===================== TAB SWITCHING =====================
  $all('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.tab-btn').forEach(b => b.classList.remove('active'));
      $all('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('#tab-' + btn.dataset.tab).classList.add('active');
    });
  });
  $all('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDataTable(btn.dataset.sub);
    });
  });
  $all('input[name="ascMode"]').forEach(r => {
    r.addEventListener('change', () => {
      $('#optAll').classList.toggle('active', r.value === 'all' && r.checked);
      $('#optCards').classList.toggle('active', r.value === 'cards' && r.checked);
    });
  });

  // ===================== TAB 1: IMPORT / GENERATE =====================
  async function loadFetData(res) {
    if (!res) return;
    try {
      state.fetPath = res.path;
      state.fetText = res.content;
      window.__currentFetText = res.content;
      state.data = parseFetStaticData(res.content);
      state.scheduleEntries = null;
      state.solvedSource = null;
      $('#fileStatus').textContent = 'الملف: ' + res.path.split(/[\\/]/).pop();
      setStatus($('#fetLoadStatus'),
        '✔ تم التحميل: ' + state.data.teachers.length + ' أستاذ، ' +
        state.data.classes.length + ' قسم، ' + state.data.rooms.length + ' قاعة، ' +
        state.data.activities.length + ' نشاط، ' + state.data.constraints.length + ' قيد.',
        'success');
      $('#btnGenerate').disabled = false;
      populateEntitySelectors();
      renderDataTable('constraints');
      $('#btnSaveData').style.display = 'inline-block';
    } catch (err) {
      setStatus($('#fetLoadStatus'), 'خطأ: ' + err.message, 'error');
    }
  }

  $('#btnOpenFet').addEventListener('click', async () => {
    const res = await window.fetApp.openFetFile();
    await loadFetData(res);
  });

  const btnLoadSample = $('#btnLoadSampleFet');
  if (btnLoadSample) {
    btnLoadSample.addEventListener('click', async () => {
      setStatus($('#fetLoadStatus'), 'جاري تحميل الملف التجريبي…', 'info');
      const res = await window.fetApp.loadSampleFet();
      if (res) {
        await loadFetData(res);
      } else {
        setStatus($('#fetLoadStatus'), 'تعذر تحميل النموذج التجريبي', 'error');
      }
    });
  }

  // V4.0: restore last-used engine path / output folder / color prefs so
  // the user never has to re-enter them after restarting the app.
  if (state.settings.fetClPath) {
    $('#fetClPath').value = state.settings.fetClPath;
  } else {
    window.fetApp.defaultFetClPath().then(p => { $('#fetClPath').value = p; });
  }
  if (state.settings.outputDir) $('#outputDir').value = state.settings.outputDir;
  $('#fetClPath').addEventListener('change', () => { state.settings.fetClPath = $('#fetClPath').value; saveSettingsToDisk(); });
  $('#outputDir').addEventListener('change', () => { state.settings.outputDir = $('#outputDir').value; saveSettingsToDisk(); });
  $('#chk-print-color').checked = state.settings.colorsEnabled !== false;
  $('#colorByDim').value = state.settings.colorBy || 'subjects';

  $('#btnPickFetCl').addEventListener('click', async () => {
    const p = await window.fetApp.pickFetCl();
    if (p) { $('#fetClPath').value = p; state.settings.fetClPath = p; saveSettingsToDisk(); }
  });

  let alertAudioInterval = null;
  let alertAudioTimeout = null;
  let alertAudioContext = null;

  function stopCompletionAlarm() {
    if (alertAudioInterval) { clearInterval(alertAudioInterval); alertAudioInterval = null; }
    if (alertAudioTimeout) { clearTimeout(alertAudioTimeout); alertAudioTimeout = null; }
    if (alertAudioContext) { try { alertAudioContext.close(); } catch (e) {} alertAudioContext = null; }
  }

  // Generate a short, user-configurable Web Audio alarm without external files.
  // It is invoked only after a user-started generation reaches success or stop.
  function triggerCompletionAlarm() {
    stopCompletionAlarm();
    const toggle = $('#audio-alert-toggle');
    if (toggle && !toggle.checked) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    const durationInput = $('#audio-alert-duration');
    const raw = Number.parseInt(durationInput ? durationInput.value : '10', 10);
    const durationMs = Math.max(2000, Math.min(120000, Number.isFinite(raw) ? raw * 1000 : 10000));
    try {
      alertAudioContext = new AudioCtor();
      const playBeep = () => {
        if (!alertAudioContext) return;
        const now = alertAudioContext.currentTime;
        const oscillator = alertAudioContext.createOscillator();
        const gain = alertAudioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 587.33;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.28, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
        oscillator.connect(gain); gain.connect(alertAudioContext.destination);
        oscillator.start(now); oscillator.stop(now + 0.48);
      };
      if (alertAudioContext.state === 'suspended') alertAudioContext.resume().catch(() => {});
      playBeep();
      alertAudioInterval = setInterval(playBeep, 800);
      alertAudioTimeout = setTimeout(stopCompletionAlarm, durationMs);
    } catch (e) {
      stopCompletionAlarm();
      console.warn('تعذر تشغيل التنبيه الصوتي:', e);
    }
  }

  function loadAudioAlertSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('fetAudioAlertSettings') || '{}');
      if ($('#audio-alert-toggle') && typeof saved.enabled === 'boolean') $('#audio-alert-toggle').checked = saved.enabled;
      if ($('#audio-alert-duration') && saved.duration) $('#audio-alert-duration').value = saved.duration;
    } catch (e) {}
  }
  function saveAudioAlertSettings() {
    try { localStorage.setItem('fetAudioAlertSettings', JSON.stringify({ enabled: !!($('#audio-alert-toggle') && $('#audio-alert-toggle').checked), duration: $('#audio-alert-duration') ? $('#audio-alert-duration').value : 10 })); } catch (e) {}
  }
  loadAudioAlertSettings();
  $('#audio-alert-toggle').addEventListener('change', saveAudioAlertSettings);
  $('#audio-alert-duration').addEventListener('change', saveAudioAlertSettings);

  let genTimerInterval = null;
  function startGenTimer() {
    const startedAt = Date.now();
    $('#genTimer').textContent = '00:00';
    genTimerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      $('#genTimer').textContent = mm + ':' + ss;
    }, 1000);
  }
  function stopGenTimer() { if (genTimerInterval) clearInterval(genTimerInterval); genTimerInterval = null; }

  $('#genType').addEventListener('change', () => {
    const isMulti = $('#genType').value === 'multi';
    $('#multiAttemptFields').style.display = isMulti ? 'block' : 'none';
    $('#singleFields').style.display = isMulti ? 'none' : 'flex';
  });

  $('#btnGenerate').addEventListener('click', async () => {
    if (!state.fetPath || !state.data) return;
    stopCompletionAlarm();
    state.currentRunId = 'run-' + Date.now();
    state.trackProgress = {};
    setStatus($('#genStatus'), 'جاري تشغيل محرك FET-CL… قد يستغرق هذا بعض الوقت.', 'info');
    $('#btnStopGenerate').disabled = false;
    $('#generationProgress').style.width = '0%';
    $('#genLog').style.display = 'none';
    $('#genPlacedInfo').textContent = 'أقصى أنشطة تم توزيعها: — ';
    $('#trackProgressPanel').innerHTML = '';
    $('#btnGenerate').disabled = true;
    startGenTimer();

    const isMulti = $('#genType').value === 'multi';
    const numTables = isMulti ? parseInt($('#numTables').value || '1', 10) : 1;
    const tracksPerTable = isMulti ? parseInt($('#tracksPerTable').value || '1', 10) : 1;
    const perAttemptTime = isMulti ? parseInt($('#trackTimeLimit').value || '60', 10) : parseInt($('#timeLimit').value || '60', 10);
    if (isMulti) {
      const trackTotal = Math.max(1, numTables) * Math.max(1, tracksPerTable);
      $('#trackProgressPanel').innerHTML = Array.from({length: trackTotal}, (_, i) => '<div class="track-card" id="track-card-' + (i + 1) + '"><strong>المسار ' + (i + 1) + '</strong><span class="track-seed">جاري البدء…</span><span class="track-time">الوقت: 0سا و 0د و 0ثا</span><div class="track-bar"><i></i></div><span class="track-placed">Max Placed الحالي: 0 نشاط</span><span class="track-history">Highest Placed التاريخي: 0 نشاط</span></div>').join('');
    }

    try {
      const result = await window.fetApp.generate({
        fetFilePath: state.fetPath,
        fetClPath: $('#fetClPath').value,
        timeLimitSeconds: perAttemptTime,
        outputDir: $('#outputDir').value,
        runId: state.currentRunId,
        totalActivities: state.data.activities.length,
        numTables, tracksPerTable,
        stopOnPerfect: $('#stopOnPerfect').checked,
        keepAllAttempts: $('#keepAllAttempts').checked,
        useRandomSeed: isMulti && $('#useRandomSeed').checked
      });
      stopGenTimer();
      // Soft-success: engine placed all (or many) activities even if XML path lookup failed
      const softOk = !result.success && result.attempts && result.attempts.some(a => Number(a.placed || 0) > 0);
      if (!result.success && !softOk) {
        setStatus($('#genStatus'), '✖ ' + (result.error || 'فشل التوليد'), 'error');
        if (result.attempts && result.attempts.length) {
          $('#genLog').style.display = 'block';
          $('#genLog').textContent = result.attempts.map(a =>
            '── محاولة ' + a.attemptIndex + ' ──\n' +
            'المجلد: ' + a.outDir + '\n' +
            'الأمر: ' + (a.cmdLine || '—') + '\n' +
            'رمز الخروج: ' + a.exitCode + (a.error ? (' — خطأ تشغيل: ' + a.error) : '') + '\n' +
            'الأنشطة الموزّعة: ' + a.placed + '\n' +
            (a.stdout ? ('stdout:\n' + a.stdout + '\n') : '') +
            (a.stderr ? ('stderr:\n' + a.stderr + '\n') : '')
          ).join('\n');
        }
        return;
      }
      if (!result.success && softOk) {
        // Promote best attempt so UI can still load/print
        const best = result.attempts.slice().sort((a,b) => Number(b.placed||0) - Number(a.placed||0))[0];
        result.success = true;
        result.placed = Number(best.placed || 0);
        result.outDir = result.outDir || best.outDir;
        result.complete = result.complete || (state.data && state.data.activities && result.placed >= state.data.activities.length);
        result.error = null;
      }
      let solved = false;
      if (result.activitiesXml) { state.solvedActivities = parseActivitiesXml(result.activitiesXml); state.solvedSource = 'generated'; solved = true; }
      else if (result.solvedFetContent) {
        try { state.data = parseFetStaticData(result.solvedFetContent); state.solvedSource = 'embedded'; solved = true; } catch (e) {}
      }
      if (!solved) {
        // Still celebrate a complete placement even without parseable XML in-memory
        const totalAct = (state.data && state.data.activities && state.data.activities.length) || result.total || 0;
        if (result.complete || (Number(result.placed || 0) > 0 && Number(result.placed || 0) >= totalAct && totalAct > 0)) {
          setStatus($('#genStatus'),
            '✔ تم التوليد بنجاح (حل كامل: ' + (result.placed || totalAct) + ' من ' + totalAct + ' نشاط). مجلد النتائج: ' + (result.outDir || '—') +
            ' — افتح ملف الجدول من المجلد إن لم تُحمَّل المعاينة تلقائياً.',
            'success');
          triggerCompletionAlarm();
          populateEntitySelectors();
          return;
        }
        setStatus($('#genStatus'), '⚠ اكتمل التشغيل لكن تعذّر إيجاد جدول صالح في مجلد النتائج: ' + (result.outDir || '—'), 'error');
        return;
      }
      state.scheduleEntries = buildScheduleEntries();
      const trackMsg = result.totalAttempts > 1
        ? ' — فاز المسار Track_' + (result.winnerTrack || result.winnerAttempt) + ' في Table_' + (result.winnerTable || 1) + ' من أصل ' + result.totalAttempts + ' مسار'
        : '';
      const tablesMsg = result.totalTables > 1 ? ' — اكتمل ' + (result.completedTables || 0) + ' من ' + result.totalTables + ' جدول' : '';
      const completeMsg = result.complete ? ' (حل كامل: كل الأنشطة وُزّعت)' : ' (حل جزئي: ' + result.placed + ' من ' + result.total + ' نشاط)';
      const stoppedMsg = result.cancelled ? ' — أوقفه المستخدم بعد حفظ أفضل نتيجة' : '';
      setStatus($('#genStatus'),
        '✔ تم التوليد بنجاح' + trackMsg + tablesMsg + completeMsg + stoppedMsg + '. مجلد النتائج: ' + result.outDir,
        'success');
      triggerCompletionAlarm();
      populateEntitySelectors();
    } catch (err) {
      stopGenTimer();
      setStatus($('#genStatus'), 'خطأ: ' + err.message, 'error');
    } finally {
      $('#btnGenerate').disabled = false;
      $('#btnStopGenerate').disabled = true;
      state.currentRunId = null;
    }
  });

  $('#btnOpenActivities').addEventListener('click', async () => {
    if (!state.data) {
      setStatus($('#actLoadStatus'), 'حمّل أولاً ملف FET (الخطوة أ) حتى يمكن مطابقة الأنشطة.', 'error');
      return;
    }
    const res = await window.fetApp.openActivitiesXml();
    if (!res) return;
    try {
      state.solvedActivities = parseActivitiesXml(res.content);
      state.solvedSource = 'imported';
      state.scheduleEntries = buildScheduleEntries();
      setStatus($('#actLoadStatus'),
        '✔ تم الاستيراد — ' + state.scheduleEntries.length + ' حصة تم تحديد موقعها.', 'success');
      populateEntitySelectors();
    } catch (err) {
      setStatus($('#actLoadStatus'), 'خطأ: ' + err.message, 'error');
    }
  });

  // ===================== TAB 2: DATA BROWSER =====================
  function renderDataTable(kind) {
    if (!state.data) return;
    const d = state.data;
    const thead = $('#dataTable thead');
    const tbody = $('#dataTable tbody');
    let cols = [];
    let rows = [];

    if (kind === 'constraints') {
      cols = ['النوع', 'التصنيف', 'التفاصيل'];
      rows = d.constraints.map(c => [c.type, c.category, c.summary]);
    } else if (kind === 'activities') {
      cols = ['المعرف', 'الفوج', 'المادة', 'الأستاذ', 'المدة'];
      rows = d.activities.map(a => [a.id, a.students, a.subject, a.teacher, a.duration]);
    } else if (kind === 'teachers') {
      cols = ['اسم الأستاذ'];
      rows = d.teachers.map(t => [t.name]);
    } else if (kind === 'groups') {
      cols = ['اسم القسم'];
      rows = d.classes.map(c => [c.name]);
    } else if (kind === 'rooms') {
      cols = ['اسم القاعة', 'السعة'];
      rows = d.rooms.map(r => [r.name, r.capacity || '—']);
    }

    thead.innerHTML = '<tr>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr>';
    renderRows(rows);
    $('#dataCount').textContent = 'العدد: ' + rows.length;

    $('#dataSearch').oninput = () => {
      const q = $('#dataSearch').value.trim().toLowerCase();
      const filtered = q ? rows.filter(r => r.some(v => String(v).toLowerCase().includes(q))) : rows;
      renderRows(filtered);
      $('#dataCount').textContent = 'المعروض: ' + filtered.length + ' من ' + rows.length;
    };

    function renderRows(rws) {
      tbody.innerHTML = rws.map(r => '<tr>' + r.map(v => '<td ondblclick="this.contentEditable=\'true\';this.classList.add(\'editable\')">' + esc(v) + '</td>').join('') + '</tr>').join('');
    }
  }

  // ===================== TAB 3: TIMETABLES =====================
  function populateEntitySelectors() {
    updateEntitySelect();
  }
  $('#ttType').addEventListener('change', updateEntitySelect);
  function updateEntitySelect() {
    if (!state.data) return;
    let type = $('#ttType').value;
    const sel = $('#ttEntity');
    let items = [];
    if (type === 'group') items = state.data.classes.map(c => c.name);
    else if (type === 'teacher') items = state.data.teachers.map(t => t.name);
    else if (type === 'room') items = state.data.rooms.map(r => r.name);
    // Guard-duty files may have no student groups at all. Fall back to a
    // populated entity type so the Timetables tab is usable immediately.
    if (!items.length) {
      const fallback = state.data.teachers.length ? 'teacher' : state.data.rooms.length ? 'room' : null;
      if (fallback) {
        type = fallback;
        $('#ttType').value = fallback;
        items = fallback === 'teacher' ? state.data.teachers.map(t => t.name) : state.data.rooms.map(r => r.name);
      }
    }
    const dispFn = type === 'group' ? dispClass : type === 'teacher' ? dispTeacher : dispRoom;
    sel.innerHTML = items.map(n => '<option value="' + esc(n) + '">' + esc(dispFn(n)) + '</option>').join('');
  }

  function requireSchedule() {
    if (!state.scheduleEntries || !state.scheduleEntries.length) {
      state.scheduleEntries = buildScheduleEntries();
    }
    return state.scheduleEntries && state.scheduleEntries.length > 0;
  }

  // Render every available field independently. Visibility is controlled by
  // the V3.6.3 checkboxes, while the table type controls the display order.
  function generateCellContent(activity, currentTableType) {
    if (!activity) return '<div class="cell-empty">---</div>';
    const contentParts = [];
    const showSubject = !$('#chk-show-subject') || $('#chk-show-subject').checked;
    const showTeacher = !$('#chk-show-teacher') || $('#chk-show-teacher').checked;
    const showRoom = !$('#chk-show-room') || $('#chk-show-room').checked;
    const showStudents = !$('#chk-show-students') || $('#chk-show-students').checked;
    const showImages = !$('#chk-show-images') || $('#chk-show-images').checked;
    const groups = String(activity.group || activity.students || '').split(' + ').map(x => x.trim()).filter(Boolean);
    const parentGroups = groups.map(g => dispClass(state.data.subgroupToClass[g] || g));
    const icon = (showImages && activity.subject && state.settings.subjectIcons[activity.subject])
      ? '<img class="cell-subject-icon" src="' + state.settings.subjectIcons[activity.subject] + '">' : '';
    const values = {
      subject: activity.subject && String(activity.subject).trim().toLowerCase() !== 'sub'
        ? '<div class="cell-subject-row"><div class="cell-subject">' + esc(dispSubject(activity.subject)) + '</div>' + icon + '</div>' : '',
      teacher: activity.teacher ? '<div class="cell-teacher">' + esc(String(activity.teacher).split(' + ').map(dispTeacher).join(' + ')) + '</div>' : '',
      room: activity.room ? '<div class="cell-room">' + esc(String(activity.room).split(' + ').map(dispRoom).join(' + ')) + '</div>' : '',
      students: parentGroups.length ? '<div class="cell-students">' + esc(parentGroups.join(' + ')) + '</div>' : ''
    };
    const allowed = { subject: showSubject, teacher: showTeacher, room: showRoom, students: showStudents };
    const order = currentTableType === 'teacher' ? ['students', 'subject', 'room', 'teacher'] :
                  currentTableType === 'group' ? ['subject', 'teacher', 'room', 'students'] :
                  currentTableType === 'room' ? ['students', 'teacher', 'subject', 'room'] :
                  ['subject', 'teacher', 'room', 'students'];
    order.forEach(key => { if (allowed[key] && values[key]) contentParts.push(values[key]); });
    return contentParts.length ? contentParts.join('') : '<div class="cell-empty">---</div>';
  }

  function renderMiniBlock(e, type) {
    const bg = colorForEntry(e);
    const actId = e.activityId || '';
    const teacherName = esc(e.teacher || '');
    const groupName = esc(e.group || '');
    return '<div class="mini-block activity-card card-item" draggable="true" data-activity-id="' + esc(actId) + '" data-teacher="' + teacherName + '" data-group="' + groupName + '" data-day="' + (e.dayIndex !== undefined ? e.dayIndex : '') + '" data-period="' + (e.period || '') + '"' + (bg ? ' style="background-color:' + esc(bg) + ';"' : '') + '>' + generateCellContent(e, type) + '</div>';
  }
  // Render a merged timetable cell as one coloured TD. The activity details
  // live directly inside that TD; no nested coloured blocks or dashed split
  // lines are used, so a double-period cell is visually and structurally one
  // complete cell.
  function renderMergedCell(cellEntries, type) {
    const firstColor = colorForEntry(cellEntries[0]);
    const firstEntry = cellEntries[0] || {};
    const content = cellEntries.map(e => '<div class="merged-activity-content activity-card card-item" draggable="true" data-activity-id="' + esc(e.activityId || '') + '" data-teacher="' + esc(e.teacher || '') + '" data-group="' + esc(e.group || '') + '" data-day="' + (e.dayIndex !== undefined ? e.dayIndex : '') + '" data-period="' + (e.period || '') + '">' + generateCellContent(e, type) + '</div>').join('');
    return '<td class="filled merged-cell timetable-slot teacher-slot room-slot" data-day="' + (firstEntry.dayIndex !== undefined ? firstEntry.dayIndex : '') + '" data-period="' + (firstEntry.period || '') + '"' + (firstColor ? ' style="background-color:' + esc(firstColor) + ';"' : '') + '>' + content + '</td>';
  }
  function renderSubgroupCell(cellEntries, type) {
    const firstEntry = cellEntries[0] || {};
    return '<td class="filled subgroup-cell timetable-slot teacher-slot room-slot" data-day="' + (firstEntry.dayIndex !== undefined ? firstEntry.dayIndex : '') + '" data-period="' + (firstEntry.period || '') + '">' + cellEntries.map(e => renderMiniBlock(e, type)).join('') + '</td>';
  }

  // v4.1: رأس مؤسسي موحد يظهر في كل الجداول والتقارير المطبوعة.
  function buildPrintHeader(title) {
    const inst = state.settings.institution || {};
    const lines = Array.isArray(inst.headerLines) ? inst.headerLines : [];
    const lineOne = String(lines[0] || '').trim();
    const lineTwo = String(lines[1] || '').trim();
    const rightLines = lines.slice(2).map(x => String(x || '').trim()).filter(Boolean);
    const institutionDetails = [
      inst.name ? 'اسم المؤسسة: ' + inst.name : '',
      inst.municipality ? 'البلدية: ' + inst.municipality : '',
      inst.wilaya ? 'الولاية: ' + inst.wilaya : ''
    ].filter(Boolean);
    const rightHtml = rightLines.concat(institutionDetails).map(line => '<div>' + esc(line) + '</div>').join('');
    return '<div class="print-header">' +
      '<div class="print-header-centered">' + (lineOne ? '<div>' + esc(lineOne) + '</div>' : '') + (lineTwo ? '<div>' + esc(lineTwo) + '</div>' : '') + '</div>' +
      '<div class="print-header-meta"><span class="print-season">' + (inst.season ? 'الموسم الدراسي: ' + esc(inst.season) : '') + '</span><span class="print-header-right">' + rightHtml + '</span></div>' +
      '<div class="print-header-spacer"></div><div class="print-title">' + esc(title) + '</div>' +
      '</div>';
  }

  // Build one printable grid <div class="tt-block"> for a single group/teacher/room.
  // Layout matches the reference screenshots: DAYS are rows, PERIODS are
  // columns. A 2-hour (or longer) activity spans its periods as ONE merged
  // cell (colspan). For a full class, if two subgroups have parallel
  // activities in the same slot (e.g. فيزياء_TP لفوج1 و علوم_TP لفوج2), both
  // are stacked inside that single merged cell — never two separate group
  // cells, and subgroup names are never shown, only the parent class.
  function buildGridBlock(type, name) {
    const d = state.data;
    if (!d || !d.realDayNames || !d.realDayNames.length) {
      return '<div class="tt-block"><div class="status error" style="margin:20px;text-align:center;padding:24px;border:1px dashed #cbd5e1;border-radius:12px;color:#64748b;font-weight:700;">لا توجد بيانات متاحة لعرض الجدول. يرجى توليد أو تحميل ملف الجدول أولاً.</div></div>';
    }
    const numPeriods = (d.numHoursPerHalf || 4) * 2;
    const days = d.realDayNames || [];
    const isFullClass = type === 'group' && Array.isArray(d.classes) && d.classes.some(c => c.name === name);

    const matchers = {
      group: e => e.group === name || (e.group && e.group.split(' + ').includes(name)) ||
        (isFullClass && e.group && e.group.split(' + ').some(g => d.subgroupToClass && d.subgroupToClass[g] === name)),
      teacher: e => e.teacher === name || (e.teacher && e.teacher.split(' + ').includes(name)),
      room: e => e.room === name
    };
    const entries = (state.scheduleEntries || []).filter(matchers[type]);

    // gridByDay[dayIndex][period] = [entries starting at that period]
    const gridByDay = {};
    entries.forEach(e => {
      if (!gridByDay[e.dayIndex]) gridByDay[e.dayIndex] = {};
      if (!gridByDay[e.dayIndex][e.period]) gridByDay[e.dayIndex][e.period] = [];
      gridByDay[e.dayIndex][e.period].push(e);
    });

    const typeLabel = { group: 'القسم', teacher: 'الأستاذ', room: 'القاعة' }[type];
    const dispEntityName = type === 'group' ? dispClass(name) : type === 'teacher' ? dispTeacher(name) : dispRoom(name);
    let html = '<div class="tt-block timetable-page-break">' + buildPrintHeader(typeLabel + ': ' + dispEntityName) + '<h3 class="screen-only-title">' + typeLabel + ': ' + esc(dispEntityName) + '</h3>';
    html += '<table class="tt-grid tt-grid-hv"><thead><tr><th>اليوم</th>';
    for (let p = 1; p <= numPeriods; p++) html += '<th>' + esc(periodLabel(p)) + '</th>';
    html += '</tr></thead><tbody>';

    for (let di = 0; di < days.length; di++) {
      // The section timetable must show the complete activity in one physical
      // cell. When parallel subgroup activities begin inside a double period,
      // extend the same cell and stack all activity details instead of leaving
      // an apparent blank/X cell behind.
      html += '<tr><th class="day-label">' + esc(dispDay(di)) + '</th>';
      const dayCells = gridByDay[di] || {};
      const covered = {};
      const isFullClassActivity = e => {
        if (type !== 'group') return true;
        const tokens = String(e.group || e.students || '').split(' + ').map(x => x.trim()).filter(Boolean);
        return tokens.length > 0 && tokens.every(token => token === name);
      };
      for (let p = 1; p <= numPeriods; p++) {
        if (covered[p]) continue;
        const startingEntries = dayCells[p] || [];
        if (startingEntries.length) {
          let colspan = Math.max(1, Math.max.apply(null, startingEntries.map(e => e.duration || 1)));
          let mergedEntries = startingEntries.slice();
          let scan = p + 1;
          while (scan < p + colspan) {
            const insideEntries = dayCells[scan] || [];
            if (insideEntries.length) {
              mergedEntries = mergedEntries.concat(insideEntries);
              colspan = Math.max(colspan, scan - p + Math.max.apply(null, insideEntries.map(e => e.duration || 1)));
            }
            scan++;
          }
          colspan = Math.max(1, Math.min(numPeriods - p + 1, colspan));
          for (let k = 1; k < colspan; k++) covered[p + k] = true;
          const onlyFullClass = mergedEntries.every(isFullClassActivity);
          const cellHtml = onlyFullClass ? renderMergedCell(mergedEntries, type) : renderSubgroupCell(mergedEntries, type);
          const cellClass = onlyFullClass ? 'filled merged-cell' : 'filled subgroup-cell';
          html += cellHtml.replace('<td class="' + cellClass + ' timetable-slot teacher-slot room-slot"', '<td class="' + cellClass + ' timetable-slot teacher-slot room-slot" data-day="' + di + '" data-period="' + p + '" data-entity="' + esc(name) + '" data-type="' + type + '"' + (colspan > 1 ? ' colspan="' + colspan + '"' : ''));
        } else {
          html += '<td class="timetable-slot teacher-slot room-slot" data-day="' + di + '" data-period="' + p + '" data-entity="' + esc(name) + '" data-type="' + type + '"></td>';
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  $('#btnShowTT').addEventListener('click', () => {
    if (!requireSchedule()) {
      $('#ttSingleContainer').innerHTML = '<div class="status error">لا يوجد جدول محلول بعد — ولّد الجدول أو استورده من التبويب الأول.</div>';
      return;
    }
    const type = $('#ttType').value;
    const name = $('#ttEntity').value;
    $('#ttAllContainer').innerHTML = '';
    $('#ttMasterContainer').innerHTML = '';
    $('#ttSingleContainer').innerHTML = buildGridBlock(type, name);
  });

  $('#btnPrintOne').addEventListener('click', () => window.print());

  $('#btnPrintAll').addEventListener('click', () => {
    if (!requireSchedule()) {
      $('#ttAllContainer').innerHTML = '<div class="status error">لا يوجد جدول محلول بعد.</div>';
      return;
    }
    const type = $('#ttType').value;
    const d = state.data;
    let names = [];
    if (type === 'group') names = d.classes.map(c => c.name);
    else if (type === 'teacher') names = d.teachers.map(t => t.name);
    else if (type === 'room') names = d.rooms.map(r => r.name);

    $('#ttSingleContainer').innerHTML = '';
    $('#ttMasterContainer').innerHTML = '';
    $('#ttAllContainer').innerHTML = names.map(n => buildGridBlock(type, n)).join('');
    window.print();
  });

  // Master/combined table: one entity per row, ALL days+periods as columns
  // in a single continuously-scrollable table (item 1).
  function buildMasterGrid(type) {
    const d = state.data;
    if (!d || !d.realDayNames || !d.realDayNames.length) {
      return '<div class="tt-block master-block"><div class="status error" style="margin:20px;text-align:center;padding:24px;border:1px dashed #cbd5e1;border-radius:12px;color:#64748b;font-weight:700;">لا توجد بيانات متاحة لعرض الجدول الشامل. يرجى توليد أو استيراد الجدول.</div></div>';
    }
    const numPeriods = (d.numHoursPerHalf || 4) * 2;
    const days = d.realDayNames || [];
    const entityNames = type === 'group' ? (d.classes || []).map(c => c.name) :
      type === 'teacher' ? (d.teachers || []).map(t => t.name) : (d.rooms || []).map(r => r.name);
    const dispFn = type === 'group' ? dispClass : type === 'teacher' ? dispTeacher : dispRoom;
    const typeLabel = { group: 'القسم', teacher: 'الأستاذ', room: 'القاعة' }[type] || 'الجدول';

    let html = '<div class="tt-block master-block">' + buildPrintHeader('الجدول الشامل — ' + typeLabel) + '<h3 class="screen-only-title">الجدول الشامل — ' + typeLabel + '</h3>';
    html += '<div class="master-scroll"><table class="tt-grid tt-grid-master timetable-global">';
    html += '<thead><tr><th class="master-corner">' + typeLabel + '</th>';
    days.forEach(dn => { html += '<th colspan="' + numPeriods + '">' + esc(dn) + '</th>'; });
    html += '</tr><tr><th class="master-corner"></th>';
    for (let di = 0; di < days.length; di++) for (let p = 1; p <= numPeriods; p++) html += '<th>' + esc(periodLabel(p)) + '</th>';
    html += '</tr></thead><tbody>';

    entityNames.forEach(name => {
      const isFullClass = type === 'group';
      const matchers = {
        group: e => e.group === name || (e.group && e.group.split(' + ').includes(name)) || (isFullClass && e.group && e.group.split(' + ').some(g => d.subgroupToClass && d.subgroupToClass[g] === name)),
        teacher: e => e.teacher === name || (e.teacher && e.teacher.split(' + ').includes(name)),
        room: e => e.room === name
      };
      const entries = (state.scheduleEntries || []).filter(matchers[type]);
      const gridByDay = {};
      entries.forEach(e => {
        if (!gridByDay[e.dayIndex]) gridByDay[e.dayIndex] = {};
        if (!gridByDay[e.dayIndex][e.period]) gridByDay[e.dayIndex][e.period] = [];
        gridByDay[e.dayIndex][e.period].push(e);
      });

      html += '<tr><th class="master-row-label">' + esc(dispFn(name)) + '</th>';
      for (let di = 0; di < days.length; di++) {
        const dayCells = gridByDay[di] || {};
        const covered = {};
        const isFullClassActivity = e => {
          if (type !== 'group') return true;
          const tokens = String(e.group || e.students || '').split(' + ').map(x => x.trim()).filter(Boolean);
          return tokens.length > 0 && tokens.every(token => token === name);
        };
        for (let p = 1; p <= numPeriods; p++) {
          if (covered[p]) continue;
          const startingEntries = dayCells[p] || [];
          if (startingEntries.length) {
            let colspan = Math.max(1, Math.max.apply(null, startingEntries.map(e => e.duration || 1)));
            let cellEntries = startingEntries.slice();
            let scan = p + 1;
            while (scan < p + colspan) {
              const insideEntries = dayCells[scan] || [];
              if (insideEntries.length) {
                cellEntries = cellEntries.concat(insideEntries);
                colspan = Math.max(colspan, scan - p + Math.max.apply(null, insideEntries.map(e => e.duration || 1)));
              }
              scan++;
            }
            colspan = Math.max(1, Math.min(numPeriods - p + 1, colspan));
            for (let k = 1; k < colspan; k++) covered[p + k] = true;
            const onlyFullClass = cellEntries.every(isFullClassActivity);
            const cellHtml = onlyFullClass ? renderMergedCell(cellEntries, type) : renderSubgroupCell(cellEntries, type);
            const cellClass = onlyFullClass ? 'filled merged-cell' : 'filled subgroup-cell';
            html += cellHtml.replace('<td class="' + cellClass + ' timetable-slot teacher-slot room-slot"', '<td class="' + cellClass + ' timetable-slot teacher-slot room-slot" data-day="' + di + '" data-period="' + p + '" data-entity="' + esc(name) + '" data-type="' + type + '"' + (colspan > 1 ? ' colspan="' + colspan + '"' : ''));
          } else {
            html += '<td class="timetable-slot teacher-slot room-slot" data-day="' + di + '" data-period="' + p + '" data-entity="' + esc(name) + '" data-type="' + type + '"></td>';
          }
        }
      }
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  $('#btnShowMaster').addEventListener('click', () => {
    if (!requireSchedule()) {
      $('#ttMasterContainer').innerHTML = '<div class="status error">لا يوجد جدول محلول بعد.</div>';
      return;
    }
    $('#ttSingleContainer').innerHTML = '';
    $('#ttAllContainer').innerHTML = '';
    $('#ttMasterContainer').innerHTML = buildMasterGrid($('#ttType').value);
  });
  // Chromium will often shrink a very wide table to one sheet or clip its
  // right side. For master printing, create a real page atlas: each page
  // contains a bounded range of periods for one day and a bounded range of
  // entities. Thus every column and row is printed, regardless of page count.
  function buildMasterPrintPages(type) {
    const d = state.data;
    const numPeriods = d.numHoursPerHalf * 2;
    const periodsPerPage = 8;
    const entitiesPerPage = 18;
    let entityNames = type === 'group' ? d.classes.map(c => c.name) : type === 'teacher' ? d.teachers.map(t => t.name) : d.rooms.map(r => r.name);
    if (!entityNames.length) {
      const key = type === 'teacher' ? 'teacher' : 'room';
      entityNames = Array.from(new Set(state.scheduleEntries.map(e => e[key]).filter(Boolean)));
    }
    const dispFn = type === 'group' ? dispClass : type === 'teacher' ? dispTeacher : dispRoom;
    const typeLabel = { group: 'القسم', teacher: 'الأستاذ', room: 'القاعة' }[type] || 'الجدول';
    const matchEntity = (e, name) => {
      if (type === 'group') {
        const g = String(e.group || '');
        return g === name || g.split(' + ').includes(name) || g.split(' + ').some(x => d.subgroupToClass[x] === name);
      }
      if (type === 'teacher') return String(e.teacher || '').split(' + ').includes(name) || e.teacher === name;
      return String(e.room || '').split(' + ').includes(name) || e.room === name;
    };
    let html = '';
    for (let di = 0; di < d.realDayNames.length; di++) {
      for (let periodStart = 1; periodStart <= numPeriods; periodStart += periodsPerPage) {
        const periodEnd = Math.min(numPeriods, periodStart + periodsPerPage - 1);
        for (let rowStart = 0; rowStart < Math.max(1, entityNames.length); rowStart += entitiesPerPage) {
          const pageEntities = entityNames.slice(rowStart, rowStart + entitiesPerPage);
          html += '<div class="tt-block timetable-page-break master-print-page">' + buildPrintHeader('الجدول الشامل — ' + typeLabel + ' — ' + dispDay(di) + ' — الفترات ' + periodStart + ' إلى ' + periodEnd) + '<h3 class="screen-only-title">الجدول الشامل — ' + esc(typeLabel) + ' — ' + esc(dispDay(di)) + ' — الفترات ' + periodStart + ' إلى ' + periodEnd + '</h3>';
          html += '<table class="tt-grid tt-grid-master timetable-global"><thead><tr><th class="master-corner">' + esc(typeLabel) + '</th>';
          for (let pidx = periodStart; pidx <= periodEnd; pidx++) html += '<th>' + esc(periodLabel(pidx)) + '</th>';
          html += '</tr></thead><tbody>';
          pageEntities.forEach(name => {
            const grid = {};
            state.scheduleEntries.filter(e => e.dayIndex === di && matchEntity(e, name)).forEach(e => {
              if (e.period >= periodStart && e.period <= periodEnd) (grid[e.period] || (grid[e.period] = [])).push(e);
            });
            html += '<tr><th class="master-row-label">' + esc(dispFn(name)) + '</th>';
            const skip = {};
            for (let pidx = periodStart; pidx <= periodEnd; pidx++) {
              if (skip[pidx]) continue;
              const cellEntries = grid[pidx];
              if (cellEntries && cellEntries.length) {
                const colspan = Math.max(1, Math.min(periodEnd - pidx + 1, Math.max.apply(null, cellEntries.map(e => e.duration || 1))));
                for (let k = 1; k < colspan; k++) skip[pidx + k] = true;
                const isFullClass = type !== 'group' || cellEntries.every(e => {
                  const tokens = String(e.group || e.students || '').split(' + ').map(x => x.trim()).filter(Boolean);
                  return tokens.length > 0 && tokens.every(token => token === name);
                });
                const cellHtml = isFullClass ? renderMergedCell(cellEntries, type) : renderSubgroupCell(cellEntries, type);
                const cellClass = isFullClass ? 'filled merged-cell' : 'filled subgroup-cell';
                html += cellHtml.replace('<td class="' + cellClass + ' timetable-slot teacher-slot room-slot"', '<td class="' + cellClass + ' timetable-slot teacher-slot room-slot" data-day="' + di + '" data-period="' + pidx + '" data-entity="' + esc(name) + '" data-type="' + type + '"' + (colspan > 1 ? ' colspan="' + colspan + '"' : ''));
              } else html += '<td class="timetable-slot teacher-slot room-slot" data-day="' + di + '" data-period="' + pidx + '" data-entity="' + esc(name) + '" data-type="' + type + '"></td>';
            }
            html += '</tr>';
          });
          html += '</tbody></table></div>';
        }
      }
    }
    return html || '<div class="status">لا توجد بيانات قابلة للطباعة.</div>';
  }

  $('#btnPrintMaster').addEventListener('click', () => {
    if (!requireSchedule()) { $('#ttMasterContainer').innerHTML = '<div class="status error">لا يوجد جدول محلول بعد.</div>'; return; }
    const type = $('#ttType').value;
    $('#ttSingleContainer').innerHTML = '';
    $('#ttAllContainer').innerHTML = '';
    $('#ttMasterContainer').innerHTML = buildMasterPrintPages(type);
    window.print();
    setTimeout(() => { if ($('#ttMasterContainer')) $('#ttMasterContainer').innerHTML = buildMasterGrid(type); }, 500);
  });

  // ---- V4.0: Excel export ----
  // Exports any rendered <table> as a real, openable Excel file, using the
  // long-standing HTML-table-as-.xls trick (Excel opens HTML with the right
  // MIME/extension natively) — works fully offline, no library needed.
  function exportTableToExcel(tableEl, fileName) {
    if (!tableEl) { alert('لا يوجد جدول لعرضه للتصدير بعد.'); return; }
    const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">' +
      '<style>table{direction:rtl;border-collapse:collapse;}th{background:#2c3e50;color:#fff;font-weight:bold;border:1px solid #bdc3c7;text-align:center;}' +
      'td{border:1px solid #bdc3c7;text-align:center;vertical-align:middle;font-size:11px;}</style></head>' +
      '<body>' + tableEl.outerHTML + '</body></html>';
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName + '.xls';
    a.click();
    URL.revokeObjectURL(url);
  }
  $('#btnExportExcelSingle').addEventListener('click', () => {
    const table = document.querySelector('#ttSingleContainer table') || document.querySelector('#ttAllContainer table');
    exportTableToExcel(table, 'جدول_' + ($('#ttEntity').value || 'الحصص'));
  });
  $('#btnExportExcelMaster').addEventListener('click', () => {
    const table = document.querySelector('#ttMasterContainer table');
    exportTableToExcel(table, 'الجدول_الشامل_' + $('#ttType').value);
  });

  // ===================== TAB 4: VACANT ROOMS =====================
  $('#btnBuildVacant').addEventListener('click', () => {
    if (!requireSchedule()) {
      $('#vacantContainer').innerHTML = '<div class="status error">لا يوجد جدول محلول بعد — ولّد الجدول أو استورده من التبويب الأول.</div>';
      return;
    }
    const d = state.data;
    const numPeriods = d.numHoursPerHalf * 2;
    const days = d.realDayNames;
    const allRoomNames = d.rooms.map(r => r.name);

    const occupied = {}; // "day-period" -> Set(roomNames in use)
    state.scheduleEntries.forEach(e => {
      if (!e.room) return;
      // A 2-hour (or longer) activity occupies its room for EVERY period it
      // spans, not just its starting period — otherwise a room used by a
      // double-period session looks "free" in its second hour.
      const span = Math.max(1, e.duration || 1);
      for (let k = 0; k < span; k++) {
        const key = e.dayIndex + '-' + (e.period + k);
        if (!occupied[key]) occupied[key] = new Set();
        occupied[key].add(e.room);
      }
    });

    let html = '<div class="tt-block">' + buildPrintHeader('القاعات الشاغرة حسب اليوم والفترة') + '<h3 class="screen-only-title">القاعات الشاغرة حسب اليوم والفترة</h3>';
    html += '<table class="tt-grid tt-grid-hv"><thead><tr><th>اليوم</th>';
    for (let p = 1; p <= numPeriods; p++) html += '<th>' + esc(periodLabel(p)) + '</th>';
    html += '</tr></thead><tbody>';
    for (let di = 0; di < days.length; di++) {
      html += '<tr><th>' + esc(dispDay(di)) + '</th>';
      for (let p = 1; p <= numPeriods; p++) {
        const used = occupied[di + '-' + p] || new Set();
        const free = allRoomNames.filter(r => !used.has(r));
        html += '<td class="vacant-cell">' + (free.length ? esc(free.join('، ')) : '<em>لا توجد قاعات شاغرة</em>') + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    $('#vacantContainer').innerHTML = html;
  });
  $('#btnPrintVacant').addEventListener('click', () => window.print());

  // ===================== TAB 5: aSc EXPORT =====================
  function buildAscFullXml() {
    const d = state.data;
    if (!requireSchedule()) throw new Error('لا يوجد جدول محلول لتصديره. ولّد الجدول أولاً.');

    const teachers = d.teachers.map((t, i) => ({ id: '*' + (i + 1), name: t.name }));
    const teacherIdx = Object.create(null);
    teachers.forEach(t => { teacherIdx[t.name] = t.id; });

    const subjects = d.subjects.map((s, i) => ({ id: '*' + (i + 1), name: s.name }));
    const subjectIdx = Object.create(null);
    subjects.forEach(s => { subjectIdx[s.name] = s.id; });

    const rooms = d.rooms.map((r, i) => ({ id: '*' + (i + 1), name: r.name }));
    const roomIdx = Object.create(null);
    rooms.forEach(r => { roomIdx[r.name] = r.id; });

    const classes = d.classes.map((c, i) => ({ id: '*' + (i + 1), name: c.name }));
    const classIdx = Object.create(null);
    classes.forEach(c => { classIdx[c.name] = c.id; });

    const groups = [];
    const groupIdx = Object.create(null);
    d.classes.forEach(c => {
      const full = { id: '*' + (10 + groups.length), name: 'القسم كامل', classid: classIdx[c.name], entireclass: '1', divisiontag: '0' };
      groups.push(full);
      groupIdx[c.name] = full.id;
    });
    // Subgroups are never shown in the app's own UI (item 5), but the aSc
    // export still needs a "group" entry per subgroup internally so that
    // parallel subgroup activities (e.g. TP/TD sessions) resolve correctly
    // once imported into aSc Timetables.
    Object.keys(d.subgroupToClass).forEach(sgName => {
      const parentClass = d.subgroupToClass[sgName];
      const sub = { id: '*' + (10 + groups.length), name: sgName, classid: classIdx[parentClass], entireclass: '0', divisiontag: '1' };
      groups.push(sub);
      groupIdx[sgName] = sub.id;
    });

    const lessons = [];
    const cards = [];
    let lessonSeq = 0;
    const seenActivityIds = new Set();
    state.scheduleEntries.forEach(e => {
      if (seenActivityIds.has(e.activityId)) return; // one card per activity
      seenActivityIds.add(e.activityId);
      lessonSeq++;
      const lessonId = '*' + lessonSeq;
      const roomId = roomIdx[e.room] || '';
      lessons.push({
        id: lessonId,
        subjectid: subjectIdx[e.subject] || '',
        classids: classIdx[e.group] || (d.subgroupToClass[e.group] ? classIdx[d.subgroupToClass[e.group]] : ''),
        groupids: groupIdx[e.group] || '',
        teacherids: teacherIdx[e.teacher] || '',
        classroomids: roomId,
        periodspercard: String(e.duration >= 2 ? 2 : 1),
        periodsperweek: '1',
        weeks: '1'
      });
      cards.push({ day: String(e.dayIndex), period: String(e.period), classroomids: roomId, lessonid: lessonId });
    });

    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<timetable ascttversion="2010.3.1" importtype="database" options="idprefix:XML,groupstype1,decimalseparatordot" defaultexport="1">');

    lines.push('<days options="canadd" columns="day,name,short">');
    const shortMap = { 'الأحد':'DIM','الاثنين':'LUN','الإثنين':'LUN','الثلاثاء':'MAR','الأربعاء':'MER','الاربعاء':'MER','الخميس':'JEU','الجمعة':'VEN','السبت':'SAM' };
    d.realDayNames.forEach((nm, i) => {
      lines.push('<day day="' + i + '" short="' + (shortMap[nm] || ('D' + i)) + '" name="' + esc(nm) + '"/>');
    });
    lines.push('</days>');

    lines.push('<periods options="canadd" columns="period,starttime,endtime">');
    const numPeriods = d.numHoursPerHalf * 2;
    lines.push('<period period="0" starttime="7:00" endtime="8:00"/>');
    for (let p = 1; p <= numPeriods; p++) {
      const start = (d.realHours[p - 1] && d.realHours[p - 1].start) || (7 + p) + ':00';
      const end = (d.realHours[p] && d.realHours[p].start) || (8 + p) + ':00';
      lines.push('<period period="' + p + '" starttime="' + esc(start) + '" endtime="' + esc(end) + '"/>');
    }
    lines.push('</periods>');
    lines.push('<dayperiods options="canadd" columns="day,period,starttime,endtime"/>');

    lines.push('<teachers options="canadd" columns="id,name,short,gender,color">');
    teachers.forEach(t => lines.push('<teacher id="' + esc(t.id) + '" short="' + esc(t.name) + '" name="' + esc(t.name) + '" color="" gender=""/>'));
    lines.push('</teachers>');

    lines.push('<classes options="canadd" columns="id,name,short,classroomids,teacherid,grade">');
    classes.forEach(c => lines.push('<class id="' + esc(c.id) + '" short="' + esc(c.name) + '" name="' + esc(c.name) + '" grade="" classroomids="" teacherid=""/>'));
    lines.push('</classes>');

    lines.push('<subjects options="canadd" columns="id,name,short">');
    subjects.forEach(s => lines.push('<subject id="' + esc(s.id) + '" short="' + esc(s.name) + '" name="' + esc(s.name) + '"/>'));
    lines.push('</subjects>');

    lines.push('<classrooms options="canadd" columns="id,name,short">');
    rooms.forEach(r => lines.push('<classroom id="' + esc(r.id) + '" short="' + esc(r.name) + '" name="' + esc(r.name) + '"/>'));
    lines.push('</classrooms>');

    lines.push('<students options="canadd" columns="id,classid,name"/>');

    lines.push('<groups options="canadd" columns="id,classid,name,entireclass,divisiontag,studentcount">');
    groups.forEach(g => lines.push('<group id="' + esc(g.id) + '" name="' + esc(g.name) + '" studentcount="" divisiontag="' + g.divisiontag + '" entireclass="' + g.entireclass + '" classid="' + esc(g.classid) + '"/>'));
    lines.push('</groups>');

    lines.push('<lessons options="canadd" columns="id,subjectid,classids,groupids,studentids,teacherids,classroomids,periodspercard,periodsperweek,weeks">');
    lessons.forEach(l => lines.push(
      '<lesson id="' + esc(l.id) + '" classroomids="' + esc(l.classroomids) + '" weeks="' + l.weeks +
      '" studentids="" groupids="' + esc(l.groupids) + '" teacherids="' + esc(l.teacherids) +
      '" periodsperweek="' + l.periodsperweek + '" periodspercard="' + l.periodspercard +
      '" subjectid="' + esc(l.subjectid) + '" classids="' + esc(l.classids) + '"/>'
    ));
    lines.push('</lessons>');

    lines.push('<cards options="canadd" columns="day,period,classroomids,lessonid">');
    cards.forEach(c => lines.push('<card day="' + c.day + '" period="' + c.period + '" classroomids="' + esc(c.classroomids) + '" lessonid="' + esc(c.lessonid) + '"/>'));
    lines.push('</cards>');

    lines.push('<grades options="canadd" columns="id,name,short,grade">');
    for (let i = 1; i <= 20; i++) lines.push('<grade id="*' + i + '" short="' + i + '" name="' + i + '" grade="' + i + '"/>');
    lines.push('</grades>');

    lines.push('</timetable>');
    return lines.join('\n');
  }

  function buildScheduleOnlyText() {
    if (!requireSchedule()) throw new Error('لا يوجد جدول محلول لتصديره. ولّد الجدول أولاً.');
    const d = state.data;
    const lines = state.scheduleEntries.map(e => {
      const groupLabel = d.subgroupToClass[e.group] || e.group; // show the full class, never the subgroup
      return 'القسم ' + groupLabel + ' — ' + e.dayName + ' — الفترة ' + e.period +
        ' — الحصة: ' + e.subject + ' — الاستاذ: ' + e.teacher + ' — القاعة: ' + (e.room || '—');
    });
    return lines.join('\n');
  }

  $('#btnExport').addEventListener('click', async () => {
    const mode = document.querySelector('input[name="ascMode"]:checked').value;
    try {
      if (mode === 'all') {
        const xml = buildAscFullXml();
        $('#exportPreview').style.display = 'block';
        $('#exportPreview').textContent = xml.slice(0, 4000) + (xml.length > 4000 ? '\n…' : '');
        const saved = await window.fetApp.saveText({ defaultName: 'timetable_aSc.xml', content: xml, extension: 'xml' });
        setStatus($('#exportStatus'), saved ? '✔ تم الحفظ في: ' + saved : 'تم الإلغاء', saved ? 'success' : 'info');
      } else {
        const text = buildScheduleOnlyText();
        $('#exportPreview').style.display = 'block';
        $('#exportPreview').textContent = text.slice(0, 4000) + (text.length > 4000 ? '\n…' : '');
        const saved = await window.fetApp.saveText({ defaultName: 'جدول_الحصص.txt', content: text, extension: 'txt' });
        setStatus($('#exportStatus'), saved ? '✔ تم الحفظ في: ' + saved : 'تم الإلغاء', saved ? 'success' : 'info');
      }
    } catch (err) {
      setStatus($('#exportStatus'), 'خطأ: ' + err.message, 'error');
    }
  });

  // ===================== SETTINGS MODAL (tabbed pages) =====================
  function openSettingsModal() {
    $('#settingsModal').style.display = 'flex';
    renderSettingsPage($('.settings-subtab.active').dataset.sstab);
  }
  function closeSettingsModal() { $('#settingsModal').style.display = 'none'; }
  $('#btnOpenSettings').addEventListener('click', openSettingsModal);
  $('#btnCloseSettings').addEventListener('click', closeSettingsModal);
  $all('.settings-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.settings-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSettingsPage(btn.dataset.sstab);
    });
  });

  function settingsRow(label, inputHtml) {
    return '<div class="settings-row"><div class="settings-input">' + inputHtml +
      '</div><div class="settings-label">' + esc(label) + '</div></div>';
  }

  // <input type="color"> only accepts #rrggbb — convert our generated
  // hsl(...) strings (and pass through any hex the user already picked).
  function hslToHex(color) {
    if (!color) return '#ffffff';
    if (color[0] === '#') return color;
    const m = color.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/i);
    if (!m) return '#ffffff';
    let [h, s, l] = [+m[1], +m[2] / 100, +m[3] / 100];
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), mm = l - c / 2;
    let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const toHex = v => Math.round((v + mm) * 255).toString(16).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function renderSettingsPage(page) {
    const body = $('#settingsBody');
    const d = state.data;
    if (page !== 'institution' && !d) {
      body.innerHTML = '<p class="muted" style="padding:20px;">حمّل ملف FET أولاً (من التبويب الأول) حتى تظهر هنا القوائم القابلة للتعديل.</p>';
      return;
    }
    const inst = state.settings.institution;

    if (page === 'institution') {
      body.innerHTML =
        settingsRow('اسم المؤسسة', '<input type="text" id="setInstName" value="' + esc(inst.name) + '">') +
        settingsRow('البلدية', '<input type="text" id="setInstMun" value="' + esc(inst.municipality) + '" placeholder="مثال: عين الخضرة">') +
        settingsRow('الولاية', '<input type="text" id="setInstWil" value="' + esc(inst.wilaya) + '" placeholder="مثال: الجزائر">') +
        settingsRow('الموسم الدراسي', '<input type="text" id="setInstSeason" value="' + esc(inst.season) + '" placeholder="مثال: 2026-2027">') +
        settingsRow('عدد ساعات العمل الواجبة (افتراضي لجميع الأساتذة)', '<input type="number" id="setInstHours" value="' + esc(inst.defaultWeeklyHours) + '" style="width:100px">') +
        '<div class="settings-header-section"><label for="setInstHeaderLines">رأس الصفحة (عدة أسطر)</label><textarea id="setInstHeaderLines" rows="5" placeholder="السطر الأول\nالسطر الثاني\nالسطر الثالث">' + esc((inst.headerLines || []).join('\n')) + '</textarea><small>السطران الأول والثاني في الوسط، والسطر الثالث إلى اليمين.</small></div>';
    } else if (page === 'teachers') {
      body.innerHTML = '<p class="settings-hint">عدّل اسم العرض لأي أستاذ(ة). الاسم الأصلي من الملف يبقى بين قوسين للتوضيح.</p>' +
        d.teachers.map(t => {
          const a = state.settings.teacherAlias[t.name] || {};
          return settingsRow(t.name,
            '<input type="text" class="set-teacher-display" data-orig="' + esc(t.name) + '" value="' + esc(a.display || '') + '" placeholder="' + esc(t.name) + '">' +
            '<input type="number" class="set-teacher-hours" data-orig="' + esc(t.name) + '" value="' + esc(a.hours != null ? a.hours : '') + '" style="width:70px" placeholder="ساعات">' +
            '<input type="text" class="set-teacher-code" data-orig="' + esc(t.name) + '" value="' + esc(a.code || '') + '" style="width:70px" placeholder="رمز">'
          );
        }).join('');
    } else if (page === 'classes') {
      body.innerHTML = '<p class="settings-hint">عدّل اسم العرض لأي قسم.</p>' +
        d.classes.map(c => settingsRow(c.name,
          '<input type="text" class="set-class-display" data-orig="' + esc(c.name) + '" value="' + esc(state.settings.classAlias[c.name] || '') + '" placeholder="' + esc(c.name) + '">'
        )).join('');
    } else if (page === 'rooms') {
      body.innerHTML = '<p class="settings-hint">عدّل اسم العرض لأي قاعة.</p>' +
        d.rooms.map(r => settingsRow(r.name,
          '<input type="text" class="set-room-display" data-orig="' + esc(r.name) + '" value="' + esc(state.settings.roomAlias[r.name] || '') + '" placeholder="' + esc(r.name) + '">'
        )).join('');
    } else if (page === 'subjects') {
      body.innerHTML = '<p class="settings-hint">عدّل اسم العرض لأي مادة.</p>' +
        d.subjects.map(s => settingsRow(s.name,
          '<input type="text" class="set-subject-display" data-orig="' + esc(s.name) + '" value="' + esc(state.settings.subjectAlias[s.name] || '') + '" placeholder="' + esc(s.name) + '">'
        )).join('');
    } else if (page === 'days') {
      body.innerHTML = '<p class="settings-hint">عدّل اسم اليوم كما يظهر في رأس الجدول (استبدال «الأحد» بـ«يوم 1» مثلاً).</p>' +
        d.realDayNames.map((nm, i) => settingsRow(nm,
          '<input type="text" class="set-day" data-idx="' + i + '" value="' + esc((state.settings.dayLabels[i]) || '') + '" placeholder="' + esc(nm) + '">'
        )).join('');
    } else if (page === 'periods') {
      const numPeriods = d.numHoursPerHalf * 2;
      let rowsHtml = '<p class="settings-hint">عدّل اسم كل حصة كما يظهر في رأس الجدول. مثال: الحصة 1، 08:00-9:00…</p>';
      for (let p = 1; p <= numPeriods; p++) {
        rowsHtml += settingsRow('الحصة ' + p,
          '<input type="text" class="set-period" data-idx="' + (p - 1) + '" value="' + esc((state.settings.periodLabels[p - 1]) || '') + '" placeholder="' + esc(periodLabel(p)) + '">'
        );
      }
      body.innerHTML = rowsHtml;
    } else if (page === 'colors') {
      const dims = [
        { key: 'subjects', label: 'المواد', names: d.subjects.map(s => s.name), disp: dispSubject },
        { key: 'teachers', label: 'الأساتذة', names: d.teachers.map(t => t.name), disp: dispTeacher },
        { key: 'classes', label: 'الأقسام', names: d.classes.map(c => c.name), disp: dispClass },
        { key: 'rooms', label: 'القاعات', names: d.rooms.map(r => r.name), disp: dispRoom }
      ];
      const activeDim = state.settings.colorDimTab || 'subjects';
      let html = '<div class="color-dim-tabs">' + dims.map(dm =>
        '<button type="button" class="color-dim-btn' + (dm.key === activeDim ? ' active' : '') + '" data-dim="' + dm.key + '">' + dm.label + '</button>'
      ).join('') + '</div>';
      html += '<p class="settings-hint">لون كل عنصر يُنشأ تلقائياً أول مرة، ويمكن تغييره هنا. "لوّن الخانات حسب" (في تبويب الجداول) يحدد أي بُعد من هذه الأبعاد يُستعمل فعلياً في الطباعة.</p>';
      const dim = dims.find(dm => dm.key === activeDim);
      html += dim.names.map(name => {
        const color = getEntityColor(dim.key, name);
        return settingsRow(dim.disp(name),
          '<button type="button" class="btn btn-secondary btn-reset-color" data-dim="' + dim.key + '" data-orig="' + esc(name) + '">↺</button>' +
          '<input type="color" class="set-color" data-dim="' + dim.key + '" data-orig="' + esc(name) + '" value="' + hslToHex(color) + '">'
        );
      }).join('');
      body.innerHTML = html;
      $all('.color-dim-btn').forEach(btn => btn.addEventListener('click', () => {
        state.settings.colorDimTab = btn.dataset.dim;
        renderSettingsPage('colors');
      }));
      $all('.set-color').forEach(inp => inp.addEventListener('input', () => {
        state.settings.colors[inp.dataset.dim][inp.dataset.orig] = inp.value;
        saveSettingsToDisk();
      }));
      $all('.btn-reset-color').forEach(btn => btn.addEventListener('click', () => {
        delete state.settings.colors[btn.dataset.dim][btn.dataset.orig];
        saveSettingsToDisk();
        renderSettingsPage('colors');
      }));
    } else if (page === 'icons') {
      body.innerHTML = '<p class="settings-hint">ارفع أيقونة صغيرة لكل مادة (اختياري) تظهر بجانب اسمها في الخانات، إن كان خيار "إظهار صور المواد" مفعّلاً.</p>' +
        d.subjects.map(s => {
          const icon = state.settings.subjectIcons[s.name];
          return settingsRow(dispSubject(s.name),
            (icon ? '<img class="icon-preview" src="' + icon + '">' : '') +
            '<input type="file" accept="image/*" class="set-icon" data-orig="' + esc(s.name) + '">' +
            (icon ? '<button type="button" class="btn btn-secondary btn-clear-icon" data-orig="' + esc(s.name) + '">✕</button>' : '')
          );
        }).join('');
      $all('.set-icon').forEach(inp => inp.addEventListener('change', (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          state.settings.subjectIcons[inp.dataset.orig] = reader.result;
          saveSettingsToDisk();
          renderSettingsPage('icons');
        };
        reader.readAsDataURL(file);
      }));
      $all('.btn-clear-icon').forEach(btn => btn.addEventListener('click', () => {
        delete state.settings.subjectIcons[btn.dataset.orig];
        saveSettingsToDisk();
        renderSettingsPage('icons');
      }));
    }
  }

  $('#btnSaveSettings').addEventListener('click', () => {
    const inst = state.settings.institution;
    if ($('#setInstName')) {
      inst.name = $('#setInstName').value.trim();
      inst.municipality = $('#setInstMun').value.trim();
      inst.wilaya = $('#setInstWil').value.trim();
      inst.season = $('#setInstSeason').value.trim();
      inst.defaultWeeklyHours = Number($('#setInstHours').value) || 20;
      inst.headerLines = String($('#setInstHeaderLines').value || '').split(/\r?\n/).slice(0, 20).map(line => line.trim());
    }
    $all('.set-teacher-display').forEach(inp => {
      const orig = inp.dataset.orig;
      const hours = document.querySelector('.set-teacher-hours[data-orig="' + CSS.escape(orig) + '"]');
      const code = document.querySelector('.set-teacher-code[data-orig="' + CSS.escape(orig) + '"]');
      state.settings.teacherAlias[orig] = {
        display: inp.value.trim(),
        hours: hours && hours.value !== '' ? Number(hours.value) : null,
        code: code ? code.value.trim() : ''
      };
    });
    $all('.set-class-display').forEach(inp => { state.settings.classAlias[inp.dataset.orig] = inp.value.trim(); });
    $all('.set-room-display').forEach(inp => { state.settings.roomAlias[inp.dataset.orig] = inp.value.trim(); });
    $all('.set-subject-display').forEach(inp => { state.settings.subjectAlias[inp.dataset.orig] = inp.value.trim(); });
    $all('.set-day').forEach(inp => { state.settings.dayLabels[Number(inp.dataset.idx)] = inp.value.trim(); });
    $all('.set-period').forEach(inp => { state.settings.periodLabels[Number(inp.dataset.idx)] = inp.value.trim(); });

    saveSettingsToDisk();
    $('#settingsStatus').textContent = '✔ تم حفظ الإعدادات.';
    if (state.data) { populateEntitySelectors(); }
  });

  $('#btnResetSettings').addEventListener('click', () => {
    state.settings = defaultSettings();
    saveSettingsToDisk();
    $('#settingsStatus').textContent = 'تمت إعادة الضبط الافتراضي.';
    renderSettingsPage($('.settings-subtab.active').dataset.sstab);
    if (state.data) populateEntitySelectors();
  });

  // Requested native controls and print/settings behavior.
  $('#btnPickOutput').addEventListener('click', async () => { const p = await window.fetApp.pickOutputDir(); if (p) { $('#outputDir').value = p; state.settings.outputDir = p; saveSettingsToDisk(); } });
  $('#btnStopGenerate').addEventListener('click', async () => { if (state.currentRunId) { await window.fetApp.cancelGenerate(state.currentRunId); setStatus($('#genStatus'), 'تم طلب إيقاف التوليد؛ سيُحفظ أفضل ناتج متاح.', 'info'); } });
  window.fetApp.onGenerationProgress((data) => {
    if (data.runId !== state.currentRunId) return;
    if (data.type === 'log') {
      $('#genLog').style.display = 'block';
      $('#genLog').textContent = ($('#genLog').textContent + data.text).slice(-6000);
    } else if (data.type === 'table-start') {
      setStatus($('#genStatus'), 'بدأ إنتاج Table_' + data.tableIndex + ' من ' + data.totalTables + ' — ' + data.tracksPerTable + ' مسارات متوازية', 'info');
    } else if (data.type === 'attempt-start') {
      state.trackProgress[data.attemptIndex] = Object.assign(state.trackProgress[data.attemptIndex] || {}, { seed: data.seed, placed: 0, historicalPlaced: 0, status: 'running', tableIndex: data.tableIndex, trackIndex: data.trackIndex, hours: 0, minutes: 0, seconds: 0 });
      const card = $('#track-card-' + data.attemptIndex);
      if (card) { card.querySelector('.track-seed').textContent = data.seed ? 'Seed: ' + data.seed : 'العشوائية الداخلية'; card.querySelector('strong').textContent = 'Table_' + data.tableIndex + ' / Track_' + data.trackIndex; card.classList.add('running'); }
      setStatus($('#genStatus'), 'Table_' + data.tableIndex + ': تشغيل ' + data.totalAttempts + ' مسارات بالتوازي… بدأ Track_' + data.trackIndex, 'info');
    } else if (data.type === 'placed') {
      const current = state.trackProgress[data.attemptIndex] || {};
      current.placed = Number(data.placed || 0); current.historicalPlaced = Math.max(Number(current.historicalPlaced || 0), Number(data.historicalPlaced || data.placed || 0)); current.hours = Number(data.hours || 0); current.minutes = Number(data.minutes || 0); current.seconds = Number(data.seconds || 0);
      state.trackProgress[data.attemptIndex] = current;
      const card = $('#track-card-' + data.attemptIndex);
      if (card) { card.querySelector('.track-time').textContent = 'الوقت: ' + current.hours + 'سا و ' + current.minutes + 'د و ' + current.seconds + 'ثا'; card.querySelector('.track-placed').textContent = 'Max Placed الحالي: ' + current.placed + (data.total ? ' من ' + data.total : '') + ' نشاط'; if (card.querySelector('.track-history')) card.querySelector('.track-history').textContent = 'Highest Placed التاريخي: ' + current.historicalPlaced + ' نشاط'; if (state.data && state.data.activities.length) card.querySelector('.track-bar i').style.width = Math.min(100, Math.round(100 * current.placed / state.data.activities.length)) + '%'; }
      const bestPair = Object.entries(state.trackProgress).reduce((best, pair) => Number(pair[1].historicalPlaced || pair[1].placed || 0) > Number(best[1].historicalPlaced || best[1].placed || 0) ? pair : best, ['0', { placed: 0, historicalPlaced: 0, hours: 0, minutes: 0, seconds: 0 }]);
      const best = Number(bestPair[1].historicalPlaced || bestPair[1].placed || 0);
      const bestLabel = bestPair[1].tableIndex ? 'Table_' + bestPair[1].tableIndex + ' / Track_' + bestPair[1].trackIndex : 'المسارات';
      $('#genPlacedInfo').textContent = '📊 أعلى توزيع تاريخي: ' + best + ' — ' + bestLabel + ' — في ' + (bestPair[1].hours || 0) + 'سا و ' + (bestPair[1].minutes || 0) + 'د و ' + (bestPair[1].seconds || 0) + 'ثا';
      if (state.data && state.data.activities.length) $('#generationProgress').style.width = Math.min(100, Math.round(100 * best / state.data.activities.length)) + '%';
    } else if (data.type === 'historical-max') {
      const current = state.trackProgress[data.attemptIndex] || {};
      current.historicalPlaced = Math.max(Number(current.historicalPlaced || 0), Number(data.placed || 0)); current.historicalHours = Number(data.hours || 0); current.historicalMinutes = Number(data.minutes || 0); current.historicalSeconds = Number(data.seconds || 0);
      state.trackProgress[data.attemptIndex] = current;
      const card = $('#track-card-' + data.attemptIndex);
      if (card && card.querySelector('.track-history')) card.querySelector('.track-history').textContent = 'Highest Placed التاريخي: ' + current.historicalPlaced + ' نشاط — عند ' + current.historicalHours + 'سا و ' + current.historicalMinutes + 'د و ' + current.historicalSeconds + 'ثا';
      const historicalBest = Math.max.apply(null, Object.values(state.trackProgress).map(x => Number(x.historicalPlaced || 0)).concat([0]));
      $('#genPlacedInfo').textContent = '📊 أعلى توزيع تاريخي: ' + historicalBest + ' نشاط — محفوظ لكل مسار عند كل رقم قياسي';
      if (state.data && state.data.activities.length) $('#generationProgress').style.width = Math.min(100, Math.round(100 * historicalBest / state.data.activities.length)) + '%';
    } else if (data.type === 'attempt-done') {
      const current = state.trackProgress[data.attemptIndex] || {};
      current.placed = Math.max(Number(current.placed || 0), Number(data.currentPlaced != null ? data.currentPlaced : data.placed || 0)); current.historicalPlaced = Math.max(Number(current.historicalPlaced || 0), Number(data.historicalPlaced != null ? data.historicalPlaced : data.placed || 0)); current.status = data.complete ? 'complete' : 'done'; state.trackProgress[data.attemptIndex] = current;
      const card = $('#track-card-' + data.attemptIndex);
      if (card) { card.classList.remove('running'); card.classList.add(data.complete ? 'complete' : 'done'); card.querySelector('.track-placed').textContent = 'Max Placed الحالي: ' + current.placed + (data.total ? ' من ' + data.total : '') + ' نشاط' + (data.complete ? ' — حل كامل ✔' : ''); if (card.querySelector('.track-history')) card.querySelector('.track-history').textContent = 'Highest Placed التاريخي: ' + current.historicalPlaced + ' نشاط'; }
    } else if (data.type === 'winner-found') {
      const card = $('#track-card-' + data.attemptIndex);
      if (card) { card.classList.remove('running'); card.classList.add('winner'); card.querySelector('.track-seed').textContent += ' — الفائز التاريخي'; if (card.querySelector('.track-history')) card.querySelector('.track-history').textContent = 'Highest Placed التاريخي: ' + (data.historicalPlaced || data.placed || 0) + ' نشاط'; }
      setStatus($('#genStatus'), 'نجح Table_' + data.tableIndex + ' عبر Track_' + data.trackIndex + '؛ جارٍ إيقاف المسارات الأخرى ثم الانتقال للجدول التالي…', 'success');
    } else if (data.type === 'table-done') {
      setStatus($('#genStatus'), 'اكتمل Table_' + data.tableIndex + ' عبر Track_' + (data.trackIndex || '—') + ' — Highest Placed التاريخي: ' + (data.historicalPlaced || data.placed || 0) + ' نشاط — التوزيع الحالي عند الإيقاف: ' + (data.currentPlaced || data.placed || 0) + ' — المجلد: ' + (data.outDir || '—'), data.complete ? 'success' : 'info');
    } else if (data.type === 'run-done') {
      triggerCompletionAlarm();
      const winnerIndex = data.winnerAttempt;
      const card = $('#track-card-' + winnerIndex);
      if (card) { card.classList.remove('running'); card.classList.add('winner'); card.querySelector('.track-seed').textContent += ' — الفائز النهائي'; if (card.querySelector('.track-history')) card.querySelector('.track-history').textContent = 'Highest Placed التاريخي: ' + (data.historicalPlaced || data.placed || 0) + ' نشاط'; }
      $('#genPlacedInfo').textContent = '🎯 الفائز التاريخي: Table_' + (data.winnerTable || 1) + ' / Track_' + (data.winnerTrack || data.winnerAttempt || '—') + ' — أعلى توزيع: ' + (data.historicalPlaced || data.placed || 0) + ' نشاط';
    } else if (data.type === 'seed-fallback') {
      const card = $('#track-card-' + data.attemptIndex);
      if (card) card.querySelector('.track-seed').textContent = 'إعادة بدون --randomseed';
    } else if (data.type === 'run-stopped') {
      triggerCompletionAlarm();
      setStatus($('#genStatus'), 'تم إيقاف جميع المسارات وحفظ أفضل نتيجة متاحة.', 'info');
    }
  }); // @page cannot be scoped by a CSS class, so we inject/update a dedicated
  // <style> tag to switch print orientation at runtime (item 2 defaults to
  // landscape/full-page for individual timetables).
  function applyPrintPageSize(orientation) {
    let styleEl = document.getElementById('printPageStyle');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'printPageStyle';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = '@media print { @page { size: ' + orientation + '; margin: 10mm; } }';
  }
  applyPrintPageSize('landscape');

  $('#btnApplyPrint').addEventListener('click', () => { applyPrintPageSize($('#printOrientation').value); });
  function refreshRenderedTables() {
    if (!state.data || !requireSchedule()) return;
    const type = $('#ttType').value;
    const name = $('#ttEntity').value;
    if ($('#ttSingleContainer').innerHTML.trim()) $('#ttSingleContainer').innerHTML = buildGridBlock(type, name);
    if ($('#ttAllContainer').innerHTML.trim()) {
      const names = type === 'group' ? state.data.classes.map(c => c.name) : type === 'teacher' ? state.data.teachers.map(t => t.name) : state.data.rooms.map(r => r.name);
      $('#ttAllContainer').innerHTML = names.map(n => buildGridBlock(type, n)).join('');
    }
    if ($('#ttMasterContainer').innerHTML.trim()) $('#ttMasterContainer').innerHTML = buildMasterGrid(type);
  }
  $('#chk-print-color').addEventListener('change', () => { state.settings.colorsEnabled = $('#chk-print-color').checked; saveSettingsToDisk(); refreshRenderedTables(); });
  $('#colorByDim').addEventListener('change', () => { state.settings.colorBy = $('#colorByDim').value; saveSettingsToDisk(); refreshRenderedTables(); });
  $('#btnSaveData').addEventListener('click', async () => {
    if (!state.fetText) return;
    const saved = await window.fetApp.saveFet({ filePath: state.fetPath, content: state.fetText });
    if (saved) setStatus($('#fetLoadStatus'), 'تم حفظ الملف في: ' + saved, 'success');
  });

  // ===================== HTML5 Drag & Drop Engine with Teacher Availability Highlights =====================
  let draggedActivity = null;

  function isTeacherAvailableAt(teacherName, dayIndex, period, duration, currentActivityId) {
    if (!state.scheduleEntries || !teacherName) return true;
    const teacherNames = String(teacherName).split(' + ').map(t => t.trim()).filter(Boolean);
    const endPeriod = period + (duration || 1) - 1;
    
    // Check conflicts with other scheduled entries
    for (const e of state.scheduleEntries) {
      if (e.activityId === currentActivityId) continue;
      if (e.dayIndex !== dayIndex) continue;
      
      const eTeachers = String(e.teacher || '').split(' + ').map(t => t.trim()).filter(Boolean);
      const hasTeacherOverlap = teacherNames.some(t => eTeachers.includes(t));
      if (!hasTeacherOverlap) continue;

      const eStart = e.period;
      const eEnd = e.period + (e.duration || 1) - 1;
      // Overlap condition
      if (period <= eEnd && eStart <= endPeriod) {
        return false; // Busy / conflict
      }
    }
    return true;
  }

  function highlightSlotsForActivity(activity) {
    const slots = document.querySelectorAll('.timetable-slot, td.filled, td:not(.day-label):not(.master-row-label):not(.master-corner)');
    slots.forEach(slot => {
      if (slot.tagName.toLowerCase() === 'th') return;
      const day = slot.getAttribute('data-day');
      const period = slot.getAttribute('data-period');
      if (day === null || day === undefined || !period) return;

      const dIdx = parseInt(day, 10);
      const pIdx = parseInt(period, 10);
      const dur = activity.duration || 1;
      const tName = activity.teacher || '';

      const isAllowed = isTeacherAvailableAt(tName, dIdx, pIdx, dur, activity.activityId);
      slot.classList.remove('slot-allowed', 'slot-restricted');
      if (isAllowed) {
        slot.classList.add('slot-allowed');
      } else {
        slot.classList.add('slot-restricted');
      }
    });
  }

  function clearSlotHighlights() {
    document.querySelectorAll('.slot-allowed, .slot-restricted, .drop-target').forEach(el => {
      el.classList.remove('slot-allowed', 'slot-restricted', 'drop-target');
    });
    document.querySelectorAll('.activity-card.dragging').forEach(el => el.classList.remove('dragging'));
  }

  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.activity-card, .mini-block, .merged-activity-content');
    if (!card) return;
    const actId = card.getAttribute('data-activity-id');
    const teacher = card.getAttribute('data-teacher');
    const group = card.getAttribute('data-group');
    const day = parseInt(card.getAttribute('data-day') || '-1', 10);
    const period = parseInt(card.getAttribute('data-period') || '-1', 10);
    
    let entry = null;
    if (state.scheduleEntries) {
      entry = state.scheduleEntries.find(se => se.activityId === actId) ||
              state.scheduleEntries.find(se => se.teacher === teacher && se.group === group && se.dayIndex === day && se.period === period);
    }
    if (!entry) {
      entry = { activityId: actId, teacher, group, dayIndex: day, period, duration: 1 };
    }

    draggedActivity = entry;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        activityId: entry.activityId,
        teacher: entry.teacher,
        group: entry.group,
        duration: entry.duration || 1
      }));
    } catch (err) {}

    setTimeout(() => {
      highlightSlotsForActivity(entry);
    }, 10);
  });

  document.addEventListener('dragover', (e) => {
    const slot = e.target.closest('.timetable-slot, td');
    if (!slot || slot.tagName.toLowerCase() === 'th') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  document.addEventListener('dragenter', (e) => {
    const slot = e.target.closest('.timetable-slot, td');
    if (!slot || slot.tagName.toLowerCase() === 'th') return;
    slot.classList.add('drop-target');
  });

  document.addEventListener('dragleave', (e) => {
    const slot = e.target.closest('.timetable-slot, td');
    if (slot && !slot.contains(e.relatedTarget)) {
      slot.classList.remove('drop-target');
    }
  });

  document.addEventListener('drop', (e) => {
    const slot = e.target.closest('.timetable-slot, td');
    if (!slot || slot.tagName.toLowerCase() === 'th') return;
    e.preventDefault();

    const targetDay = slot.getAttribute('data-day');
    const targetPeriod = slot.getAttribute('data-period');
    
    if (targetDay !== null && targetPeriod !== null && draggedActivity && state.scheduleEntries) {
      const newDayIndex = parseInt(targetDay, 10);
      const newPeriod = parseInt(targetPeriod, 10);
      const dur = draggedActivity.duration || 1;

      const isAllowed = isTeacherAvailableAt(draggedActivity.teacher, newDayIndex, newPeriod, dur, draggedActivity.activityId);
      
      const foundIdx = state.scheduleEntries.findIndex(se =>
        se.activityId === draggedActivity.activityId ||
        (se.teacher === draggedActivity.teacher && se.group === draggedActivity.group && se.dayIndex === draggedActivity.dayIndex && se.period === draggedActivity.period)
      );

      if (foundIdx !== -1) {
        state.scheduleEntries[foundIdx].dayIndex = newDayIndex;
        state.scheduleEntries[foundIdx].period = newPeriod;
        if (state.data && state.data.realDayNames && state.data.realDayNames[newDayIndex]) {
          state.scheduleEntries[foundIdx].dayName = state.data.realDayNames[newDayIndex];
        }
        
        refreshRenderedTables();
        
        const statusMsg = isAllowed ? '✔ تم نقل الحصة بنجاح إلى التوقيت الجديد.' : '⚠ تم نقل الحصة ولكن يوجد تعارض في جدول الأستاذ.';
        if (window.fetApp && typeof window.fetApp.showNotification === 'function') {
          window.fetApp.showNotification({ message: statusMsg, type: isAllowed ? 'success' : 'warning' });
        }
      }
    }

    clearSlotHighlights();
    draggedActivity = null;
  });

  document.addEventListener('dragend', () => {
    clearSlotHighlights();
    draggedActivity = null;
  });

})();
