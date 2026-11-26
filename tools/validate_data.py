# -*- coding: utf-8 -*-
"""
Валидация data.js против исходного PDF программы + внутренние проверки.

Запуск:
    python tools/validate_data.py <путь к PDF> [--data data.js] [--report _research/validation_report.json]

Проверки:
  A. Мультимножество таймслотов (start,end) из PDF == data.js
  B. Заголовки (bold 9, правая колонка, независимая группировка) == названия в data.js
  C. Имена спикеров (маркеры-буллеты, bold) == persons в data.js
  D. Залы каждого события встречаются в тексте PDF
  E. Описания: начало/середина/конец каждого описания встречаются в тексте PDF
  F. Внутренняя целостность data.js (id, время, залы, имена, домены, артефакты)
"""
import argparse
import json
import os
import re
import sys
from collections import Counter

from pypdf import PdfReader

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_program import collect_lines, norm_space, DOMAIN_RULES


def nows(s):
    return re.sub(r'\s+', '', s or '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--data', default='data.js')
    ap.add_argument('--report', default='_research/validation_report.json')
    args = ap.parse_args()

    raw = open(args.data, encoding='utf-8').read()
    data = json.loads(raw[raw.index('=') + 1:].rstrip().rstrip(';'))
    events = data['events']
    meta = data['meta']
    reader = PdfReader(args.pdf)

    plain_pages = [(p.extract_text() or '') for p in reader.pages]
    plain_all = '\n'.join(plain_pages)
    plain_nows = nows(plain_all)

    fails = []
    warns = []

    # --- A: таймслоты ---
    pdf_times = Counter()
    for t in plain_pages:
        for m in re.finditer(r'(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})', t):
            pdf_times[(m.group(1).zfill(5), m.group(2).zfill(5))] += 1
    js_times = Counter((e['start'], e['end']) for e in events)
    if pdf_times != js_times:
        only_pdf = pdf_times - js_times
        only_js = js_times - pdf_times
        fails.append({'check': 'A_times', 'only_in_pdf': dict(only_pdf), 'only_in_data': dict(only_js)})
    a_ok = pdf_times == js_times

    # --- B: заголовки (независимо: все bold9 строки правой колонки, группировка по близости y) ---
    title_runs = []
    for pi, page in enumerate(reader.pages):
        _, right = collect_lines(page)
        run = []
        prev_y = None
        for ln in sorted(right, key=lambda l: -l['y']):
            if ln['bold'] and ln['fs'] == 9.0:
                if prev_y is not None and prev_y - ln['y'] > 13 and run:
                    title_runs.append(norm_space(' '.join(run)))
                    run = []
                run.append(ln['text'])
                prev_y = ln['y']
            else:
                if run:
                    title_runs.append(norm_space(' '.join(run)))
                    run = []
                prev_y = None
        if run:
            title_runs.append(norm_space(' '.join(run)))
    pdf_titles = Counter(title_runs)
    js_titles = Counter(e['title'] for e in events)
    b_ok = True
    if pdf_titles != js_titles:
        b_ok = False
        fails.append({'check': 'B_titles',
                      'only_in_pdf': dict(pdf_titles - js_titles),
                      'only_in_data': dict(js_titles - pdf_titles)})

    # --- C: имена спикеров ---
    pdf_names = Counter()
    for page in reader.pages:
        _, right = collect_lines(page)
        for ln in right:
            if ln['sym']:
                name = norm_space(''.join(f['text'] for f in ln['frags'] if f['bold']))
                if name:
                    pdf_names[name] += 1
    js_names = Counter(p['name'] for e in events for p in e['persons'])
    c_ok = pdf_names == js_names
    if not c_ok:
        fails.append({'check': 'C_speakers',
                      'only_in_pdf': dict(pdf_names - js_names),
                      'only_in_data': dict(js_names - pdf_names)})

    # --- D: залы ---
    d_missing = []
    for e in events:
        room = e.get('room') or ''
        if room and nows(room) not in plain_nows:
            d_missing.append({'id': e['id'], 'room': room})
        note = e.get('note') or ''
        if note and nows(note) not in plain_nows:
            d_missing.append({'id': e['id'], 'note': note})
    if d_missing:
        fails.append({'check': 'D_rooms_notes', 'missing': d_missing})

    # --- E: описания (3 пробы на событие) ---
    e_missing = []
    for e in events:
        d = e.get('description') or ''
        if not d:
            continue
        dn = nows(d)
        probes = [dn[:60], dn[len(dn) // 2:len(dn) // 2 + 60], dn[-60:]]
        for i, pr in enumerate(probes):
            if len(pr) >= 25 and pr not in plain_nows:
                e_missing.append({'id': e['id'], 'probe': i, 'text': pr[:60]})
    if e_missing:
        fails.append({'check': 'E_descriptions', 'missing': e_missing})

    # --- F: внутренняя целостность ---
    ids = [e['id'] for e in events]
    if len(ids) != len(set(ids)):
        fails.append({'check': 'F_dup_ids', 'dups': [i for i, c in Counter(ids).items() if c > 1]})
    known_domains = {label for label, _ in DOMAIN_RULES}
    for e in events:
        if e['date'] not in meta['dates']:
            fails.append({'check': 'F_date', 'id': e['id'], 'date': e['date']})
        if not re.fullmatch(r'\d{2}:\d{2}', e['start']) or not re.fullmatch(r'\d{2}:\d{2}', e['end']):
            fails.append({'check': 'F_timefmt', 'id': e['id']})
        if e['start'] >= e['end']:
            fails.append({'check': 'F_timeorder', 'id': e['id']})
        if not e['title']:
            fails.append({'check': 'F_title', 'id': e['id']})
        if not e['venue']:
            fails.append({'check': 'F_venue', 'id': e['id']})
        if '_venue' in e or '_right' in e:
            fails.append({'check': 'F_leftover', 'id': e['id']})
        if not set(e.get('domains', [])) <= known_domains:
            fails.append({'check': 'F_domains', 'id': e['id'], 'domains': e['domains']})
        if re.search(r'\s{2,}', e['title']) or e['title'] != e['title'].strip():
            warns.append({'check': 'F_title_spaces', 'id': e['id'], 'title': e['title']})
        for p in e['persons']:
            if not p['name'] or ',' in p['name'] or len(p['name']) > 60:
                fails.append({'check': 'F_person_name', 'id': e['id'], 'name': p['name']})
            if p['role'].startswith(','):
                fails.append({'check': 'F_person_role', 'id': e['id'], 'role': p['role'][:50]})
            if p['section'] not in ('moderator', 'speaker', 'panelist', 'expert', 'opening', 'host', 'guest'):
                fails.append({'check': 'F_person_section', 'id': e['id'], 'section': p['section']})
        for field in ('title', 'description', 'series'):
            v = e.get(field) or ''
            if 'Выступающие:' in v or 'Модератор:' in v or '\uf0b7' in v:
                fails.append({'check': 'F_artifact', 'id': e['id'], 'field': field})

    report = {
        'events': len(events),
        'pdf_time_slots': sum(pdf_times.values()),
        'pdf_title_runs': sum(pdf_titles.values()),
        'pdf_speaker_bullets': sum(pdf_names.values()),
        'data_persons': sum(js_names.values()),
        'checks': {
            'A_times_match': a_ok,
            'B_titles_match': b_ok,
            'C_speakers_match': c_ok,
            'D_rooms_all_found': not d_missing,
            'E_descriptions_all_found': not e_missing,
        },
        'fails': fails,
        'warns': warns,
    }
    with open(args.report, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    print('events:', len(events), '| pdf slots:', sum(pdf_times.values()),
          '| pdf titles:', sum(pdf_titles.values()), '| pdf speakers:', sum(pdf_names.values()),
          '| data persons:', sum(js_names.values()))
    print('checks:', report['checks'])
    print('FAILS:', len(fails), 'WARNS:', len(warns))
    for f_ in fails[:15]:
        print(' -', json.dumps(f_, ensure_ascii=False)[:300])


if __name__ == '__main__':
    main()
