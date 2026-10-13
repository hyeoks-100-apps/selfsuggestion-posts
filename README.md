# 자기암시 게시 보드 (selfsuggestion-posts)

휴대폰에서 인스타 계정별(🇰🇷 @affirmation.daily.kr · 🇯🇵 @affirmation.daily.jp · 🇺🇸 @selfsuggestion_official) 게시물을
하나씩 **이미지 저장 → 캡션+태그 복사 → 올림 체크** 하기 위한 정적 페이지. GitHub Pages로 배포.

- 원본 데이터: 콘텐츠 스튜디오(`content_studio.html`, 로컬 툴)의 문구·캡션·태그
- 이미지: 스튜디오의 "이 언어 200개 한꺼번에 받기" ZIP (`selfsuggestion_<언어>_feed_200.zip`)
- 다시 만들기: `python3 build.py [스튜디오.html] [ZIP 폴더]` → `data.json`, `img/`, `thumb/` 갱신 후 커밋·푸시
- 올림 체크는 각 기기 브라우저(localStorage)에 저장. 페이지 맨 아래 "체크 기록 복사/붙여넣기"로 기기 간 옮김.
- `backup/`: 스튜디오 설정 백업 JSON (게시물별 스타일·위치·문구 수정 등). 스튜디오의 "백업 불러오기"로 복원.
