#!/usr/bin/env python3
"""Validate the three editorial source files and build the 300-post library."""
import json
from pathlib import Path
from collections import Counter
ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'sajupinggye'
CATEGORIES = ['exam']*10 + ['child']*10 + ['crush']*15 + ['reunion']*10 + ['marriage']*10 + ['family']*10 + ['career']*10 + ['wealth']*10 + ['charm']*5 + ['year']*5 + ['naming']*5
LOCALES = ['ko', 'ja', 'en']

def build():
    sources = {}
    for lang in LOCALES:
        rows = json.loads((BASE / 'drafts' / f'{lang}-100.json').read_text())
        assert isinstance(rows,list) and len(rows) == 100, f'{lang}: exactly100 required'
        assert len({row['slides'][0]['title'].strip() for row in rows}) == 100, f'{lang}: duplicate covers'
        for index,row in enumerate(rows):
            prefix=f'{lang} {index+1}'
            assert row['id'] == f'draft-{index+1:03d}', prefix+' id'
            assert row['category'] == CATEGORIES[index], prefix+' category'
            assert row['artwork'] in ['hanji','muk','inyeon'],prefix+' artwork'
            assert isinstance(row['imageBrief'],str) and 10<=len(row['imageBrief'])<=1200,prefix+' image brief'
            assert 0<len(row['label'])<=160 and 0<len(row['topic'])<=100,prefix+' label/topic'
            assert len(row['slides'])==3,prefix+' 3 slides'
            for page,slide in enumerate(row['slides']):
                assert set(slide)=={'eyebrow','title','body','note'},prefix+' slide keys'
                for key,limit in [('eyebrow',180),('title',180),('body',1400),('note',360)]:
                    assert isinstance(slide[key],str) and 0<len(slide[key])<=limit,prefix+f' {page+1}/{key}'
            tags=row['hashtags']
            assert len(tags)==len(set(tags))==4 and all(tag.startswith('#') and len(tag)<=80 and not any(c.isspace() for c in tag) for tag in tags),prefix+' tags'
            assert len(row['caption']+'\n\n'+' '.join(tags))<=2200,prefix+' caption'
        sources[lang]=rows
    campaigns=[]
    for index in range(100):
        ko=sources['ko'][index]
        locales={lang:{key:row[key] for key in ['topic','artwork','label','slides','caption','hashtags','imageBrief']} for lang in LOCALES for row in [sources[lang][index]]}
        campaigns.append({'id':ko['id'],'category':ko['category'],'topic':ko['topic'],'artwork':ko['artwork'],'reviewed':False,'locales':locales})
    brand=json.loads((BASE/'campaigns-v2.json').read_text())['brand']
    output={'version':3,'brand':brand,'campaigns':campaigns}
    target=BASE/'campaigns-300.json'
    target.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print('300 posts / 900 slides / 300 image briefs:',dict(Counter(CATEGORIES)))
    return output

if __name__ == '__main__':build()
