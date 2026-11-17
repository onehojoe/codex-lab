# WowF

WoW Forever(와우 포에버)용 통합 애드온 프로젝트입니다. 퀘스트, 경매장 시세, 던전 정보를 한곳에서 봅니다.

- 방향성과 설계 근거: [BRIEFING.md](BRIEFING.md)
- 현재 단계: **Phase 0**. 애드온 뼈대와 클라이언트 API 점검(`/wowf probe`)만 들어 있습니다.

## 설치

1. 이 저장소에서 `wowf/WowF` 폴더를 통째로 복사합니다.
2. `World of Warcraft\_forever_\Interface\AddOns\WowF\`에 붙여 넣습니다. 안에 `WowF.toc`가 바로 보여야 합니다.
3. 게임을 완전히 재시작합니다. 새 애드온 폴더는 `/reload`만으로는 인식되지 않을 수 있습니다.

## Phase 0 점검 방법

1. 게임 안에서 `/wowf probe`를 입력합니다.
2. 채팅창에 빌드, 인터페이스 번호, 예상과 다른 API, 연동할 수 있는 애드온이 출력됩니다.
3. `/reload`를 한 번 더 하면 전체 결과가 아래 파일에 저장됩니다.
   `World of Warcraft\_forever_\WTF\Account\<계정>\SavedVariables\WowF.lua`
4. 채팅 출력이나 이 파일 내용을 공유해 주세요. 다음 단계 설계를 확정하는 데 씁니다.

에러가 나면 BugSack과 BugGrabber(Forever 버전)를 설치해 에러 문구를 그대로 복사해 주세요.
