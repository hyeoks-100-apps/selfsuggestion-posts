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

- `sajupinggye/campaigns.json`: 짝사랑·궁합·연락·재회·오행·오늘의 핑계 6기획 × 3언어 × 5장 초안. `reviewed: false`이며 사용자가 검토 후 게시한다. 기존 원고를 자동으로 번역하거나 새 운세를 생성하는 기능은 없다.
- `sajupinggye/references.json`: 2026-11-03 확인한 한국·일본·영어권 실제 Instagram 게시물 12건. 관찰·CTA·확인 수준·적용 제안을 구분하며 경쟁사 이미지·원문은 포함하지 않는다. 게시물과 계정 상태는 바뀔 수 있다.
- 미리보기는 한지·먹빛·인연 템플릿, 1080×1350 피드·1080×1920 스토리 **정지 이미지**다. ZIP은 선택한 언어의 5장 PNG와 캡션·메타데이터를 담는다. 동영상 제작·Instagram 자동 게시·예약·DM 전송은 제공하지 않는다.
- 편집본·복제본·수동 게시 체크는 해당 브라우저의 별도 `spg_ig_studio_v1`에 저장된다. 기기를 옮기기 전에 JSON 백업을 내려받고 다른 브라우저에서 불러온다. GitHub Pages에 편집본이 자동 업로드되지는 않는다.
- 무료 유입 목적지는 `https://saju.teamhyeok.com/`이다. Instagram 프로필 링크는 실제 계정에서 별도로 설정한다. 영어·일본어 게시 원고는 웹·앱 전체 화면의 현지화 완료를 뜻하지 않는다.
- 이 저장소의 확인된 운영 방식은 GitHub Pages다. 천안 서버에서 자기암시 제작기를 운영한다는 근거는 확인되지 않았다. 현재 공개된 과거 제작기 사본은 `backup/content_studio.html`이며, 사주핑계 기능은 그 백업을 수정하지 않고 추가했다.

로컬 확인: `python3 -m http.server 4760 --bind 127.0.0.1` 실행 후 `http://127.0.0.1:4760/sajupinggye/`에 접속한다.
