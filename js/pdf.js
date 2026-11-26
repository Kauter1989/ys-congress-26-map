/* КМУ-2026 · Экспорт избранных мероприятий в PDF (полностью на клиенте).
 * Структура: титул → обзор по дням в виде вертикального таймлайна с плитками
 * (как на сайте) → подробная страница каждого мероприятия.
 * jsPDF + сабсеты Montserrat (кириллица). Работает на GitHub Pages без сервера. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KmuPdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);

  var PAGE_W = 210, PAGE_H = 297;
  var MX = 16;
  var CW = PAGE_W - MX * 2;
  var TOP = 20, BOTTOM = 282;

  var NAVY = [15, 14, 73];
  var TEAL = [15, 143, 160];
  var BLUE = [34, 116, 184];
  var TEXT = [24, 35, 56];
  var MUTED = [91, 107, 133];
  var RED = [217, 45, 74];
  var LINE = [210, 218, 232];
  var TILE_BG = [248, 250, 253];

  var TRACK_COLORS = {
    'Платформа развития: люди, среда, инструменты': [31, 111, 176],
    'Большие вызовы научно-технологического развития': [109, 63, 212],
    'Наука без границ: идеи, открытия, решения': [12, 138, 150],
    'Инициативы Десятилетия науки и технологий': [199, 116, 0],
    'Школа РНФ': [217, 45, 74]
  };
  var TRACK_SHORT = {
    'Платформа развития: люди, среда, инструменты': 'Платформа развития',
    'Большие вызовы научно-технологического развития': 'Большие вызовы',
    'Наука без границ: идеи, открытия, решения': 'Наука без границ',
    'Инициативы Десятилетия науки и технологий': 'Инициативы Десятилетия',
    'Школа РНФ': 'Школа РНФ'
  };
  function trackColor(ev) { return TRACK_COLORS[ev.track] || [91, 107, 133]; }

  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  function dayLabel(d) {
    var p = d.split('-');
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return { date: (+p[2]) + ' ' + MONTHS[+p[1] - 1], wd: WD[dt.getUTCDay()] };
  }
  function mins(hhmm) { var p = hhmm.split(':'); return (+p[0]) * 60 + (+p[1]); }

  function layoutCols(events) {
    var sorted = events.slice().sort(function (a, b) { return mins(a.start) - mins(b.start) || mins(a.end) - mins(b.end); });
    var ends = [], byId = {};
    sorted.forEach(function (ev) {
      var s = mins(ev.start), e = mins(ev.end), col = -1;
      for (var i = 0; i < ends.length; i++) if (ends[i] <= s) { col = i; break; }
      if (col === -1) { col = ends.length; ends.push(e); } else ends[col] = e;
      byId[ev.id] = col;
    });
    return { cols: ends.length, byId: byId };
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Не удалось загрузить ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureLibs() {
    if (root.jspdf && root.KMU_PDF_FONTS) return Promise.resolve();
    return loadScript('js/vendor/jspdf.umd.min.js')
      .then(function () { return loadScript('js/pdf-fonts.js'); });
  }

  function buildPdf(events, meta, conflicts, deps) {
    var jsPDF = (deps && deps.jsPDF) || (root.jspdf && root.jspdf.jsPDF);
    var fonts = (deps && deps.fonts) || root.KMU_PDF_FONTS;
    if (!jsPDF || !fonts) throw new Error('PDF libs not loaded');
    conflicts = conflicts || { map: {}, pairs: [] };

    var doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    doc.addFileToVFS('Montserrat-Regular.ttf', fonts.regular);
    doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal');
    doc.addFileToVFS('Montserrat-Bold.ttf', fonts.bold);
    doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');

    var y = TOP;
    function setFont(style, size, color) {
      doc.setFont('Montserrat', style);
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
    }
    function newPage() {
      doc.addPage();
      y = TOP;
      setFont('normal', 8, MUTED);
      doc.text('КМУ-2026 · Избранные мероприятия', MX, 12);
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.setLineWidth(0.2);
      doc.line(MX, 14.5, PAGE_W - MX, 14.5);
    }
    function ensure(h) { if (y + h > BOTTOM) newPage(); }
    function para(text, size, style, color, lh, gapAfter) {
      if (!text) return;
      setFont(style, size, color);
      var lines = doc.splitTextToSize(String(text), CW);
      for (var i = 0; i < lines.length; i++) {
        ensure(lh);
        setFont(style, size, color);
        doc.text(lines[i], MX, y);
        y += lh;
      }
      y += (gapAfter || 0);
    }
    function rule(color, w) {
      doc.setDrawColor(color[0], color[1], color[2]);
      doc.setLineWidth(w || 0.2);
      doc.line(MX, y, PAGE_W - MX, y);
    }

    /* ================= Титул ================= */
    doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.rect(0, 0, PAGE_W, 34, 'F');
    doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
    doc.rect(0, 34, PAGE_W, 1.2, 'F');
    setFont('bold', 15, [255, 255, 255]);
    doc.text('VI Конгресс молодых учёных', MX, 14);
    setFont('normal', 10, [143, 232, 239]);
    doc.text('Деловая программа · избранные мероприятия', MX, 21.5);
    setFont('normal', 8.5, [200, 210, 235]);
    doc.text('2–4 декабря 2026 · Санкт-Петербург, КВЦ «Экспофорум»', MX, 28);
    y = 44;

    var totalMin = events.reduce(function (s, e) { return s + mins(e.end) - mins(e.start); }, 0);
    var days = {};
    events.forEach(function (e) { days[e.date] = 1; });
    para('Выбрано: ' + events.length + ' мероприятий · ' + Math.floor(totalMin / 60) + ' ч ' + (totalMin % 60) + ' мин · дней: ' + Object.keys(days).length, 10, 'bold', TEXT, 5, 2);
    if (conflicts.pairs && conflicts.pairs.length) {
      para('Внимание: ' + conflicts.pairs.length + ' пересечений по времени среди выбранных (отмечены красным).', 9, 'normal', RED, 4.5, 2);
    }
    para('Составлено ' + new Date().toLocaleDateString('ru-RU') + ' по официальной программе от ' +
      (meta.source && meta.source.asOf ? meta.source.asOf.split('-').reverse().join('.') : '') + '. Программа может меняться — сверяйтесь с science-congress.com.', 8, 'normal', MUTED, 4, 5);

    /* легенда треков */
    setFont('bold', 9, NAVY);
    doc.text('Треки:', MX, y);
    var lx = MX + 14;
    Object.keys(TRACK_SHORT).forEach(function (name) {
      var c = TRACK_COLORS[name];
      doc.setFillColor(c[0], c[1], c[2]);
      doc.rect(lx, y - 2.6, 3, 3, 'F');
      setFont('normal', 7.5, MUTED);
      doc.text(TRACK_SHORT[name], lx + 4.5, y);
      lx += 4.5 + doc.getTextWidth(TRACK_SHORT[name]) + 7;
      if (lx > PAGE_W - MX - 30) { lx = MX + 14; y += 5; }
    });
    y += 7;
    para('Далее: обзор каждого дня в виде таймлайна с плитками, затем подробная страница каждого мероприятия.', 8, 'normal', MUTED, 4, 7);

    /* ================= Обзор по дням (таймлайн-плитки) ================= */
    var byDate = {};
    events.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });

    Object.keys(byDate).sort().forEach(function (d) {
      var dayEvents = byDate[d].slice().sort(function (a, b) { return mins(a.start) - mins(b.start); });
      var lbl = dayLabel(d);
      var dayStart = Math.floor(Math.min.apply(null, dayEvents.map(function (e) { return mins(e.start); })) / 60) * 60;
      var dayEnd = Math.ceil(Math.max.apply(null, dayEvents.map(function (e) { return mins(e.end); })) / 60) * 60;
      var span = dayEnd - dayStart;
      var headerH = 12;
      var avail = BOTTOM - 4 - y;
      if (avail < headerH + 45) { newPage(); avail = BOTTOM - 4 - y; }
      var ppm = Math.min(0.55, (avail - headerH) / span);

      setFont('bold', 13, NAVY);
      doc.text(lbl.date + ', ' + lbl.wd, MX, y);
      setFont('normal', 9, MUTED);
      doc.text(dayEvents.length + ' меропр. · обзор', PAGE_W - MX, y, { align: 'right' });
      y += 2.5;
      rule(TEAL, 0.6);
      y += 6;

      var y0 = y;
      var H = span * ppm;
      var lay = layoutCols(dayEvents);
      var gutterW = 13;
      var gap = 2;
      var colW = Math.min(85, (CW - gutterW - gap - (lay.cols - 1) * gap) / lay.cols);
      var fs = colW < 26 ? 6 : 6.8;

      /* часовые линии и метки */
      for (var m = dayStart; m <= dayEnd; m += 60) {
        var ly = y0 + (m - dayStart) * ppm;
        doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
        doc.setLineWidth(0.15);
        doc.line(MX + gutterW, ly, PAGE_W - MX, ly);
        if (m < dayEnd) {
          setFont('normal', 7, MUTED);
          var hh = ('0' + Math.floor(m / 60)).slice(-2) + ':00';
          doc.text(hh, MX + gutterW - 2, ly + 1, { align: 'right' });
        }
      }

      /* плитки */
      dayEvents.forEach(function (ev) {
        var col = lay.byId[ev.id];
        var tx = MX + gutterW + gap + col * (colW + gap);
        var ty = y0 + (mins(ev.start) - dayStart) * ppm + 0.4;
        var th = Math.max((mins(ev.end) - mins(ev.start)) * ppm - 0.8, 9);
        var c = trackColor(ev);
        var conf = conflicts.map[ev.id];
        doc.setFillColor(TILE_BG[0], TILE_BG[1], TILE_BG[2]);
        doc.setDrawColor(conf ? RED[0] : LINE[0], conf ? RED[1] : LINE[1], conf ? RED[2] : LINE[2]);
        doc.setLineWidth(conf ? 0.45 : 0.2);
        doc.roundedRect(tx, ty, colW, th, 1, 1, 'FD');
        doc.setFillColor(c[0], c[1], c[2]);
        doc.rect(tx, ty + 0.6, 1.2, th - 1.2, 'F');
        var innerX = tx + 2.8;
        var innerW = colW - 4.2;
        setFont('bold', fs, TEAL);
        doc.text(ev.start + '–' + ev.end, innerX, ty + 3.6);
        if (conf) {
          setFont('bold', fs, RED);
          doc.text('!', tx + colW - 2.6, ty + 3.6);
        }
        var titleLines = doc.splitTextToSize(ev.title, innerW);
        var maxLines = Math.max(1, Math.floor((th - 7) / (fs * 0.42)));
        setFont('normal', fs, TEXT);
        for (var i = 0; i < Math.min(titleLines.length, maxLines); i++) {
          doc.text(titleLines[i], innerX, ty + 7 + i * fs * 0.42);
        }
        if (th > 20) {
          setFont('normal', fs - 1, MUTED);
          var room = ev.room || ev.venue || '';
          var rl = doc.splitTextToSize(room, innerW);
          doc.text(rl[0] || '', innerX, ty + th - 2);
        }
      });
      y = y0 + H + 10;
    });

    /* ================= Подробные страницы ================= */
    var ordered = events.slice().sort(function (a, b) { return a.date.localeCompare(b.date) || mins(a.start) - mins(b.start); });
    ordered.forEach(function (ev, idx) {
      var lbl = dayLabel(ev.date);
      newPage();
      setFont('bold', 10, TEAL);
      doc.text(lbl.date + ', ' + lbl.wd, MX, y);
      setFont('bold', 11, NAVY);
      doc.text(ev.start + '–' + ev.end, PAGE_W - MX, y, { align: 'right' });
      y += 5;
      setFont('normal', 8.5, MUTED);
      doc.text((ev.venue || '') + ' · ' + (idx + 1) + ' из ' + ordered.length, MX, y);
      y += 2;
      rule(LINE, 0.2);
      y += 7;

      para(ev.title, 14, 'bold', TEXT, 6.5, 2);
      var metaLine = [ev.series, ev.note, ev.track, ev.format].filter(Boolean).join(' · ');
      if (metaLine) para(metaLine, 9, 'normal', BLUE, 4.5, 2);
      if (conflicts.map[ev.id]) {
        var names = conflicts.map[ev.id].map(function (id) {
          var c = null;
          events.forEach(function (e) { if (e.id === id) c = e; });
          return c ? c.title + ' (' + c.start + '–' + c.end + ')' : id;
        }).join('; ');
        para('Конфликт по времени: пересекается с ' + names, 9, 'bold', RED, 4.5, 2);
      }
      if (ev.description) {
        para('Описание', 9, 'bold', NAVY, 5, 1.5);
        para(ev.description, 9.5, 'normal', TEXT, 4.8, 3);
      }
      var labels = { moderator: 'Модератор', speaker: 'Выступающие', panelist: 'Участники дискуссии', expert: 'Эксперты', opening: 'Приветственное слово', host: 'Ведущий', guest: 'Гость' };
      var groups = {};
      (ev.persons || []).forEach(function (p) { (groups[p.section] = groups[p.section] || []).push(p); });
      if (Object.keys(groups).length) {
        para('Участники · ' + (ev.persons || []).length, 9, 'bold', NAVY, 5, 1.5);
        Object.keys(groups).forEach(function (sec) {
          para((labels[sec] || 'Участники') + ':', 8.5, 'bold', TEAL, 4.5, 0.5);
          groups[sec].forEach(function (p) {
            para(p.name + (p.role ? ' — ' + p.role : ''), 8.5, 'normal', MUTED, 4.2, 1);
          });
          y += 1;
        });
      }
    });

    /* ================= Колонтитулы ================= */
    var n = doc.getNumberOfPages();
    for (var i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.setLineWidth(0.2);
      doc.line(MX, 288, PAGE_W - MX, 288);
      setFont('normal', 7.5, MUTED);
      doc.text('КМУ-2026 · Интерактивная деловая программа · science-congress.com', MX, 292.5);
      doc.text('Стр. ' + i + ' из ' + n, PAGE_W - MX, 292.5, { align: 'right' });
    }
    return doc;
  }

  function downloadPdf(events, meta, conflicts) {
    return ensureLibs().then(function () {
      var doc = buildPdf(events, meta, conflicts);
      var blob = doc.output('blob');
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'kmu2026-selected.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  return { ensureLibs: ensureLibs, buildPdf: buildPdf, downloadPdf: downloadPdf };
});
