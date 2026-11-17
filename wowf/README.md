# WowF

WoW Forever(와우 포에버)용 개인 애드온 프로젝트입니다. 퀘스트, 경매장 시세, 던전 정보를 한곳에서 봅니다.

- 방향성과 설계 근거: [BRIEFING.md](BRIEFING.md)
- 현재 단계: **Phase 0**. 애드온 뼈대와 클라이언트 API 점검(`/wowf probe`)만 들어 있습니다.
- 대상: 한국 서버 · PvP · 호드. 본인만 쓰므로 CurseForge에는 올리지 않습니다.

## 설치 (게임 PC에서 한 번만)

1. 게임 PC에서 시작 메뉴 → **Windows PowerShell**을 엽니다. 관리자 권한은 보통 필요 없습니다.
2. 아래 한 줄을 붙여 넣고 엔터를 누릅니다.

   ```powershell
   $f="$env:TEMP\WowF-Updater.ps1"; [Net.ServicePointManager]::SecurityProtocol='Tls12'; iwr https://raw.githubusercontent.com/onehojoe/codex-lab/main/wowf/installer/WowF-Updater.ps1 -OutFile $f -UseBasicParsing; powershell -NoProfile -ExecutionPolicy Bypass -File $f -Install -Pause
   ```

3. 설치기가 하는 일은 다음과 같습니다.
   - WoW 설치 폴더를 자동으로 찾습니다. 레지스트리, Battle.net 설정, 흔한 설치 위치 순서로 보고, 그래도 없으면 드라이브를 검색합니다. 찾은 위치는 기억해 둡니다.
   - `_forever_\Interface\AddOns\WowF`에 애드온을 설치합니다.
   - **윈도우 로그인 때마다** 자동으로 업데이트하도록 시작프로그램에 등록합니다.
   - 바탕화면에 **`WowF 업데이트`** 바로가기를 만듭니다. 바로 업데이트하고 싶을 때 더블클릭합니다.
4. 게임을 완전히 재시작합니다. 새 애드온 폴더는 `/reload`만으로는 인식되지 않을 수 있습니다.

못 찾는다고 나오면 경로를 직접 지정합니다. 마지막 명령의 `-Install` 앞에 `-WowPath "D:\Games\World of Warcraft"`를 넣으면 됩니다. `World of Warcraft` 폴더, `_forever_` 폴더, `AddOns` 폴더 중 무엇을 줘도 됩니다.

## 업데이트 동작

- GitHub `main`의 `WowF.toc` 버전과 설치된 버전을 비교합니다. **다르면 기존 `WowF` 폴더를 지우고 새로 설치합니다.**
- 새 폴더를 옆에 먼저 만든 뒤 이름만 바꿔 끼우고, 실패하면 기존 폴더를 되돌립니다.
- 애드온 데이터(`WTF\Account\<계정>\SavedVariables\WowF.lua`)는 지우지 않습니다. 재설치해도 시세 기록이 남습니다.
- 게임이 켜진 상태에서 업데이트되면 게임에서 `/reload` 하세요.
- 기록: `%LOCALAPPDATA%\WowF\update.log`

## 그 밖의 명령

설치 뒤 설치기는 `%LOCALAPPDATA%\WowF\WowF-Updater.ps1`에 있습니다.

| 하고 싶은 것 | PowerShell 명령 |
|---|---|
| 경로·버전만 확인 | `powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\WowF\WowF-Updater.ps1" -CheckOnly -Pause` |
| 버전이 같아도 다시 설치 | `... -Force -Pause` |
| 자동 업데이트 끄기 | `... -Install -NoAutoUpdate -Pause` |
| 전부 제거 | `... -Uninstall -Pause` |

## Questie (무료)

퀘스트 기능은 Questie 데이터를 씁니다. **CurseForge 앱**에서 게임을 World of Warcraft → Forever로 고르고 Questie를 설치하세요. Questie 업데이트는 CurseForge 앱이 알아서 합니다. WowF 설치기는 Questie가 있는지 확인해서 알려 주기만 합니다.

## Phase 0 점검

1. 게임 안에서 `/wowf probe`를 입력합니다.
2. 채팅창에 빌드, 인터페이스 번호, 예상과 다른 API, 연동할 수 있는 애드온이 출력됩니다.
3. `/reload`를 한 번 하면 전체 결과가 `WTF\Account\<계정>\SavedVariables\WowF.lua`에 저장됩니다.
4. 채팅 출력이나 이 파일 내용을 공유해 주세요. 다음 단계 설계를 확정하는 데 씁니다.

에러가 나면 BugSack과 BugGrabber(Forever 버전)를 설치하고 에러 문구를 그대로 복사해 주세요.

## 개발 규칙

- `WowF/` 안의 파일을 바꾸면 **반드시 `WowF.toc`의 `## Version`을 올립니다.** 설치기는 버전 문자열이 다를 때만 재설치합니다.
- `installer/WowF-Updater.ps1`은 **UTF-8 BOM**으로 저장합니다. BOM이 없으면 Windows PowerShell 5.1이 한국어를 깨뜨립니다.
