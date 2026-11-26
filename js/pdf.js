/* КМУ-2026 · Экспорт избранных мероприятий в PDF (полностью на клиенте).
 * jsPDF + сабсеты Montserrat (кириллица). Работает на GitHub Pages без сервера. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KmuPdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);

  var PAGE_W = 210, PAGE_H = 297;
  var MX = 16;                 // поля
  var CW = PAGE_W - MX * 2;    // ширина контента
  var TOP = 20, BOTTOM = 282;

  var NAVY = [15, 14, 73];
  var TEAL = [15, 143, 160];
  var BLUE = [34, 116, 184];
  var TEXT = [24, 35, 56];
  var MUTED = [91, 107, 133];
  var RED = [217, 45, 74];
  var LINE = [210, 218, 232];

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

  /* deps: { jsPDF, fonts } — для тестов в Node; в браузере берётся из window */
  function buildPdf(events, meta, conflicts, deps) {
    var jsPDF = (deps && deps.jsPDF) || (root.jspdf && root.jspdf.jsPDF);
    var fonts = (deps && deps.fonts) || root.KMU_PDF_FONTS;
    if (!jsPDF || !fonts) throw new Error('PDF libs not loaded');
    conflicts = conflicts || { map: {} };

    var doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    doc.addFileToVFS('Montserrat-Regular.ttf', fonts.regular);
    doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal');
    doc.addFileToVFS('Montserrat-Bold.ttf', fonts.bold);
    doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');

    var y = TOP;
    var firstPage = true;

    function setFont(style, size, color) {
      doc.setFont('Montserrat', style);
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
    }
    function newPage() {
      doc.addPage();
      firstPage = false;
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

    /* --- Шапка-титул --- */
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

    var totalMin = events.reduce(function (s, e) {
      var a = e.start.split(':'), b = e.end.split(':');
      return s + ((+b[0]) * 60 + (+b[1])) - ((+a[0]) * 60 + (+a[1]));
    }, 0);
    var days = {};
    events.forEach(function (e) { days[e.date] = 1; });
    para('Выбрано: ' + events.length + ' мероприятий · ' + Math.floor(totalMin / 60) + ' ч ' + (totalMin % 60) + ' мин · дней: ' + Object.keys(days).length, 10, 'bold', TEXT, 5, 2);
    if (conflicts.pairs && conflicts.pairs.length) {
      para('Внимание: ' + conflicts.pairs.length + ' пересечений по времени среди выбранных (отмечены ниже).', 9, 'normal', RED, 4.5, 2);
    }
    para('Составлено ' + new Date().toLocaleDateString('ru-RU') + ' по официальной программе от ' +
      (meta.source && meta.source.asOf ? meta.source.asOf.split('-').reverse().join('.') : '') + '. Программа может меняться — сверяйтесь с science-congress.com.', 8, 'normal', MUTED, 4, 4);

    /* --- По дням --- */
    var byDate = {};
    events.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    var WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

    Object.keys(byDate).sort().forEach(function (d) {
      var dp = d.split('-');
      var dt = new Date(Date.UTC(+dp[0], +dp[1] - 1, +dp[2]));
      var dayEvents = byDate[d].slice().sort(function (a, b) { return a.start.localeCompare(b.start); });
      ensure(14);
      y += 3;
      setFont('bold', 13, NAVY);
      doc.text(+dp[2] + ' ' + MONTHS[+dp[1] - 1] + ', ' + WD[dt.getUTCDay()], MX, y);
      setFont('normal', 9, MUTED);
      doc.text(dayEvents.length + ' меропр.', PAGE_W - MX, y, { align: 'right' });
      y += 2.5;
      doc.setDrawColor(TEAL[0], TEAL[1], TEAL[2]);
      doc.setLineWidth(0.6);
      doc.line(MX, y, PAGE_W - MX, y);
      y += 7;

      dayEvents.forEach(function (ev) {
        ensure(24);
        /* время + зал */
        setFont('bold', 10, TEAL);
        doc.text(ev.start + '–' + ev.end, MX, y);
        setFont('normal', 8.5, MUTED);
        doc.text(ev.venue || '', MX + 26, y);
        if (conflicts.map[ev.id]) {
          setFont('bold', 8.5, RED);
          doc.text('[конфликт по времени]', PAGE_W - MX, y, { align: 'right' });
        }
        y += 5.5;
        /* название */
        para(ev.title, 11, 'bold', TEXT, 5, 1.5);
        /* трек / формат / серия */
        var metaLine = [ev.series, ev.track, ev.format].filter(Boolean).join(' · ');
        if (metaLine) para(metaLine, 8, 'normal', BLUE, 4, 1.5);
        /* описание */
        if (ev.description) para(ev.description, 9, 'normal', TEXT, 4.4, 1.5);
        /* участники */
        var labels = { moderator: 'Модератор', speaker: 'Выступающие', panelist: 'Участники дискуссии', expert: 'Эксперты', opening: 'Приветственное слово', host: 'Ведущий', guest: 'Гость' };
        var groups = {};
        (ev.persons || []).forEach(function (p) { (groups[p.section] = groups[p.section] || []).push(p); });
        Object.keys(groups).forEach(function (sec) {
          var txt = (labels[sec] || 'Участники') + ': ' + groups[sec].map(function (p) {
            return p.name + (p.role ? ' — ' + p.role : '');
          }).join('; ');
          para(txt, 8, 'normal', MUTED, 4, 1);
        });
        /* конфликты подробно */
        if (conflicts.map[ev.id]) {
          var names = conflicts.map[ev.id].map(function (id) {
            var c = null;
            events.forEach(function (e) { if (e.id === id) c = e; });
            return c ? c.title + ' (' + c.start + '–' + c.end + ')' : id;
          }).join('; ');
          para('Пересекается с: ' + names, 8, 'normal', RED, 4, 1);
        }
        y += 2;
        ensure(4);
        doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
        doc.setLineWidth(0.2);
        doc.line(MX, y, PAGE_W - MX, y);
        y += 6;
      });
    });

    /* --- Колонтитулы --- */
    var n = doc.getNumberOfPages();
    for (var i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.setLineWidth(0.2);
      doc.line(MX, 288, PAGE_W - MX, 288);
      setFont('normal', 7.5, MUTED);
      doc.text('Неофициальный планировщик · источник: science-congress.com', MX, 292.5);
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
