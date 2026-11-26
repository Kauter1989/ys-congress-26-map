/* Node-тест генерации PDF: node tests/test_pdf.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');

global.window = global;
global.self = global;
require(path.join(root, 'data.js'));
require(path.join(root, 'js', 'pdf-fonts.js'));
const { jsPDF } = require(path.join(root, 'js', 'vendor', 'jspdf.umd.min.js'));
const KmuPdf = require(path.join(root, 'js', 'pdf.js'));
const C = require(path.join(root, 'js', 'core.js'));

const DATA = global.PROGRAM_DATA;
const events = DATA.events;
const sel = [
  ...events.filter(e => e.date === '2026-12-02' && e.start === '10:00').slice(0, 2),
  events.find(e => e.date === '2026-12-03' && e.start === '09:30'),
  events.find(e => e.date === '2026-12-04' && e.start === '10:00'),
  events.find(e => e.date === '2026-12-02' && e.start === '09:30')
];
const conflicts = C.findConflicts(sel);
const doc = KmuPdf.buildPdf(sel, DATA.meta, conflicts, { jsPDF, fonts: global.KMU_PDF_FONTS });
const buf = Buffer.from(doc.output('arraybuffer'));
const out = path.join(root, '_research', 'test_selected.pdf');
fs.writeFileSync(out, buf);

assert(buf.slice(0, 5).toString() === '%PDF-', 'PDF header');
assert(buf.length > 30000, 'PDF size > 30KB, got ' + buf.length);
const pages = doc.getNumberOfPages();
assert(pages >= 2, 'multipage, got ' + pages);
console.log('PDF ok:', buf.length, 'bytes,', pages, 'pages ->', out);
