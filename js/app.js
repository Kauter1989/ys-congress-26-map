/* КМУ-2026 - Интерактивная деловая программа — интерфейс */
(function () {
  'use strict';

  var DATA = window.PROGRAM_DATA;
  var C = window.KmuCore;
  if (!DATA || !C) {
    document.getElementById('content').innerHTML =
      '<div class="empty-state"><h3>Не удалось загрузить данные программы</h3><p>Проверьте, что файл data.js лежит рядом с index.html.</p></div>';
    return;
  }
  var meta = DATA.meta;
  var events = DATA.events;
  var byId = {};
  events.forEach(function (e) { byId[e.id] = e; });

  /* ---------- Треки ---------- */
  var TRACKS = [
    { key: 'platform', name: 'Платформа развития: люди, среда, инструменты', short: 'Платформа развития', css: 'tk-platform', color: '#2c90f7' },
    { key: 'challenges', name: 'Большие вызовы научно-технологического развития', short: 'Большие вызовы', css: 'tk-challenges', color: '#8b5cf6' },
    { key: 'borders', name: 'Наука без границ: идеи, открытия, решения', short: 'Наука без границ', css: 'tk-borders', color: '#05c0cc' },
    { key: 'initiatives', name: 'Инициативы Десятилетия науки и технологий', short: 'Инициативы Десятилетия', css: 'tk-initiatives', color: '#ffb020' },
    { key: 'rsf', name: 'Школа РНФ', short: 'Школа РНФ', css: 'tk-rsf', color: '#ff5470' }
  ];
  function textColorFor(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? '#06121f' : '#ffffff';
  }
  var TRACK_BY_NAME = {};
  TRACKS.forEach(function (t) { TRACK_BY_NAME[t.name] = t; });
  function trackOf(ev) { return TRACK_BY_NAME[ev.track] || null; }
  function trackCss(ev) { var t = trackOf(ev); return t ? t.css : 'tk-other'; }
  function trackFilterKey(ev) { return ev.track || '__other__'; }

  var SECTION_LABELS = {
    moderator: 'Модератор', moderator_plural: 'Модераторы',
    speaker: 'Выступающие', panelist: 'Участники дискуссии',
    expert: 'Эксперты', opening: 'Приветственное слово', host: 'Ведущий', guest: 'Гость'
  };

  /* ---------- Состояние ---------- */
  var LS_KEY = 'kmu2026.planner.v1';
  var state = {
    day: 'all',
    view: window.innerWidth >= 1000 ? 'grid' : 'list',
    theme: 'polar',
    query: '',
    tracks: [],
    domains: [],
    formats: [],
    speakers: [],
    selected: []
  };
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved) {
      if (saved.day) state.day = saved.day;
      if (saved.view === 'grid' || saved.view === 'list') state.view = saved.view;
      if (['kmu', 'graphite', 'polar', 'neon', 'light'].indexOf(saved.theme) !== -1) state.theme = saved.theme;
      if (typeof saved.query === 'string') state.query = saved.query;
      ['tracks', 'domains', 'formats', 'speakers', 'selected'].forEach(function (k) {
        if (Array.isArray(saved[k])) state[k] = saved[k];
      });
      state.selected = state.selected.filter(function (id) { return byId[id]; });
    }
  } catch (e) { /* localStorage недоступен — работаем без сохранения */ }

  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  /* ---------- DOM ---------- */
  function $(id) { return document.getElementById(id); }
  var content = $('content');
  var dayTabs = $('day-tabs');
  var statusLine = $('status-line');
  var activeFilters = $('active-filters');
  var filterPanel = $('filter-panel');
  var searchInput = $('search');
  var speakerInput = $('speaker-input');
  var speakerList = $('speaker-list');
  var toastEl = $('toast');
  var modal = $('modal');
  var modalBody = $('modal-body');
  var icsModal = $('ics-modal');
  var icsBody = $('ics-body');
  var lastFocus = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function icon(name, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }

  /* ---------- Производные данные ---------- */
  var speakerIdx = C.speakerIndex(events);
  var domainCounts = {};
  events.forEach(function (e) { (e.domains || []).forEach(function (d) { domainCounts[d] = (domainCounts[d] || 0) + 1; }); });
  var domainList = Object.keys(domainCounts).sort(function (a, b) { return domainCounts[b] - domainCounts[a] || a.localeCompare(b, 'ru'); });
  var formatList = [];
  events.forEach(function (e) { if (e.format && formatList.indexOf(e.format) === -1) formatList.push(e.format); });
  formatList.sort(function (a, b) { return a.localeCompare(b, 'ru'); });

  function selectedEvents() {
    return state.selected.map(function (id) { return byId[id]; }).filter(Boolean)
      .sort(function (a, b) { return a.date.localeCompare(b.date) || C.startMin(a) - C.startMin(b); });
  }
  function currentFilters(dayOverride) {
    return {
      day: dayOverride !== undefined ? dayOverride : state.day,
      query: state.query,
      tracks: state.tracks,
      domains: state.domains,
      formats: state.formats,
      speakers: state.speakers,
      selected: state.selected,
      selectedOnly: false
    };
  }

  /* ---------- Фильтры: построение ---------- */
  function buildFilterControls() {
    var trackCounts = {};
    events.forEach(function (e) { var k = trackFilterKey(e); trackCounts[k] = (trackCounts[k] || 0) + 1; });
    var html = TRACKS.map(function (t) {
      return '<button type="button" class="chip" data-track="' + esc(t.name) + '">' +
        '<span class="dot" style="background:' + t.color + '"></span>' + esc(t.short) +
        ' <span class="cnt">' + (trackCounts[t.name] || 0) + '</span></button>';
    }).join('');
    html += '<button type="button" class="chip" data-track="__other__">Другие <span class="cnt">' + (trackCounts['__other__'] || 0) + '</span></button>';
    $('track-chips').innerHTML = html;

    $('domain-chips').innerHTML = domainList.map(function (d) {
      return '<button type="button" class="chip" data-domain="' + esc(d) + '">' + esc(d) + ' <span class="cnt">' + domainCounts[d] + '</span></button>';
    }).join('');

    $('format-select').innerHTML = '<option value="">Все форматы</option>' +
      formatList.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
  }

  function syncFilterControls() {
    Array.prototype.forEach.call($('track-chips').children, function (ch) {
      ch.classList.toggle('active', state.tracks.indexOf(ch.getAttribute('data-track')) !== -1);
    });
    Array.prototype.forEach.call($('domain-chips').children, function (ch) {
      ch.classList.toggle('active', state.domains.indexOf(ch.getAttribute('data-domain')) !== -1);
    });
    $('format-select').value = state.formats.length === 1 ? state.formats[0] : '';
    searchInput.value = state.query;
    renderSpeakerChips();
    var n = state.tracks.length + state.domains.length + state.formats.length + state.speakers.length + (state.query ? 1 : 0);
    var fc = $('filter-count');
    fc.hidden = n === 0;
    fc.textContent = n;
  }

  function renderSpeakerChips() {
    $('speaker-chips').innerHTML = state.speakers.map(function (s) {
      return '<button type="button" class="chip removable active" data-speaker-remove="' + esc(s) + '">' + esc(s) + ' <span class="x">×</span></button>';
    }).join('');
  }

  function renderActiveFilters() {
    var items = [];
    if (state.query) items.push({ kind: 'query', label: 'Поиск: «' + state.query + '»' });
    state.tracks.forEach(function (t) {
      var tr = TRACK_BY_NAME[t];
      items.push({ kind: 'track', value: t, label: tr ? tr.short : 'Другие' });
    });
    state.domains.forEach(function (d) { items.push({ kind: 'domain', value: d, label: d }); });
    state.formats.forEach(function (f) { items.push({ kind: 'format', value: f, label: f }); });
    state.speakers.forEach(function (s) { items.push({ kind: 'speaker', value: s, label: 'Спикер: ' + s }); });
    activeFilters.hidden = items.length === 0;
    activeFilters.innerHTML = items.map(function (it) {
      return '<button type="button" class="chip removable active" data-remove-kind="' + it.kind + '" data-remove-value="' + esc(it.value || '') + '">' +
        esc(it.label) + ' <span class="x">×</span></button>';
    }).join('');
  }

  /* ---------- Вкладки дней ---------- */
  function renderTabs() {
    var counts = {};
    var filteredAll = C.filterEvents(events, currentFilters('all'));
    filteredAll.forEach(function (e) { counts[e.date] = (counts[e.date] || 0) + 1; });
    var html = '<button type="button" class="day-tab' + (state.day === 'all' ? ' active' : '') + '" data-day="all">Все дни <span class="cnt">' + filteredAll.length + '</span></button>';
    meta.dates.forEach(function (d) {
      html += '<button type="button" class="day-tab' + (state.day === d ? ' active' : '') + '" data-day="' + d + '">' +
        esc(C.formatDate(d)) + ' <span class="cnt">' + (counts[d] || 0) + '</span></button>';
    });
    html += '<button type="button" class="day-tab fav-tab' + (state.day === 'fav' ? ' active' : '') + '" data-day="fav">' +
      icon('star') + ' Избранное <span class="cnt">' + state.selected.length + '</span></button>';
    dayTabs.innerHTML = html;
  }

  /* ---------- Карточки ---------- */
  function conflictBadge(ev, conflicts) {
    var ids = conflicts.map[ev.id];
    if (!ids) return '';
    return '<span class="badge conflict-badge" title="Пересекается по времени с выбранными мероприятиями">' + icon('alert') + ' конфликт</span>';
  }

  function speakersPreview(ev) {
    var ps = ev.persons || [];
    if (!ps.length) return '<span>Спикеры уточняются</span>';
    var mod = ps.filter(function (p) { return p.section === 'moderator'; })[0];
    var first = mod || ps[0];
    var rest = ps.length - 1;
    return '<span><b>' + esc(first.name) + '</b>' + (rest > 0 ? ' и ещё ' + rest : '') + '</span>';
  }

  function domainBadges(ev, limit) {
    var ds = ev.domains || [];
    var shown = ds.slice(0, limit || 2);
    var html = shown.map(function (d) { return '<span class="badge domain-badge">' + esc(d) + '</span>'; }).join('');
    if (ds.length > shown.length) html += '<span class="badge">+' + (ds.length - shown.length) + '</span>';
    return html;
  }

  function trackBadge(ev) {
    var t = trackOf(ev);
    if (t) return '<span class="badge track-badge" style="background:' + t.color + ';color:' + textColorFor(t.color) + '" title="' + esc(t.name) + '">' + esc(t.short) + '</span>';
    if (ev.series) return '<span class="badge track-badge" style="background:#7c8db5;color:#06121f" title="' + esc(ev.series) + '">Серия</span>';
    return '<span class="badge track-badge" style="background:#7c8db5;color:#06121f">Спецсобытие</span>';
  }

  function listCard(ev, conflicts) {
    var sel = state.selected.indexOf(ev.id) !== -1;
    var conf = conflicts.map[ev.id];
    var confNote = '';
    if (conf) {
      var names = conf.map(function (id) { return byId[id] ? byId[id].title : id; });
      var txt = names.length > 2 ? names.slice(0, 2).join('; ') + ' и ещё ' + (names.length - 2) : names.join('; ');
      confNote = '<div class="conflict-note">' + icon('alert') + ' Пересекается с: ' + esc(txt) + '</div>';
    }
    return '<article class="card ' + trackCss(ev) + (sel ? ' selected' : '') + (conf ? ' conflicted' : '') + '" data-id="' + ev.id + '">' +
      '<div class="card-top"><span class="card-time">' + ev.start + '–' + ev.end + '</span>' +
      '<span class="card-dur">' + C.durationText(ev) + '</span>' + conflictBadge(ev, conflicts) + '</div>' +
      (ev.series ? '<div class="card-series">' + esc(ev.series) + '</div>' : '') +
      '<h3 class="card-title" data-open="' + ev.id + '" tabindex="0" role="button">' + esc(ev.title) + '</h3>' +
      '<div class="card-meta">' + icon('pin') + '<span>' + esc(ev.room || ev.venue || 'зал уточняется') + '</span></div>' +
      '<div class="badges">' + trackBadge(ev) +
      (ev.format ? '<span class="badge format-badge">' + esc(ev.format) + '</span>' : '') +
      domainBadges(ev) + '</div>' +
      '<div class="card-speakers">' + icon('users') + speakersPreview(ev) + '</div>' +
      confNote +
      '<div class="card-actions">' +
      '<a class="cal-btn" href="' + esc(C.googleCalendarUrl(ev, meta)) + '" target="_blank" rel="noopener" title="Добавить это мероприятие в Google Calendar">' + icon('cal') + ' В календарь</a>' +
      '<button type="button" class="star-btn' + (sel ? ' on' : '') + '" data-star="' + ev.id + '" aria-pressed="' + sel + '" title="' + (sel ? 'Убрать из избранного' : 'В избранное') + '">' + icon('star') + '</button>' +
      '</div></article>';
  }

  /* ---------- Список ---------- */
  function slotsHtml(dayEvents, conflicts) {
    var slots = {};
    dayEvents.forEach(function (e) { var k = e.start + '–' + e.end; (slots[k] = slots[k] || []).push(e); });
    return Object.keys(slots).sort(function (a, b) { return C.toMinutes(a.split('–')[0]) - C.toMinutes(b.split('–')[0]); }).map(function (k) {
      return '<div class="slot-group"><div class="slot-head"><span class="slot-time">' + k + '</span>' +
        '<span class="slot-cnt">' + slots[k].length + ' в этом слоте</span></div>' +
        '<div class="cards">' + slots[k].map(function (e) { return listCard(e, conflicts); }).join('') + '</div></div>';
    }).join('');
  }

  function renderList(list, conflicts) {
    if (!list.length) return emptyState();
    var byDate = {};
    list.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    var html = '';
    Object.keys(byDate).sort().forEach(function (d) {
      var dayEvents = byDate[d].sort(function (a, b) { return C.startMin(a) - C.startMin(b) || a.id.localeCompare(b.id); });
      html += '<section class="day-section"><div class="day-heading"><h2>' + esc(C.formatDate(d, true)) + '</h2>' +
        '<span class="sub">' + dayEvents.length + ' меропр.</span></div>' +
        slotsHtml(dayEvents, conflicts) + '</section>';
    });
    return html;
  }

  /* ---------- Сетка времени ---------- */
  var PPM = 1.7;            // пикселей на минуту
  var COL_W = 236;
  var COL_GAP = 8;

  function gridDayHtml(d, dayEvents, conflicts) {
    var minStart = Math.min.apply(null, dayEvents.map(C.startMin));
    var maxEnd = Math.max.apply(null, dayEvents.map(C.endMin));
    var dayStart = Math.floor(minStart / 60) * 60;
    var dayEnd = Math.ceil(maxEnd / 60) * 60;
    var height = (dayEnd - dayStart) * PPM;
    var layout = C.layoutColumns(dayEvents);
    var width = layout.cols * (COL_W + COL_GAP) + COL_GAP;

    var gutter = '';
    var lines = '';
    for (var m = dayStart; m <= dayEnd; m += 30) {
      var y = (m - dayStart) * PPM;
      var isHour = m % 60 === 0;
      if (isHour && m < dayEnd) gutter += '<span class="gutter-label" style="top:' + y + 'px">' + C.minutesToHHMM(m) + '</span>';
      if (m < dayEnd) lines += '<div class="hour-line' + (isHour ? '' : ' half') + '" style="top:' + y + 'px"></div>';
    }

    var cards = dayEvents.map(function (ev) {
      var col = layout.byId[ev.id].col;
      var top = (C.startMin(ev) - dayStart) * PPM + 1;
      var h = Math.max((C.endMin(ev) - C.startMin(ev)) * PPM - 3, 26);
      var left = COL_GAP + col * (COL_W + COL_GAP);
      var sel = state.selected.indexOf(ev.id) !== -1;
      var conf = conflicts.map[ev.id];
      var compact = h < 64;
      return '<div class="grid-card ' + trackCss(ev) + (sel ? ' selected' : '') + (conf ? ' conflicted' : '') + '" ' +
        'style="top:' + top + 'px;left:' + left + 'px;width:' + COL_W + 'px;height:' + h + 'px" ' +
        'data-open="' + ev.id + '" tabindex="0" role="button" title="' + esc(ev.title) + '">' +
        '<div class="g-time">' + ev.start + '–' + ev.end +
        (conf ? '<span class="g-conflict" style="position:static">' + icon('alert') + '</span>' : '') + '</div>' +
        '<div class="g-title">' + esc(ev.title) + '</div>' +
        (compact ? '' : '<div class="g-room">' + esc(ev.room || ev.venue || '') + '</div>') +
        '<button type="button" class="g-star' + (sel ? ' on' : '') + '" data-star="' + ev.id + '" aria-pressed="' + sel + '" title="' + (sel ? 'Убрать из избранного' : 'В избранное') + '">' + icon('star') + '</button>' +
        '</div>';
    }).join('');

    return '<div class="grid-wrap"><div class="time-gutter" style="height:' + height + 'px">' + gutter + '</div>' +
      '<div class="grid-canvas" style="height:' + height + 'px;width:' + width + 'px">' + lines + cards + '</div></div>' +
      '<div class="grid-hint">Вертикальный таймлайн дня: плитки расположены по времени. Клик по плитке — подробности.</div>';
  }

  function renderGrid(list, conflicts) {
    if (!list.length) return emptyState();
    var byDate = {};
    list.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    var html = '';
    Object.keys(byDate).sort().forEach(function (d) {
      var dayEvents = byDate[d];
      var layout = C.layoutColumns(dayEvents);
      html += '<section class="grid-day"><div class="day-heading"><h2>' + esc(C.formatDate(d, true)) + '</h2>' +
        '<span class="sub">' + dayEvents.length + ' меропр. · ' + layout.cols + ' параллельных потоков</span></div>' +
        gridDayHtml(d, dayEvents, conflicts) + '</section>';
    });
    html += '<div class="grid-legend">' + TRACKS.map(function (t) {
      return '<span class="lg"><span class="dot" style="background:' + t.color + '"></span>' + esc(t.short) + '</span>';
    }).join('') + '<span class="lg"><span class="dot" style="background:#7c8db5"></span>Другие / спецсобытия</span></div>';
    return html;
  }

  /* ---------- Избранное ---------- */
  function renderFavorites(conflicts) {
    var sel = selectedEvents();
    var totalMin = sel.reduce(function (s, e) { return s + C.endMin(e) - C.startMin(e); }, 0);
    var html = '<div class="fav-bar">' +
      '<div class="grow"><b>Выбрано: ' + sel.length + '</b>' +
      (sel.length ? ' <span style="color:var(--muted)">· ' + Math.floor(totalMin / 60) + ' ч ' + (totalMin % 60) + ' мин суммарно</span>' : '') + '</div>' +
      (sel.length ?
        '<button type="button" class="btn btn-primary" id="fav-gcal">' + icon('cal') + ' Добавить в календарь</button>' +
        '<button type="button" class="btn" id="fav-pdf">' + icon('pdf') + ' Сохранить в PDF</button>' +
        '<button type="button" class="btn btn-danger" id="fav-clear">' + icon('trash') + ' Очистить</button>' : '') +
      '</div>';

    if (conflicts.pairs.length) {
      html += '<div class="conflict-panel"><h3>' + icon('alert') + ' Конфликты по времени: ' + conflicts.pairs.length + '</h3><ul>' +
        conflicts.pairs.map(function (pair) {
          var a = byId[pair[0]], b = byId[pair[1]];
          if (!a || !b) return '';
          return '<li><b>' + esc(a.title) + '</b> <span class="pair-times">(' + a.start + '–' + a.end + ')</span> ↔ ' +
            '<b>' + esc(b.title) + '</b> <span class="pair-times">(' + b.start + '–' + b.end + ')</span> · ' + esc(C.formatDate(a.date)) + '</li>';
        }).join('') + '</ul>' +
        '<p style="margin:8px 0 0;font-size:12.5px;color:var(--muted)">Оба мероприятия добавятся в календарь — решите, какое посетить, или отметьте частичное присутствие.</p></div>';
    }

    if (!sel.length) {
      html += '<div class="empty-state"><div class="big">☆</div><h3>Пока пусто</h3>' +
        '<p>Отмечайте мероприятия звёздочкой в программе — они появятся здесь.<br>Потом их можно добавить в календарь все сразу.</p>' +
        '<button type="button" class="btn btn-primary" data-day="all" style="margin-top:10px">Перейти к программе</button></div>';
      return html;
    }

    var byDate = {};
    sel.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    Object.keys(byDate).sort().forEach(function (d) {
      var dayEvents = byDate[d];
      var mins = dayEvents.reduce(function (s, e) { return s + C.endMin(e) - C.startMin(e); }, 0);
      var full = C.formatDate(d, true).split(', ');
      html += '<section class="fav-day">' +
        '<div class="fav-day-head"><span class="fav-day-date">' + esc(full[0]) + '</span>' +
        '<span class="fav-day-wd">' + esc(full[1] || '') + '</span>' +
        '<span class="fav-day-cnt">' + dayEvents.length + ' меропр. · ' + Math.floor(mins / 60) + ' ч ' + (mins % 60) + ' мин</span></div>' +
        '<div class="fav-day-body">' + gridDayHtml(d, dayEvents, conflicts) +
        (state.view === 'list' ? '<div class="fav-cards">' + slotsHtml(dayEvents, conflicts) + '</div>' : '') +
        '</div></section>';
    });
    return html;
  }

  function emptyState() {
    return '<div class="empty-state"><div class="big">🔍</div><h3>Ничего не найдено</h3>' +
      '<p>Попробуйте изменить запрос или сбросить фильтры.</p>' +
      '<button type="button" class="btn" id="empty-reset" style="margin-top:10px">Сбросить фильтры</button></div>';
  }

  /* ---------- Общий рендер ---------- */
  function render() {
    var conflicts = C.findConflicts(selectedEvents());
    renderTabs();
    syncFilterControls();
    renderActiveFilters();
    $('view-grid').classList.toggle('active', state.view === 'grid');
    $('view-list').classList.toggle('active', state.view === 'list');

    var html;
    if (state.day === 'fav') {
      html = renderFavorites(conflicts);
      statusLine.innerHTML = '<b>Избранное</b> · ' + state.selected.length + ' меропр.' +
        (conflicts.pairs.length ? ' · <span style="color:var(--danger)">⚠ ' + conflicts.pairs.length + ' пересечений</span>' : '');
    } else {
      var list = C.filterEvents(events, currentFilters());
      var dayLabel = state.day === 'all' ? 'все дни' : C.formatDate(state.day, true);
      statusLine.innerHTML = 'Найдено: <b>' + list.length + '</b> меропр. · ' + esc(dayLabel) +
        (state.selected.length ? ' · в избранном: ' + state.selected.length : '') +
        (conflicts.pairs.length ? ' · <span style="color:var(--danger)">⚠ ' + conflicts.pairs.length + ' пересечений в избранном</span>' : '');
      html = state.view === 'grid' ? renderGrid(list, conflicts) : renderList(list, conflicts);
    }
    content.innerHTML = html;
    persist();
    syncHash();
  }

  /* ---------- Hash / deep links ---------- */
  var suppressHash = false;
  function syncHash() {
    if (suppressHash) return;
    var h = '#day=' + encodeURIComponent(state.day) + '&view=' + state.view;
    try { history.replaceState(null, '', h); } catch (e) { location.hash = h; }
  }
  function applyHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var params = {};
    h.split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    if (params.event && byId[params.event]) { openEvent(params.event); return; }
    if (params.day && (params.day === 'all' || params.day === 'fav' || meta.dates.indexOf(params.day) !== -1)) state.day = params.day;
    if (params.view === 'grid' || params.view === 'list') state.view = params.view;
  }

  /* ---------- Модальное окно мероприятия ---------- */
  function personGroups(ev) {
    var order = ['opening', 'moderator', 'speaker', 'panelist', 'expert', 'host', 'guest'];
    var groups = {};
    (ev.persons || []).forEach(function (p) { (groups[p.section] = groups[p.section] || []).push(p); });
    var html = '';
    order.forEach(function (sec) {
      var ps = groups[sec];
      if (!ps || !ps.length) return;
      var label = SECTION_LABELS[sec] || 'Участники';
      if (ps.length > 1 && sec === 'moderator') label = 'Модераторы';
      html += '<div class="person-group"><h4>' + esc(label) + ' · ' + ps.length + '</h4>' +
        ps.map(function (p) {
          return '<div class="person"><span class="p-name">' + esc(p.name) + '</span>' +
            (p.role ? '<span class="p-role">' + esc(p.role) + '</span>' : '') + '</div>';
        }).join('') + '</div>';
    });
    return html || '<p style="color:var(--muted);font-size:13px">Состав участников уточняется.</p>';
  }

  function openEvent(id) {
    var ev = byId[id];
    if (!ev) return;
    lastFocus = document.activeElement;
    var conflicts = C.findConflicts(selectedEvents());
    var sel = state.selected.indexOf(id) !== -1;
    var conf = conflicts.map[id];
    var t = trackOf(ev);

    var confHtml = '';
    if (conf) {
      confHtml = '<div class="conflict-panel m-conflicts"><h3>' + icon('alert') + ' Пересекается с выбранными</h3><ul>' +
        conf.map(function (cid) {
          var c = byId[cid];
          return c ? '<li>' + esc(c.title) + ' <span class="pair-times">(' + c.start + '–' + c.end + ')</span></li>' : '';
        }).join('') + '</ul></div>';
    }

    modalBody.innerHTML =
      '<div class="m-kicker">' + trackBadge(ev) +
      (ev.format ? '<span class="badge format-badge">' + esc(ev.format) + '</span>' : '') +
      domainBadges(ev, 6) + conflictBadge(ev, conflicts) + '</div>' +
      '<h2 class="m-title" id="modal-title">' + esc(ev.title) + '</h2>' +
      (ev.series ? '<p class="m-series">' + esc(ev.series) + '</p>' : '') +
      (ev.note ? '<p class="m-series">' + esc(ev.note) + '</p>' : '') +
      '<div class="m-facts">' +
      '<div class="m-fact">' + icon('clock') + '<div><b>Когда</b>' + esc(C.formatDate(ev.date, true)) + ', ' + ev.start + '–' + ev.end + ' (' + C.durationText(ev) + ', МСК)</div></div>' +
      '<div class="m-fact">' + icon('pin') + '<div><b>Где</b>' + esc(ev.venue || 'уточняется') + '</div></div>' +
      (t ? '<div class="m-fact">' + icon('filter') + '<div><b>Трек</b>' + esc(t.name) + '</div></div>' : '') +
      '</div>' +
      '<div class="m-actions">' +
      '<button type="button" class="btn ' + (sel ? '' : 'btn-primary') + '" data-star="' + ev.id + '">' + icon('star') + ' ' + (sel ? 'В избранном ✓' : 'В избранное') + '</button>' +
      '<a class="btn" href="' + esc(C.googleCalendarUrl(ev, meta)) + '" target="_blank" rel="noopener">' + icon('cal') + ' Google Calendar</a>' +
      '<button type="button" class="btn" data-ics-one="' + ev.id + '">' + icon('download') + ' .ics</button>' +
      '<button type="button" class="btn" data-share="' + ev.id + '">' + icon('link') + ' Поделиться</button>' +
      '</div>' +
      confHtml +
      (ev.description ? '<div class="m-desc">' + esc(ev.description) + '</div>' : '<p style="color:var(--muted)">Описание уточняется.</p>') +
      '<div class="m-section-title">Участники · ' + (ev.persons || []).length + '</div>' +
      personGroups(ev);

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    $('modal-close').focus();
    suppressHash = true;
    try { history.replaceState(null, '', '#event=' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
    suppressHash = false;
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    syncHash();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---------- ICS / Google Calendar ---------- */
  function downloadICS(list, filename) {
    var text = C.buildICS(list, meta);
    var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function openIcsModal(list) {
    icsBody.innerHTML =
      '<h2 class="m-title" id="ics-title">Добавить выбранные в календарь</h2>' +
      '<p style="font-size:14px;color:var(--muted)">Google Calendar не умеет добавлять много событий по одной ссылке, поэтому используем стандартный файл <b>.ics</b> — его понимают все календари.</p>' +
      '<ol class="ics-steps">' +
      '<li><button type="button" class="btn btn-primary" id="ics-download">' + icon('download') + ' Скачать .ics (' + list.length + ')</button></li>' +
      '<li>Откройте <a href="https://calendar.google.com/" target="_blank" rel="noopener">Google Calendar</a> → шестерёнка → <b>Настройки</b> → <b>Импорт и экспорт</b> → <b>Импорт</b>.</li>' +
      '<li>Выберите скачанный файл и календарь, в который добавить события. Готово — все ' + list.length + ' мероприятий появятся с напоминанием за 15 минут.</li>' +
      '</ol>' +
      '<div class="ics-note">Файл также импортируется в Яндекс Календарь, Outlook и Apple Calendar. Отдельные мероприятия можно добавлять кнопкой «В календарь» без файла.</div>' +
      '<div class="m-actions"><a class="btn" href="https://calendar.google.com/" target="_blank" rel="noopener">' + icon('external') + ' Открыть Google Calendar</a></div>';
    icsModal.hidden = false;
    document.body.style.overflow = 'hidden';
    $('ics-close').focus();
    $('ics-download').addEventListener('click', function () {
      downloadICS(list, 'kmu2026-selected.ics');
      toast('Файл .ics скачан (' + list.length + ' меропр.)');
    });
  }

  function closeIcsModal() {
    icsModal.hidden = true;
    if (modal.hidden) document.body.style.overflow = '';
  }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    toastEl.innerHTML = icon('check') + esc(msg);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  /* ---------- Избранное ---------- */
  function toggleSelected(id) {
    var i = state.selected.indexOf(id);
    var added = i === -1;
    if (added) { state.selected.push(id); toast('Добавлено в избранное'); }
    else { state.selected.splice(i, 1); toast('Убрано из избранного'); }
    render();
    if (added) {
      var el = content.querySelector('[data-id="' + id + '"]');
      if (el) { el.classList.add('just-selected'); }
    }
    if (!modal.hidden) openEvent(id);
  }

  /* ---------- Спикер-автокомплит ---------- */
  var spHl = -1;
  function showSpeakerSuggestions() {
    var q = speakerInput.value.trim().toLowerCase().replace(/ё/g, 'е');
    if (!q) { speakerList.hidden = true; speakerInput.setAttribute('aria-expanded', 'false'); return; }
    var matches = speakerIdx.filter(function (s) {
      return s.name.toLowerCase().replace(/ё/g, 'е').indexOf(q) !== -1;
    }).slice(0, 12);
    if (!matches.length) { speakerList.hidden = true; speakerInput.setAttribute('aria-expanded', 'false'); return; }
    spHl = -1;
    speakerList.innerHTML = matches.map(function (s, i) {
      return '<li role="option" data-speaker="' + esc(s.name) + '" data-i="' + i + '"><span>' + esc(s.name) + '</span><span class="cnt">' + s.count + ' меропр.</span></li>';
    }).join('');
    speakerList.hidden = false;
    speakerInput.setAttribute('aria-expanded', 'true');
  }
  function addSpeaker(name) {
    if (state.speakers.indexOf(name) === -1) state.speakers.push(name);
    speakerInput.value = '';
    speakerList.hidden = true;
    speakerInput.setAttribute('aria-expanded', 'false');
    render();
  }

  /* ---------- События ---------- */
  dayTabs.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-day]');
    if (!btn) return;
    state.day = btn.getAttribute('data-day');
    render();
    window.scrollTo({ top: 0 });
  });

  $('view-grid').addEventListener('click', function () { state.view = 'grid'; render(); });
  $('view-list').addEventListener('click', function () { state.view = 'list'; render(); });

  var searchTimer = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.query = searchInput.value; render(); }, 160);
  });

  $('filter-toggle').addEventListener('click', function () {
    filterPanel.hidden = !filterPanel.hidden;
    this.setAttribute('aria-expanded', String(!filterPanel.hidden));
  });

  filterPanel.addEventListener('click', function (e) {
    var t = e.target.closest('[data-track]');
    if (t) {
      var k = t.getAttribute('data-track');
      var i = state.tracks.indexOf(k);
      if (i === -1) state.tracks.push(k); else state.tracks.splice(i, 1);
      render(); return;
    }
    var d = e.target.closest('[data-domain]');
    if (d) {
      var dk = d.getAttribute('data-domain');
      var di = state.domains.indexOf(dk);
      if (di === -1) state.domains.push(dk); else state.domains.splice(di, 1);
      render(); return;
    }
    var sr = e.target.closest('[data-speaker-remove]');
    if (sr) {
      var sn = sr.getAttribute('data-speaker-remove');
      state.speakers = state.speakers.filter(function (s) { return s !== sn; });
      render(); return;
    }
    if (e.target.closest('#reset-filters')) { resetFilters(); return; }
    var li = e.target.closest('[data-speaker]');
    if (li) { addSpeaker(li.getAttribute('data-speaker')); return; }
  });

  $('format-select').addEventListener('change', function () {
    state.formats = this.value ? [this.value] : [];
    render();
  });

  speakerInput.addEventListener('input', showSpeakerSuggestions);
  speakerInput.addEventListener('focus', showSpeakerSuggestions);
  speakerInput.addEventListener('keydown', function (e) {
    var items = speakerList.querySelectorAll('li');
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); spHl = Math.min(spHl + 1, items.length - 1); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); spHl = Math.max(spHl - 1, 0); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (spHl >= 0 && items[spHl]) addSpeaker(items[spHl].getAttribute('data-speaker'));
      else if (items.length) addSpeaker(items[0].getAttribute('data-speaker'));
      return;
    } else if (e.key === 'Escape') { speakerList.hidden = true; speakerInput.setAttribute('aria-expanded', 'false'); return; }
    else return;
    Array.prototype.forEach.call(items, function (li, i) { li.classList.toggle('hl', i === spHl); });
    if (items[spHl]) items[spHl].scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.speaker-box')) { speakerList.hidden = true; speakerInput.setAttribute('aria-expanded', 'false'); }
  });

  function resetFilters() {
    state.query = ''; state.tracks = []; state.domains = []; state.formats = []; state.speakers = [];
    searchInput.value = '';
    render();
  }
  $('reset-filters').addEventListener('click', resetFilters);

  activeFilters.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remove-kind]');
    if (!btn) return;
    var kind = btn.getAttribute('data-remove-kind');
    var val = btn.getAttribute('data-remove-value');
    if (kind === 'query') { state.query = ''; searchInput.value = ''; }
    else if (kind === 'track') state.tracks = state.tracks.filter(function (x) { return x !== val; });
    else if (kind === 'domain') state.domains = state.domains.filter(function (x) { return x !== val; });
    else if (kind === 'format') state.formats = state.formats.filter(function (x) { return x !== val; });
    else if (kind === 'speaker') state.speakers = state.speakers.filter(function (x) { return x !== val; });
    render();
  });

  content.addEventListener('click', function (e) {
    var star = e.target.closest('[data-star]');
    if (star) { e.preventDefault(); e.stopPropagation(); toggleSelected(star.getAttribute('data-star')); return; }
    var open = e.target.closest('[data-open]');
    if (open) { openEvent(open.getAttribute('data-open')); return; }
    if (e.target.closest('#fav-gcal')) { openIcsModal(selectedEvents()); return; }
    if (e.target.closest('#fav-pdf')) {
      var selPdf = selectedEvents();
      toast('Готовим PDF…');
      window.KmuPdf.downloadPdf(selPdf, meta, C.findConflicts(selPdf)).then(
        function () { toast('PDF сохранён (' + selPdf.length + ' меропр.)'); },
        function (err) { toast('Не удалось создать PDF'); if (window.console) console.error(err); }
      );
      return;
    }
    if (e.target.closest('#fav-clear')) {
      if (confirm('Убрать все мероприятия из избранного?')) { state.selected = []; render(); }
      return;
    }
    if (e.target.closest('#empty-reset')) { resetFilters(); return; }
    var dayBtn = e.target.closest('[data-day]');
    if (dayBtn) { state.day = dayBtn.getAttribute('data-day'); render(); window.scrollTo({ top: 0 }); }
  });
  content.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      var open = e.target.closest('[data-open]');
      if (open) { e.preventDefault(); openEvent(open.getAttribute('data-open')); }
    }
  });

  modal.addEventListener('click', function (e) {
    if (e.target === modal) { closeModal(); return; }
    if (e.target.closest('#modal-close')) { closeModal(); return; }
    var star = e.target.closest('[data-star]');
    if (star) { toggleSelected(star.getAttribute('data-star')); return; }
    var one = e.target.closest('[data-ics-one]');
    if (one) {
      var ev = byId[one.getAttribute('data-ics-one')];
      downloadICS([ev], 'kmu2026-' + ev.id + '.ics');
      toast('Файл .ics скачан');
      return;
    }
    var share = e.target.closest('[data-share]');
    if (share) {
      var url = location.href.split('#')[0] + '#event=' + encodeURIComponent(share.getAttribute('data-share'));
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast('Ссылка скопирована'); }, function () { prompt('Ссылка на мероприятие:', url); });
      } else prompt('Ссылка на мероприятие:', url);
    }
  });

  icsModal.addEventListener('click', function (e) {
    if (e.target === icsModal || e.target.closest('#ics-close')) closeIcsModal();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!icsModal.hidden) closeIcsModal();
      else if (!modal.hidden) closeModal();
    }
  });

  window.addEventListener('hashchange', function () {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    if (h.indexOf('event=') === 0) {
      var id = decodeURIComponent(h.split('=')[1] || '');
      if (byId[id]) openEvent(id);
      return;
    }
    var prevDay = state.day, prevView = state.view;
    applyHash();
    if (state.day !== prevDay || state.view !== prevView) render();
  });

  /* ---------- Тема ---------- */
  function applyTheme() {
    document.body.setAttribute('data-theme', state.theme);
    var sel = $('theme-select');
    if (sel) sel.value = state.theme;
  }
  $('theme-select').addEventListener('change', function () {
    state.theme = this.value;
    applyTheme();
    persist();
  });

  /* ---------- Инициализация ---------- */
  function init() {
    var asOf = meta.source && meta.source.asOf ? meta.source.asOf.split('-').reverse().join('.') : '';
    $('asof-badge').textContent = 'Программа от ' + asOf;
    $('footer-asof').textContent = asOf;
    applyTheme();
    buildFilterControls();
    applyHash();
    render();
    if (location.hash.indexOf('#event=') === 0) {
      var id = decodeURIComponent(location.hash.split('=')[1] || '');
      if (byId[id]) openEvent(id);
    }
  }
  init();
})();
