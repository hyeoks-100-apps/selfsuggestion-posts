#!/usr/bin/env python3
"""Validate observed web-image sources and connect them to all 300 drafts."""
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'sajupinggye'
SOURCES = {'family': set(range(1, 21)) | set(range(56, 66)),
           'romance': set(range(21, 56)), 'life': set(range(66, 101))}
LOCALES = ('ko', 'ja', 'en')


def text(value, limit=2400):
    return isinstance(value, str) and 0 < len(value) <= limit and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', value)


def url(value, image=False):
    assert text(value, 12000), 'Missing or oversized URL'
    parsed = urlsplit(value)
    assert parsed.scheme in (('https',) if image else ('https', 'http')) and parsed.hostname and not parsed.username and not parsed.password, f'Unsafe URL: {value}'
    assert not re.search(r'(^|\.)((google|bing)\.[^/]+|pinterest\.com)$', parsed.hostname), f'Use the image detail/source page: {value}'
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, parsed.query, ''))


def build():
    catalog = json.loads((BASE / 'campaigns-300.json').read_text())['campaigns']
    campaigns = {c['id']: c for c in catalog}
    assert len(campaigns) == 100
    references, assignments, aliases, seen_images = [], [], {}, {}
    all_ids, pairs = set(), set()
    for name, numbers in SOURCES.items():
        source = json.loads((BASE / 'visual-research' / f'{name}.json').read_text())
        assert set(source) == {'references', 'assignments'}, name + ': source keys'
        assert isinstance(source['references'], list) and len(source['references']) >= 20, name + ': reference selection'
        local_ids = set()
        for ref in source['references']:
            rid = ref['id']
            assert re.fullmatch(r'[a-z][a-z0-9-]{1,79}', rid) and rid not in all_ids, f'Duplicate ID: {rid}'
            all_ids.add(rid)
            local_ids.add(rid)
            assert text(ref['title'], 240) and text(ref['creator'], 500), rid + ': title/credit'
            url(ref['sourceUrl'])
            canonical = url(ref['imageUrl'], image=True)
            if 'thumbnailUrl' in ref:
                url(ref['thumbnailUrl'], image=True)
            assert ref['kind'] in ('photo', 'film', 'illustration'), rid + ': kind'
            assert isinstance(ref['moods'], list) and 0 < len(ref['moods']) <= 20 and all(text(m, 80) for m in ref['moods']), rid + ': moods'
            assert text(ref['whatToBorrow']), rid + ': redraw note'
            assert re.fullmatch(r'\d{4}-\d{2}-\d{2}', ref['checkedAt']), rid + ': date'
            # Only exact observed image URLs are deduplicated. Never invent CDN variants.
            aliases[rid] = seen_images.get(canonical, rid)
            if canonical not in seen_images:
                seen_images[canonical] = rid
                references.append(ref)
        expected = {(f'draft-{n:03d}', lang) for n in numbers for lang in LOCALES}
        actual = set()
        for item in source['assignments']:
            pair = (item['campaignId'], item['locale'])
            assert pair in expected and pair not in pairs, f'{name}: unexpected/duplicate assignment {pair}'
            actual.add(pair)
            pairs.add(pair)
            ids = item['referenceIds']
            assert isinstance(ids, list) and 1 <= len(ids) <= 3 and len(set(ids)) == len(ids) and set(ids) <= local_ids, f'{pair}: reference IDs'
            assert text(item['reason']) and text(item['redrawDirection']), f'{pair}: missing direction'
            draft = campaigns[pair[0]]
            locale = draft['locales'][pair[1]]
            assignments.append({**item, 'referenceIds': list(dict.fromkeys(aliases[rid] for rid in ids)),
                                'category': draft['category'], 'title': locale['label'],
                                'topic': locale['topic'], 'imageBrief': locale['imageBrief']})
        assert actual == expected, f'{name}: missing assignments {expected - actual}'
    assert len(pairs) == 300 and Counter(a['locale'] for a in assignments) == Counter(dict.fromkeys(LOCALES, 100))
    assert len(references) >= 60, 'Expected a varied real-image selection'
    used = {rid for item in assignments for rid in item['referenceIds']}
    assert used == {ref['id'] for ref in references}, f'Unassigned references: {set(ref["id"] for ref in references) - used}'
    assignments.sort(key=lambda item: (item['campaignId'], LOCALES.index(item['locale'])))
    output = {'version': 1, 'checkedAt': max(r['checkedAt'] for r in references),
              'references': references, 'assignments': assignments}
    target = BASE / 'visual-references.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(references)} observed images / {len(assignments)} draft assignments / ' +
          ', '.join(f'{kind}: {n}' for kind, n in Counter(r['kind'] for r in references).items()))
    return output


if __name__ == '__main__':
    build()
