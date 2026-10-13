"""게시 보드 빌드: 스튜디오 HTML의 데이터 + 내려받은 ZIP 이미지 → data.json + img/<언어>/NNN.jpg

사용:  python3 build.py [스튜디오.html] [ZIP 폴더]
기본값: ~/Downloads/content_studio.html, ~/Downloads
ZIP 이름: selfsuggestion_<언어>_feed_200.zip (스튜디오의 '이 언어 200개 한꺼번에 받기'로 만든 파일)
한국어 ZIP(selfsuggestion_ko_feed_200.zip)이 있으면 한국어 이미지·수정 문구도 함께 들어간다.
"""
import io, json, os, re, sys, zipfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
studio = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Downloads/content_studio.html')
zdir = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/Downloads')

s = open(studio, encoding='utf-8').read()
d = json.loads(re.search(r'<script id="dbdata" type="application/json">(.*?)</script>', s, re.S).group(1).replace('<\\/', '</'))
acc = {a['lang']: a for a in d['accounts']}

def parse_captions(txt):
    """ZIP 안 captions_<언어>.txt → {post_id: 이미지에 들어간 문구(수정본)}"""
    out = {}
    for block in txt.split('------------------------------'):
        m = re.search(r'\[(\d{3})\] (P\d{3}-[A-Z]{2})[^\n]*\n(.*?)\n\n▼ 캡션', block, re.S)
        if m:
            out[m.group(2)] = re.sub(r'\n— .*$', '', m.group(3).strip())
    return out

# 스튜디오 설정 백업(backup/*.json)에 있는 게시물별 문구·말한 사람 수정 반영 (가장 최근 백업)
import glob
over = {}
bks = sorted(glob.glob(os.path.join(HERE, 'backup', 'selfsuggestion_studio_backup_*.json')))
if bks:
    ls = json.load(open(bks[-1], encoding='utf-8'))['localStorage']
    over = json.loads(ls.get('ss_postset_v1', '{}'))
    print('backup:', os.path.basename(bks[-1]), len(over), 'posts with settings')

langs = {}
for l in ('ko', 'ja', 'en'):
    zp = os.path.join(zdir, f'selfsuggestion_{l}_feed_200.zip')
    has_img = os.path.exists(zp)
    edited = {}
    if has_img:
        os.makedirs(os.path.join(HERE, 'img', l), exist_ok=True); os.makedirs(os.path.join(HERE, 'thumb', l), exist_ok=True)
        with zipfile.ZipFile(zp) as z:
            for n in z.namelist():
                if n.endswith('.jpg'):
                    num = n[:3]
                    im = Image.open(io.BytesIO(z.read(n))).convert('RGB')
                    im.save(os.path.join(HERE, 'img', l, f'{num}.jpg'), 'JPEG', quality=86, optimize=True, progressive=True)
                    im.resize((540, round(540 * im.height / im.width)), Image.LANCZOS).save(os.path.join(HERE, 'thumb', l, f'{num}.jpg'), 'JPEG', quality=76, optimize=True, progressive=True)
                elif n.startswith('captions_'):
                    edited = parse_captions(z.read(n).decode('utf-8'))
    posts = []
    for p in [x for x in d['posts'] if x['language'] == l]:
        n = p['post_id'][1:4]
        o = over.get(p['post_id'], {})
        posts.append({'id': p['post_id'], 'n': n, 'text': o.get('text', edited.get(p['post_id'], p['text'])), 'author': o.get('author', p['author']),
                      'caption': p['caption'], 'tags': p['hashtags'], 'img': f'img/{l}/{n}.jpg' if has_img else '', 'thumb': f'thumb/{l}/{n}.jpg' if has_img else ''})
    a = acc[l]
    langs[l] = {'handle': a['account_id_candidate'], 'name': a['display_name'], 'hasImages': has_img, 'posts': posts}
    print(l, 'images' if has_img else 'no images', len(posts))

json.dump({'langs': langs}, open(os.path.join(HERE, 'data.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('data.json written')
