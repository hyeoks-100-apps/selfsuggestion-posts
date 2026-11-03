# 자기암시 게시 보드 (selfsuggestion-posts)

휴대폰에서 인스타 계정별(🇰🇷 @affirmation.daily.kr · 🇯🇵 @affirmation.daily.jp · 🇺🇸 @selfsuggestion_official) 게시물을
하나씩 **이미지 저장 → 캡션+태그 복사 → 올림 체크** 하기 위한 정적 페이지. GitHub Pages로 배포.

- 원본 데이터: 콘텐츠 스튜디오(`content_studio.html`, 로컬 툴)의 문구·캡션·태그
- 이미지: 스튜디오의 "이 언어 200개 한꺼번에 받기" ZIP (`selfsuggestion_<언어>_feed_200.zip`)
- 다시 만들기: `python3 build.py [스튜디오.html] [ZIP 폴더]` → `data.json`, `img/`, `thumb/` 갱신 후 커밋·푸시
- 올림 체크는 각 기기 브라우저(localStorage)에 저장. 페이지 맨 아래 "체크 기록 복사/붙여넣기"로 기기 간 옮김.
- `backup/`: 스튜디오 설정 백업 JSON (게시물별 스타일·위치·문구 수정 등). 스튜디오의 "백업 불러오기"로 복원.

## 사주핑계 제작·레퍼런스

기존 GitHub Pages의 [`/sajupinggye/`](https://hyeoks-100-apps.github.io/selfsuggestion-posts/sajupinggye/)에서 한국어·일본어·영어 캐러셀을 편집하고 PNG·ZIP·캡션으로 내보낸다. 기존 자기암시 데이터·이미지·체크 기록은 그대로 쓴다.

- `sajupinggye/campaigns-v2.json`: 11개 분야(수능·시험, 자녀·진로, 썸, 재회, 결혼, 가족, 직장, 재물, 매력·인복, 신년, 작명) × 각3기획 × 3언어 × 3장 = 297장 초안. `reviewed: false`이며 사용자가 검토 후 게시한다.
- 새 형식은 **짧고 큰 제목과 이미지 → 사주 개념으로 읽는 해설 → 사주핑계 소개** 3장이다. `campaigns.json`의 기존6개·5장 원고와 개인 편집본은 ‘이전5장 원고’ 분류로 보존한다.
- 주제 필터, 세 언어 전환, 기획 복제, 3개 템플릿, 3개 원본 수묵화 선택을 지원한다. 피드1080×1350·스토리1080×1920 정지 이미지이며 ZIP은 선택한 기획·언어의 PNG들과 caption.txt·metadata.json을 담는다.
- 편집·복제·수동 게시 체크는 이 브라우저의 `spg_ig_studio_v2`에만 저장한다. v1 저장본은 원문을 남긴 채 읽어와 새 저장소로 옮기며, v1/v2 JSON 백업 모두 불러올 수 있다. 기기를 옮길 때는 JSON 백업을 내려받는다. 예전5장 편집본을3장으로 임의 축약하지 않는다.
- `sajupinggye/references.json`: 실제 Instagram 게시물12건과 매거진·서비스 디자인6건의 관찰·출처·적용 원칙. 경쟁사 이미지·원문은 포함하지 않는다.
- 무료 유입 목적지는 `https://saju.teamhyeok.com/`, 한국 이름 추천은 `/naming`이다. 스토어 링크가 준비되기 전에는 프로필 링크의 웹·앱 안내로 연결한다. 부모·시험·취업 전용 개인 리포트 등 제공하지 않는 기능을 광고하지 않는다.
- 실제 게시 관리 서비스는 [insta.teamhyeok.com](https://insta.teamhyeok.com/#/)이며 정본은 private `hyeoks-100-apps/insta-board`다. 천안 Windows PC의 Docker로 운영한다. 이 Pages 저장소는 제작 원본과 예비 게시 보드다. PNG·캡션을 내려받아 실제 게시 보드의 새 게시물에 등록할 수 있다. 자동 게시·예약·DM은 제공하지 않는다.
- `renderer.js`: 같은 출처의 이미지와 폰트를 준비한 후 Canvas로 출력한다. 아트워크는 기본 제공 ImageGen으로 만든 원본이며 `assets/artwork-prompts.json`에 프롬프트를 보관한다. 앱 로고·아이콘은 사주핑계 원본 자산이다. 폰트 출처·라이선스는 `assets/fonts/`에 있다. 임의의 한글·가나·한자를 편집할 수 있도록 full-CJK 폰트를 포함하며 첫 로드 폰트는 약33MiB다.
- 저장·백업 호환 검증: `node --test tests/studio-state.test.cjs`. JavaScript 문법은 `node --check sajupinggye/studio.js`와 `node --check sajupinggye/renderer.js`로 확인한다.

로컬 확인: `python3 -m http.server 4760 --bind 127.0.0.1` 실행 후 `http://127.0.0.1:4760/sajupinggye/`에 접속한다.

이전5장 디자인 검증(2026-11-03): 실제 브라우저에서 긴 원고 2개 × 3언어 × 3템플릿의 피드 ZIP 18개(PNG 90장), 3언어 스토리 ZIP 3개(PNG 15장)의 저장·CRC·크기·원문 일치를 확인했다. 390px 프레임의 배치, 원고 넘침 시 내보내기 차단, JSON 백업 복원도 확인했다. 임의의 한글·가나·한자를 편집할 수 있도록 full-CJK 폰트를 포함하며 첫 로드 폰트 합계는 약33MiB다.

3장 개편 검증(2026-11-03): 33기획×3언어×3템플릿의 표지297개를 실제 브라우저에서 확인하고, 기본 아트워크 조합의99개 ZIP(PNG297장)의 CRC·1080×1350 크기·원고·UTF-8 캡션·메타데이터를 대조했다. 3언어 스토리3장 출력, 이전5장 출력과 v1/v2 백업 복원, 390px 화면, 긴 원고의 출력 차단도 확인했다.
