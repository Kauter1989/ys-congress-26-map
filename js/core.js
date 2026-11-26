/* КМУ-2026 - Интерактивная деловая программа — чистая логика (без DOM).
 * Работает в браузере (window.KmuCore) и в Node (module.exports) для тестов. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KmuCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MSK_OFFSET_MIN = 180; // Europe/Moscow = UTC+3 (без перехода на летнее время)

  function toMinutes(hhmm) {
    var p = String(hhmm).split(':');
    return (+p[0]) * 60 + (+p[1]);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function minutesToHHMM(m) {
    m = ((m % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  function startMin(ev) { return toMinutes(ev.start); }
  function endMin(ev) { return toMinutes(ev.end); }

  function overlaps(a, b) {
    return a.date === b.date && startMin(a) < endMin(b) && startMin(b) < endMin(a);
  }

  /* Конфликты среди выбранных: пары и карта id -> [конфликтующие id] */
  function findConflicts(events) {
    var pairs = [];
    var map = {};
    var byDate = {};
    events.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    Object.keys(byDate).forEach(function (d) {
      var list = byDate[d].slice().sort(function (a, b) { return startMin(a) - startMin(b); });
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          if (startMin(list[j]) >= endMin(list[i])) break;
          pairs.push([list[i].id, list[j].id]);
          (map[list[i].id] = map[list[i].id] || []).push(list[j].id);
          (map[list[j].id] = map[list[j].id] || []).push(list[i].id);
        }
      }
    });
    return { pairs: pairs, map: map };
  }

  /* Колонки для сетки дня: жадная раскладка пересекающихся интервалов */
  function layoutColumns(events) {
    var sorted = events.slice().sort(function (a, b) {
      return startMin(a) - startMin(b) || endMin(a) - endMin(b) || a.id.localeCompare(b.id);
    });
    var colEnds = [];
    var result = {};
    sorted.forEach(function (ev) {
      var s = startMin(ev), e = endMin(ev);
      var col = -1;
      for (var i = 0; i < colEnds.length; i++) {
        if (colEnds[i] <= s) { col = i; break; }
      }
      if (col === -1) { col = colEnds.length; colEnds.push(e); }
      else colEnds[col] = e;
      result[ev.id] = { col: col };
    });
    return { cols: colEnds.length, byId: result };
  }

  /* --- Фильтрация --- */
  function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }

  function eventHaystack(ev) {
    if (ev._hay === undefined) {
      ev._hay = norm([ev.title, ev.series, ev.description, ev.track, ev.format, ev.venue,
        (ev.domains || []).join(' '),
        (ev.persons || []).map(function (p) { return p.name + ' ' + p.role; }).join(' ')
      ].join(' '));
    }
    return ev._hay;
  }

  function filterEvents(events, f) {
    f = f || {};
    var q = norm(f.query).trim();
    var tracks = f.tracks && f.tracks.length ? f.tracks : null;
    var domains = f.domains && f.domains.length ? f.domains : null;
    var formats = f.formats && f.formats.length ? f.formats : null;
    var speakers = f.speakers && f.speakers.length ? f.speakers.map(norm) : null;
    var selected = f.selected || null;
    return events.filter(function (ev) {
      if (f.day && f.day !== 'all' && ev.date !== f.day) return false;
      if (f.selectedOnly && (!selected || selected.indexOf(ev.id) === -1)) return false;
      if (tracks) {
        var t = ev.track || '__other__';
        if (tracks.indexOf(t) === -1) return false;
      }
      if (domains && !(ev.domains || []).some(function (d) { return domains.indexOf(d) !== -1; })) return false;
      if (formats && formats.indexOf(ev.format || '__none__') === -1) return false;
      if (speakers) {
        var names = (ev.persons || []).map(function (p) { return norm(p.name); });
        if (!speakers.some(function (s) { return names.indexOf(s) !== -1; })) return false;
      }
      if (q && eventHaystack(ev).indexOf(q) === -1) return false;
      return true;
    });
  }

  /* Индекс спикеров: имя -> число мероприятий */
  function speakerIndex(events) {
    var counts = {};
    events.forEach(function (ev) {
      var seen = {};
      (ev.persons || []).forEach(function (p) {
        if (!p.name || seen[p.name]) return;
        seen[p.name] = 1;
        counts[p.name] = (counts[p.name] || 0) + 1;
      });
    });
    return Object.keys(counts).sort(function (a, b) {
      return a.localeCompare(b, 'ru');
    }).map(function (name) { return { name: name, count: counts[name] }; });
  }

  /* --- Время/даты для экспорта --- */
  function dateParts(iso) {
    var p = iso.split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }

  /* UTC-строка YYYYMMDDTHHMMSSZ из локального (MSK) времени */
  function toUtcStamp(isoDate, hhmm) {
    var dp = dateParts(isoDate);
    var mins = toMinutes(hhmm) - MSK_OFFSET_MIN;
    var dayShift = Math.floor(mins / 1440);
    mins = ((mins % 1440) + 1440) % 1440;
    var dt = new Date(Date.UTC(dp.y, dp.m - 1, dp.d + dayShift));
    return dt.getUTCFullYear() +
      pad(dt.getUTCMonth() + 1) +
      pad(dt.getUTCDate()) + 'T' +
      pad(Math.floor(mins / 60)) + pad(mins % 60) + '00Z';
  }

  function utcNowStamp(now) {
    var dt = now || new Date();
    return dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate()) + 'T' +
      pad(dt.getUTCHours()) + pad(dt.getUTCMinutes()) + pad(dt.getUTCSeconds()) + 'Z';
  }

  function fullVenue(ev, meta) {
    var parts = [];
    if (meta && meta.venue) parts.push(meta.venue);
    if (ev.venue) parts.push(ev.venue);
    if (meta && meta.city) parts.push(meta.city);
    return parts.join(', ');
  }

  function personsText(ev) {
    var labels = {
      moderator: 'Модератор', speaker: 'Выступающий', panelist: 'Участник дискуссии',
      expert: 'Эксперт', opening: 'Приветственное слово', host: 'Ведущий', guest: 'Гость'
    };
    var groups = {};
    (ev.persons || []).forEach(function (p) {
      var k = labels[p.section] || 'Участник';
      (groups[k] = groups[k] || []).push(p.name + (p.role ? ' — ' + p.role : ''));
    });
    return Object.keys(groups).map(function (k) {
      return k + (groups[k].length > 1 ? 'и' : '') + ': ' + groups[k].join('; ');
    }).join('\n');
  }

  function eventDescription(ev, meta) {
    var lines = [];
    if (ev.series) lines.push(ev.series);
    if (ev.note) lines.push(ev.note);
    if (ev.track) lines.push('Трек: ' + ev.track);
    if (ev.format) lines.push('Формат: ' + ev.format);
    if (ev.description) lines.push(ev.description);
    var pt = personsText(ev);
    if (pt) lines.push(pt);
    if (meta && meta.source && meta.source.url) lines.push('Программа: ' + meta.source.url);
    return lines.join('\n\n');
  }

  /* --- Google Calendar: ссылка на одно мероприятие --- */
  function googleCalendarUrl(ev, meta) {
    var params = {
      action: 'TEMPLATE',
      text: ev.title,
      dates: toUtcStamp(ev.date, ev.start) + '/' + toUtcStamp(ev.date, ev.end),
      ctz: 'Europe/Moscow',
      details: eventDescription(ev, meta),
      location: fullVenue(ev, meta),
      sf: 'true',
      output: 'xml'
    };
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return 'https://calendar.google.com/calendar/render?' + qs;
  }

  /* --- ICS --- */
  function icsEscape(text) {
    return String(text || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  /* сворачивание строк по RFC 5545 (75 октетов, UTF-8) */
  function foldLine(line) {
    var bytes = [];
    var out = [];
    var cur = '';
    var curLen = 0;
    var encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    function blen(s) {
      if (encoder) return encoder.encode(s).length;
      return unescape(encodeURIComponent(s)).length;
    }
    var limit = 74;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var cl = blen(ch);
      if (curLen + cl > limit) {
        out.push(cur);
        cur = ' ' + ch;
        curLen = 1 + cl;
      } else {
        cur += ch;
        curLen += cl;
      }
    }
    out.push(cur);
    return out.join('\r\n');
  }

  function buildICS(events, meta, now) {
    var stamp = utcNowStamp(now);
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KMU2026//Interaktivnaya Delovaya Programma//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape((meta && meta.title ? meta.title : 'КМУ-2026') + ' · Избранное'),
      'X-WR-TIMEZONE:Europe/Moscow'
    ];
    events.forEach(function (ev) {
      lines.push('BEGIN:VEVENT');
      lines.push('UID:kmu2026-' + ev.id + '@planner.local');
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART:' + toUtcStamp(ev.date, ev.start));
      lines.push('DTEND:' + toUtcStamp(ev.date, ev.end));
      lines.push('SUMMARY:' + icsEscape(ev.title));
      lines.push('LOCATION:' + icsEscape(fullVenue(ev, meta)));
      lines.push('DESCRIPTION:' + icsEscape(eventDescription(ev, meta)));
      if (meta && meta.source && meta.source.url) lines.push('URL:' + meta.source.url);
      lines.push('STATUS:CONFIRMED');
      lines.push('TRANSP:OPAQUE');
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + icsEscape('Скоро: ' + ev.title));
      lines.push('TRIGGER:-PT15M');
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  /* --- Форматирование для UI --- */
  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function formatDate(iso, withWeekday) {
    var dp = dateParts(iso);
    var dt = new Date(Date.UTC(dp.y, dp.m - 1, dp.d));
    var s = dp.d + ' ' + MONTHS[dp.m - 1];
    if (withWeekday) s += ', ' + WEEKDAYS[dt.getUTCDay()];
    return s;
  }

  function durationText(ev) {
    var d = endMin(ev) - startMin(ev);
    var h = Math.floor(d / 60), m = d % 60;
    if (h && m) return h + ' ч ' + m + ' мин';
    if (h) return h + ' ч';
    return m + ' мин';
  }

  function trackKey(ev) { return ev.track || '__other__'; }

  return {
    MSK_OFFSET_MIN: MSK_OFFSET_MIN,
    toMinutes: toMinutes,
    minutesToHHMM: minutesToHHMM,
    startMin: startMin,
    endMin: endMin,
    overlaps: overlaps,
    findConflicts: findConflicts,
    layoutColumns: layoutColumns,
    filterEvents: filterEvents,
    speakerIndex: speakerIndex,
    toUtcStamp: toUtcStamp,
    utcNowStamp: utcNowStamp,
    fullVenue: fullVenue,
    personsText: personsText,
    eventDescription: eventDescription,
    googleCalendarUrl: googleCalendarUrl,
    icsEscape: icsEscape,
    foldLine: foldLine,
    buildICS: buildICS,
    formatDate: formatDate,
    durationText: durationText,
    trackKey: trackKey
  };
});
