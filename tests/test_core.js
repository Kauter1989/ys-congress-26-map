/* Node-тесты чистой логики: node tests/test_core.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const sandbox = { TextEncoder };
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'data.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8'), sandbox);

const DATA = sandbox.window.PROGRAM_DATA;
const C = sandbox.window.KmuCore || sandbox.KmuCore;
assert(DATA && C, 'data/core loaded');
const events = DATA.events;
const meta = DATA.meta;

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }
const J = (x) => JSON.parse(JSON.stringify(x)); // нормализация массивов из vm-контекста

console.log('Данные:');
ok('149 мероприятий, 3 дня', () => {
  assert.strictEqual(events.length, 149);
  assert.deepStrictEqual(J(meta.dates), ['2026-12-02', '2026-12-03', '2026-12-04']);
});
ok('у всех событий есть название, время, зал', () => {
  for (const e of events) {
    assert(e.title, e.id);
    assert(/^\d{2}:\d{2}$/.test(e.start) && /^\d{2}:\d{2}$/.test(e.end), e.id);
    assert(e.start < e.end, e.id);
    assert(e.venue, e.id);
  }
});
ok('домены и спикеры извлечены', () => {
  assert(events.filter(e => e.domains.length).length > 140);
  assert(C.speakerIndex(events).length > 700);
});

console.log('Время и конфликты:');
ok('toUtcStamp: 09:30 МСК = 06:30Z', () => {
  assert.strictEqual(C.toUtcStamp('2026-12-02', '09:30'), '20261202T063000Z');
  assert.strictEqual(C.toUtcStamp('2026-12-04', '00:30'), '20261203T213000Z');
});
ok('overlaps и findConflicts', () => {
  const a = { id: 'a', date: '2026-12-02', start: '10:00', end: '11:30' };
  const b = { id: 'b', date: '2026-12-02', start: '11:00', end: '12:00' };
  const c = { id: 'c', date: '2026-12-02', start: '11:30', end: '13:00' };
  const d = { id: 'd', date: '2026-12-03', start: '10:00', end: '11:30' };
  assert(C.overlaps(a, b));
  assert(!C.overlaps(a, c)); // стык встык — не конфликт
  assert(!C.overlaps(a, d)); // разные дни
  const r = C.findConflicts([a, b, c, d]);
  assert.deepStrictEqual(J(r.pairs), [['a', 'b'], ['b', 'c']]);
  assert.deepStrictEqual(J(r.map.a), ['b']);
  assert.deepStrictEqual(J(r.map.b), ['a', 'c']);
});
ok('реальные параллельные слоты дают конфликты', () => {
  const slot = events.filter(e => e.date === '2026-12-02' && e.start === '10:00');
  assert(slot.length > 3);
  const r = C.findConflicts(slot);
  assert(r.pairs.length > 0);
});
ok('layoutColumns: параллельные события в разных колонках', () => {
  const slot = events.filter(e => e.date === '2026-12-02' && e.start === '10:00');
  const lay = C.layoutColumns(slot);
  const cols = new Set(slot.map(e => lay.byId[e.id].col));
  assert.strictEqual(cols.size, slot.length);
  assert.strictEqual(lay.cols, slot.length);
});

console.log('Фильтры:');
ok('фильтр по домену «Медицина и здоровье»', () => {
  const r = C.filterEvents(events, { domains: ['Медицина и здоровье'] });
  assert(r.length > 10);
  assert(r.every(e => e.domains.includes('Медицина и здоровье')));
});
ok('фильтр по спикеру', () => {
  const idx = C.speakerIndex(events);
  const top = idx.slice().sort((a, b) => b.count - a.count)[0];
  const r = C.filterEvents(events, { speakers: [top.name] });
  assert.strictEqual(r.length, top.count);
});
ok('поиск по слову «грант»', () => {
  const r = C.filterEvents(events, { query: 'грант' });
  assert(r.length > 3);
});
ok('комбинация день + трек + поиск', () => {
  const r = C.filterEvents(events, { day: '2026-12-03', tracks: ['Школа РНФ'] });
  assert(r.length > 0 && r.every(e => e.date === '2026-12-03' && e.track === 'Школа РНФ'));
});

console.log('Экспорт:');
ok('Google Calendar URL корректен', () => {
  const ev = events[0];
  const url = C.googleCalendarUrl(ev, meta);
  const u = new URL(url);
  assert.strictEqual(u.origin + u.pathname, 'https://calendar.google.com/calendar/render');
  assert.strictEqual(u.searchParams.get('action'), 'TEMPLATE');
  assert.strictEqual(u.searchParams.get('text'), ev.title);
  const dates = u.searchParams.get('dates').split('/');
  assert.strictEqual(dates[0], C.toUtcStamp(ev.date, ev.start));
  assert.strictEqual(dates[1], C.toUtcStamp(ev.date, ev.end));
  assert(u.searchParams.get('location').includes('Экспофорум'));
});
ok('ICS: структура, количество VEVENT, UTC-время', () => {
  const sel = events.filter(e => e.date === '2026-12-02').slice(0, 5);
  const ics = C.buildICS(sel, meta, new Date(Date.UTC(2026, 10, 26, 12, 0, 0)));
  assert(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert(ics.endsWith('END:VCALENDAR\r\n'));
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 5);
  assert.strictEqual((ics.match(/END:VEVENT/g) || []).length, 5);
  assert(ics.includes('DTSTART:20261202T'));
  assert(ics.includes('DTSTAMP:20261126T120000Z'));
  assert(ics.includes('TRIGGER:-PT15M'));
  const unfolded = ics.replace(/\r\n[ \t]/g, '');
  assert(unfolded.includes('SUMMARY:' + sel[0].title.replace(/,/g, '\\,')));
  // сворачивание строк: ни одна строка не длиннее 75 октетов
  for (const line of ics.split('\r\n')) {
    assert(Buffer.byteLength(line, 'utf8') <= 75, 'line too long: ' + line.slice(0, 40));
  }
});
ok('ICS-экранирование', () => {
  assert.strictEqual(C.icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

console.log('\nПройдено тестов: ' + passed);
