# -*- coding: utf-8 -*-
"""
Парсер официальной деловой программы VI Конгресса молодых ученых (PDF)
в структурированные данные для статического сайта (data.js).

Запуск:
    python tools/parse_program.py <путь к PDF> [--out data.js]

Требуется: pypdf  (pip install pypdf)

Разметка PDF (двухколоночная):
  левая колонка  x~90  : время (Arial-Bold 9), зал (Arial 8)
  правая колонка x~190 : трек (Arial 8), название (Arial-Bold 9),
                       описание (Arial 8), секции спикеров (Arial-Bold 8 + маркеры)
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone

from pypdf import PdfReader

LEFT_MAX_X = 150.0
TIME_RE = re.compile(r'^(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})')
DATE_RE = re.compile(r'^(\d{1,2})\s+декабря\s+2026$')

KNOWN_TRACKS = {
    'Платформа развития: люди, среда, инструменты',
    'Большие вызовы научно-технологического развития',
    'Наука без границ: идеи, открытия, решения',
    'Инициативы Десятилетия науки и технологий',
    'Школа РНФ',
    'Координационный совет «Алгоритмы научной политики»',
}

FORMAT_WORDS = {
    'Лекция', 'Практическая сессия', 'Питч-сессия', 'Деловая игра',
    'Креативная мастерская', 'Мастер-класс', 'Круглый стол', 'Панельная дискуссия',
    'Стратегическая сессия', 'Форсайт-сессия', 'Ток-шоу', 'Научный бой',
    'Открытый микрофон', 'Презентация', 'Церемония', 'Экскурсия', 'Выставка',
    'Кинолекторий', 'Интеллектуальная игра', 'Дискуссия', 'Митап', 'Воркшоп',
    'Хакатон', 'Конкурс', 'Премия', 'Концерт', 'Спектакль', 'Перформанс',
    'Научный стендап', 'Открытая редакция', 'Сессия', 'Встреча',
    'Пленарное заседание', 'Церемония открытия', 'Церемония награждения',
}

KNOWN_SERIES = {
    'Траектория успеха: программа лауреатов научных премий',
    'Программа Координационного совета: от смелых идей к ответственным решениям',
    'Диалог с фондами',
    'Открытый диалог с первыми лицами',
    'Наукометрия стран БРИКС',
    'Креативная мастерская РНФ+ИРИ',
    'Серия мероприятий Координационного совета «Алгоритмы научной политики»',
}

SECTION_MAP = {
    'Модератор:': 'moderator',
    'Модераторы:': 'moderator',
    'Выступающий:': 'speaker',
    'Выступающие:': 'speaker',
    'Участник дискуссии:': 'panelist',
    'Участники дискуссии:': 'panelist',
    'Эксперты:': 'expert',
    'Приветственное слово:': 'opening',
    'Вступительное слово:': 'opening',
    'Ведущий:': 'host',
    'Гость:': 'guest',
}

SECTION_LABELS = {
    'moderator': 'Модератор',
    'speaker': 'Выступающие',
    'panelist': 'Участники дискуссии',
    'expert': 'Эксперты',
    'opening': 'Приветственное слово',
    'host': 'Ведущий',
    'guest': 'Гость',
}

# Тематические домены: ключевые слова (нижний регистр) -> метка.
DOMAIN_RULES = [
    ('Медицина и здоровье', [
        'медицин', 'клиник', 'пациент', 'здравоохран', 'здоровь', 'долголет',
        'онколог', 'иммун', 'вакцин', 'фарм', 'лекарств', 'терапевт', 'биомедицин',
        'мозг', 'когнитив', 'психолог', 'реабилитац', 'бактериофаг', 'мрнк',
        'геном', 'редактирование генома', 'исцелен', 'болезн', 'диагност',
        'врач', 'хирург', 'трансплант', 'кардио', 'нейро', 'эпидем',
    ]),
    ('Биотехнологии и науки о жизни', [
        'биотех', 'биофабрик', 'генетик', 'биоразнообраз', 'биоресурс', 'микроби',
        'клетк', 'молекулярн', 'биолог', 'биоинформ', 'синтетическ биолог',
        'протеин', 'белок', 'фермент', 'микробиом', 'биоэконом', 'живой систем',
        'фронтиры биологии', 'иммунитет',
    ]),
    ('Искусственный интеллект и данные', [
        'искусственн интеллект', ' ии ', 'ии-', 'ии,', 'ии:', 'нейросет',
        'машинн обуч', 'больших данных', 'большие данные', 'big data',
        'нейроморф', 'алгоритм', 'доверенный ии', 'генеративн', 'llm',
        'цифровизац', 'дата-', 'data-', 'интеллектуальн анализ',
    ]),
    ('Физика и мегасайенс', [
        'физик', 'квант', 'синхротрон', 'мегасайенс', 'мегакласс', 'меганаук',
        'скиф', 'сила», «', 'nica', 'ускорител', 'элементарн частиц', 'плазм',
        'термояд', 'лазер', 'фотон', 'ядерн физик', 'теоретическ физик',
        'шредингер', 'установк класса', 'коллективного пользования', 'пик',
    ]),
    ('Атомная энергетика', [
        'атом', 'аэс', 'реактор', 'росатом', 'ввэр', 'ядерн технолог',
        'ядерн энергет', 'энергия атома', 'облучен', 'радиац',
    ]),
    ('Химия и новые материалы', [
        'хим', 'материал', 'катализ', 'полимер', 'композит', 'аддитивн',
        'менделеев', 'молекул', 'микрофлюид', 'малотоннажн', 'веществ',
        'сплав', 'кристалл', 'наноматериал', 'графен', 'композитн',
    ]),
    ('Математика', [
        'математик', 'теорем', 'алгебр', 'тополог', 'уравнен', 'геометр',
        'комбинатор', 'вероятност', 'статистик', 'оптимизац', 'вычислен',
        'математическ модел',
    ]),
    ('Космос и авиастроение', [
        'косм', 'орбит', 'спутник', 'ракет', 'авиа', 'самолет', 'двигателестро',
        'беспилот', 'авионик', 'аэрокосм', 'космонавт', 'луна', 'марс',
        'воздушн суд', 'вертолет',
    ]),
    ('Экология, климат и океан', [
        'эколог', 'климат', 'природ', 'морск', 'океан', 'арктик', 'антарктик',
        'углерод', 'дикой природ', 'заповед', 'биосфер', 'экосистем', 'мусор',
        'отход', 'возобновляем энерг', 'зелен', 'устойчив развит', 'мерзлот',
    ]),
    ('Науки о Земле', [
        'геол', 'географ', 'почв', 'сейсм', 'недра', 'полезн ископаем',
        'геофиз', 'вулкан', 'ледник', 'земн кор', 'геодез', 'картограф',
        'палеонтол', 'минерал',
    ]),
    ('Инженерия и промышленность', [
        'инженер', 'промышлен', 'производ', 'станко', 'робот', 'транспорт',
        'завод', 'фабрик', 'ниокр', 'опытно-конструктор', 'машиностро',
        'приборостро', 'микроэлектрон', 'полупроводник', 'станк', 'аддитивн технолог',
        'промышлен дизайн', 'технологическ суверенитет', 'оборон', 'опк',
        'бпла', 'автономн транспорт', 'энергетик', 'сетев инфраструктур',
    ]),
    ('Образование и кадры', [
        'образован', 'университет', 'вуз', 'школ', 'аспирант', 'преподават',
        'студент', 'сно', 'кадр', 'наставник', 'педагог', 'обучен', 'просвещен',
        'дополнительн образован', 'молодежн лаборатор', 'научн карьер',
        'подготовк кадр', 'талант', 'ординатур', 'диссертац', 'учен степен',
    ]),
    ('Гуманитарные и социальные науки', [
        'гуманитар', 'социальн', 'обществ', 'культур', 'истор', 'философ',
        'этик', 'язык', 'литератур', 'искусств', 'медиа', 'журналист',
        'юриспруденц', 'правов', 'эконом', 'социогуманитар', 'наслед', 'муз',
        'туризм', 'семь', 'детств', 'социолог', 'политолог', 'лингвист',
        'религ', 'ценност', 'смысл', 'идентичност', 'демограф', 'миграц',
        'город', 'урбан', 'креативн индустри',
    ]),
    ('Популяризация науки и медиа', [
        'популяризац', 'научпоп', 'научно-популярн', 'блогер', 'контент',
        'научн коммуникац', 'фестивал', 'выставк', 'кино', 'сериал', 'подкаст',
        'youtube', 'соцсет', 'сми', 'популяризатор', 'научн туризм', 'музей',
        'научн мелод', 'впечатлен', 'зрител', 'сторителлинг',
    ]),
    ('Управление наукой и научная политика', [
        'грант', 'рнф', 'фонд', 'финансирован', 'госзадан', 'наукометр',
        'брикс', 'научн дипломат', 'координационн совет', 'научн политик',
        'оценк результатив', 'репозитар', 'науковед', 'управлен наукой',
        'научн инфраструктур', 'открытая наука', 'интеллектуальн капитал',
        'целевой капитал', 'эндаумент', 'коммерциализац', 'трансфер технолог',
        'акселератор', 'венчур', 'инвестор', 'стартап', 'питч', 'грантов',
        'министерств', 'правительств', 'государствен программ', 'законодательн',
        'нацпроект', 'стратегия научн', 'десятилетие науки',
    ]),
    ('Международное сотрудничество', [
        'вьетнам', 'индия', 'китай', 'латинск америк', 'центральн ази',
        'глобальн юг', 'международн', 'британ', 'африк', 'ближн восток',
        'сотрудничеств', 'партнерств', 'юнеско', 'стран-партнер', 'зарубеж',
        'иностран', 'мексик', 'индонез', 'казахстан', 'узбекистан', 'беларус',
        'соотечествен', 'диалог культур',
    ]),
]


def norm_space(s):
    return re.sub(r'\s+', ' ', s).strip()


def collect_lines(page):
    """Возвращает строки страницы, разделённые по колонкам."""
    frags = []

    def visitor(text, cm, tm, font_dict, font_size):
        if not text.strip():
            return
        bf = ''
        try:
            bf = str(font_dict.get('/BaseFont', '')) if font_dict else ''
        except Exception:
            pass
        frags.append({
            'x': round(tm[4], 1), 'y': round(tm[5], 1),
            'fs': round(font_size, 1),
            'bold': 'Bold' in bf, 'sym': 'OpenSymbol' in bf,
            'text': text,
        })

    page.extract_text(visitor_text=visitor)

    def group(items):
        items = sorted(items, key=lambda f: (-f['y'], f['x']))
        lines = []
        cur = None
        for f in items:
            if cur is None or abs(f['y'] - cur['y']) > 2.5:
                cur = {'y': f['y'], 'frags': []}
                lines.append(cur)
            cur['frags'].append(f)
        for ln in lines:
            ln['frags'].sort(key=lambda f: f['x'])
            ln['text'] = norm_space(''.join(f['text'] for f in ln['frags']))
            ln['x'] = ln['frags'][0]['x']
            ln['fs'] = ln['frags'][0]['fs']
            ln['bold'] = ln['frags'][0]['bold']
            ln['sym'] = any(f['sym'] for f in ln['frags'])
        return lines

    left = group([f for f in frags if f['x'] < LEFT_MAX_X])
    right = group([f for f in frags if f['x'] >= LEFT_MAX_X])
    # убираем колонтитулы
    right = [ln for ln in right
             if not (ln['x'] > 400 and ln['text'] == 'Деловая программа')
             and not (ln['x'] > 500 and re.fullmatch(r'\d{1,2}', ln['text']))]
    return left, right


def tag_domains(text):
    t = ' ' + text.lower().replace('ё', 'е') + ' '
    found = []
    for label, kws in DOMAIN_RULES:
        for kw in kws:
            if kw in t:
                found.append(label)
                break
    return found


def parse(pdf_path):
    reader = PdfReader(pdf_path)
    events = []
    anomalies = []
    track_stats = {}

    # --- проход 1: левая колонка -> скелеты событий; правая -> общий поток ---
    stream = []
    cur_date = None
    cur_ev = None
    for pi, page in enumerate(reader.pages):
        left, right = collect_lines(page)
        for ln in sorted(left, key=lambda l: -l['y']):
            t = ln['text']
            m = DATE_RE.match(t)
            if m:
                cur_date = f"2026-12-{int(m.group(1)):02d}"
                cur_ev = None
                continue
            if ln['bold'] and ln['fs'] == 9.0:
                m = TIME_RE.match(t)
                if m:
                    if cur_date is None:
                        anomalies.append(f"time before date on page {pi+1}: {t}")
                        cur_date = '2026-12-02'
                    cur_ev = {
                        'id': f"{cur_date}-{m.group(1).replace(':', '')}-{len(events)+1:03d}",
                        'date': cur_date,
                        'start': m.group(1).zfill(5),
                        'end': m.group(2).zfill(5),
                        'track': None, 'format': None,
                        'persons': [], '_venue': [],
                    }
                    events.append(cur_ev)
                    continue
                anomalies.append(f"odd bold9 left line p{pi+1}: {t}")
            elif ln['fs'] == 8.0 and cur_ev is not None:
                cur_ev['_venue'].append(t)
        prev_y = None
        for ln in sorted(right, key=lambda l: -l['y']):
            gap = None if prev_y is None else prev_y - ln['y']
            stream.append({'pi': pi, 'ln': ln, 'gap': gap})
            prev_y = ln['y']

    # --- сегментация правого потока на блоки мероприятий ---
    def is_plain_track_line(ln):
        return (not ln['bold']) and (not ln['sym']) and ln['fs'] == 8.0 and ln['x'] < 215

    starts = [0]
    for i in range(1, len(stream)):
        item = stream[i]
        ln = item['ln']
        # блок может начинаться сразу с заголовка (без строки трека)
        if ln['bold'] and ln['fs'] == 9.0:
            if item['gap'] is not None:
                if item['gap'] >= 25:
                    starts.append(i)
            else:
                prev = stream[i - 1]['ln']
                prev_title = prev['bold'] and prev['fs'] == 9.0
                prev_track = is_plain_track_line(prev) and (
                    prev['text'] in KNOWN_TRACKS or prev['text'] in FORMAT_WORDS
                    or prev['text'] in KNOWN_SERIES
                    or (len(prev['text']) < 90 and prev['text'][-1] not in '.?!:'))
                if not (prev_title or prev_track):
                    starts.append(i)
            continue
        if not is_plain_track_line(ln):
            continue
        if item['gap'] is not None:
            if item['gap'] >= 25:
                starts.append(i)
            continue
        # первая строка страницы: смотрим вперёд — есть ли заголовок (bold 9)
        j = i + 1
        ok = False
        while j < len(stream) and j - i <= 4:
            l2 = stream[j]['ln']
            if l2['bold'] and l2['fs'] == 9.0:
                ok = True
                break
            if l2['bold'] or l2['sym'] or l2['x'] >= 215:
                break
            j += 1
        if ok:
            starts.append(i)

    blocks = []
    for k, s in enumerate(starts):
        e = starts[k + 1] if k + 1 < len(starts) else len(stream)
        blocks.append([it['ln'] for it in stream[s:e]])

    # постобработка: блоки без заголовка — примечания к предыдущему блоку
    merged = []
    for b in blocks:
        has_title = any(ln['bold'] and ln['fs'] == 9.0 for ln in b)
        if not has_title and merged:
            merged[-1].extend(b)
            continue
        if (len(b) > 1 and is_plain_track_line(b[0]) and is_plain_track_line(b[1])
                and b[0]['text'] not in KNOWN_TRACKS and b[0]['text'] not in FORMAT_WORDS
                and (b[1]['text'] in KNOWN_TRACKS or b[1]['text'] in FORMAT_WORDS)
                and merged):
            merged[-1].append(b[0])
            b = b[1:]
        merged.append(b)
    blocks = merged

    if len(blocks) != len(events):
        anomalies.append(f"BLOCK COUNT MISMATCH: blocks={len(blocks)} events={len(events)}")
        for i, b in enumerate(blocks):
            anomalies.append(f"block {i}: {b[0]['text'][:70]}")

    # --- проход 2: разбор каждого блока ---
    for idx, ev in enumerate(events):
        blines = blocks[idx] if idx < len(blocks) else []
        phase = 'track'
        section = None
        person = None
        series_lines = []
        title_lines = []
        desc_parts = []
        last_desc_y = None
        venue_lines = ev['_venue']

        def flush_person():
            nonlocal person
            if person is not None:
                name = norm_space(person['name'])
                role = norm_space(person['role']).lstrip(',').strip()
                if name:
                    ev['persons'].append({'name': name, 'role': role, 'section': person['section']})
                else:
                    anomalies.append(f"person without name: {person}")
                person = None

        for ln in blines:
            t = ln['text']
            y = ln['y']
            if not t:
                continue
            if phase == 'track':
                if ln['bold'] and ln['fs'] == 9.0:
                    title_lines.append(t)
                    phase = 'title'
                else:
                    if t in KNOWN_TRACKS:
                        ev['track'] = t
                    elif t in FORMAT_WORDS:
                        ev['format'] = t
                    else:
                        series_lines.append(t)
                    track_stats[t] = track_stats.get(t, 0) + 1
                    phase = 'series'
                continue
            if phase == 'series':
                if ln['bold'] and ln['fs'] == 9.0:
                    title_lines.append(t)
                    phase = 'title'
                elif ln['bold'] and ln['fs'] == 8.0 and t in SECTION_MAP:
                    flush_person()
                    section = SECTION_MAP[t]
                    phase = 'speakers'
                elif ln['bold'] and ln['fs'] == 8.0 and t.endswith(':'):
                    desc_parts.append(t)
                    phase = 'desc'
                    last_desc_y = y
                elif t in FORMAT_WORDS:
                    ev['format'] = t
                else:
                    series_lines.append(t)
                continue
            if phase == 'title':
                if ln['bold'] and ln['fs'] == 9.0:
                    title_lines.append(t)
                elif ln['bold'] and ln['fs'] == 8.0 and t in SECTION_MAP:
                    section = SECTION_MAP[t]
                    phase = 'speakers'
                elif ln['bold'] and ln['fs'] == 8.0 and t.endswith(':'):
                    desc_parts.append(t)
                    phase = 'desc'
                    last_desc_y = y
                else:
                    if last_desc_y is not None and y < last_desc_y - 13:
                        desc_parts.append('\n')
                    desc_parts.append(t)
                    last_desc_y = y
                    phase = 'desc'
                continue
            if phase == 'desc':
                if ln['bold'] and ln['fs'] == 9.0:
                    anomalies.append(f"bold9 in desc: {ev['id']} {t[:60]}")
                    title_lines.append(t)
                    phase = 'title'
                elif ln['bold'] and ln['fs'] == 8.0 and t in SECTION_MAP:
                    section = SECTION_MAP[t]
                    phase = 'speakers'
                elif ln['bold'] and ln['fs'] == 8.0 and t.endswith(':'):
                    desc_parts.append('\n' + t)
                    last_desc_y = y
                else:
                    if ln['sym'] and ln['x'] < 215:
                        desc_parts.append('\n• ' + t)
                    else:
                        if last_desc_y is not None and y < last_desc_y - 13:
                            desc_parts.append('\n')
                        desc_parts.append(t)
                    last_desc_y = y
                continue
            if phase == 'speakers':
                if ln['bold'] and ln['fs'] == 8.0 and t in SECTION_MAP and ln['x'] < 215:
                    flush_person()
                    section = SECTION_MAP[t]
                    continue
                if ln['sym']:
                    flush_person()
                    name = ''.join(f['text'] for f in ln['frags'] if f['bold'])
                    role = ''.join(f['text'] for f in ln['frags'] if not f['bold'] and not f['sym'])
                    person = {'name': name, 'role': role, 'section': section or 'speaker'}
                    continue
                if ln['x'] >= 215 and person is not None:
                    person['role'] += ' ' + t
                    continue
                if ln['bold'] and ln['fs'] == 8.0 and t.endswith(':'):
                    flush_person()
                    desc_parts.append('\n' + t)
                    phase = 'desc'
                    last_desc_y = y
                    continue
                flush_person()
                desc_parts.append('\n' + t)
                phase = 'desc'
                last_desc_y = y
                continue

        flush_person()
        ev['title'] = norm_space(' '.join(title_lines))
        ev['series'] = norm_space(' '.join(series_lines))
        ev['description'] = norm_space(' '.join(desc_parts))
        room = norm_space(' '.join(venue_lines))
        if room.lower().startswith('конгресс-центр'):
            parts = room.split(' ', 1)
            ev['building'] = 'конгресс-центр'
            ev['room'] = parts[1] if len(parts) > 1 else ''
        else:
            ev['building'] = ''
            ev['room'] = room
        ev['venue'] = norm_space(', '.join(x for x in [ev['building'], ev['room']] if x))
        if not ev['title']:
            anomalies.append(f"event without title: {ev['date']} {ev['start']} venue={ev['venue']}")
        if not ev['track'] and not ev['format'] and not ev['series']:
            anomalies.append(f"event without track/format/series: {ev['title'][:60]}")
        text = ' '.join([ev['title'], ev['series'], ev['description'], ev['track'] or ''])
        ev['domains'] = tag_domains(text)
        del ev['_venue']

    meta = {
        'title': 'VI Конгресс молодых ученых',
        'subtitle': 'Деловая программа',
        'city': 'Санкт-Петербург',
        'venue': 'КВЦ «Экспофорум»',
        'dates': sorted({e['date'] for e in events}),
        'timezone': 'Europe/Moscow',
        'source': {
            'file': pdf_path.replace('\\', '/').split('/')[-1],
            'asOf': '2026-11-26',
            'url': 'https://science-congress.com/',
        },
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'eventCount': len(events),
    }
    return meta, events, anomalies, track_stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--out', default='data.js')
    ap.add_argument('--stats', default='_research/parse_stats.json')
    args = ap.parse_args()

    meta, events, anomalies, track_stats = parse(args.pdf)

    payload = {'meta': meta, 'events': events}
    with open(args.out, 'w', encoding='utf-8') as f:
        f.write('// Сгенерировано tools/parse_program.py из официальной деловой программы КМУ-2026.\n')
        f.write('// Не редактируйте вручную: правьте парсер и перезапускайте.\n')
        f.write('window.PROGRAM_DATA = ')
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')

    stats = {
        'events': len(events),
        'by_date': {d: sum(1 for e in events if e['date'] == d) for d in meta['dates']},
        'tracks': track_stats,
        'anomalies': anomalies,
        'no_persons': [e['id'] + ' ' + e['title'][:50] for e in events if not e['persons']],
        'no_domains': [e['id'] + ' ' + e['title'][:50] for e in events if not e['domains']],
        'sample': events[:2],
    }
    try:
        with open(args.stats, 'w', encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=1)
    except OSError:
        pass
    print(f"events={len(events)} anomalies={len(anomalies)} -> {args.out}")
    for d in meta['dates']:
        print(d, sum(1 for e in events if e['date'] == d))


if __name__ == '__main__':
    main()
