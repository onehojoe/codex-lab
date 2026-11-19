# WowF

WoW Forever(와우 포에버)용 개인 애드온 프로젝트입니다. 퀘스트, 경매장 시세, 던전 정보를 한곳에서 봅니다.

- 방향성과 설계 근거: [BRIEFING.md](BRIEFING.md)
- 현재 단계: **Phase 0**. 애드온 뼈대와 클라이언트 API 점검(`/wowf probe`)만 들어 있습니다.
- 대상: 한국 서버 · PvP · 호드. 본인만 쓰므로 CurseForge에는 올리지 않습니다.

## 설치 · 업데이트 · 제거 (더블클릭)

`installer` 폴더에 있는 파일을 **더블클릭**합니다. Google Drive 폴더, GitHub에서 받은 zip, 어느 쪽에서 실행해도 됩니다.

| 파일 | 하는 일 |
|---|---|
| `1_설치.cmd` | WoW 폴더를 자동으로 찾아 설치하고, 윈도우 로그인 때 자동 업데이트를 등록하고, 바탕화면에 `WowF 업데이트` 바로가기를 만듭니다 |
| `2_업데이트.cmd` | 버전을 확인해서 바뀌었으면 기존 WowF를 지우고 다시 설치합니다. 설치 뒤에는 바탕화면 바로가기와 같은 기능입니다 |
| `3_제거.cmd` | WowF 애드온, 자동 업데이트, 바로가기를 지웁니다. 애드온 데이터(`WowF.lua`)는 남깁니다 |

- `.cmd` 파일과 `WowF-Updater.ps1`은 **같은 폴더**에 있어야 합니다. 설치가 끝난 뒤에는 `2_업데이트.cmd`와 `3_제거.cmd`가 설치된 사본(`%LOCALAPPDATA%\WowF`)도 찾아서 씁니다.
- 브라우저로 받은 파일이면 처음에 Windows 보안 경고가 뜰 수 있습니다. **실행**(또는 **추가 정보 → 실행**)을 누르세요.
- 결과 창은 엔터를 누를 때까지 열려 있습니다. 빨간 `오류:` 줄이 나오면 그대로 복사해 주세요.
- 설치 뒤에는 게임을 완전히 재시작합니다. 새 애드온 폴더는 `/reload`만으로는 인식되지 않을 수 있습니다.

WoW 폴더를 못 찾으면 PowerShell에서 경로를 직접 지정합니다. `World of Warcraft` 폴더, `_forever_` 폴더, `AddOns` 폴더 중 무엇을 줘도 됩니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\WowF-Updater.ps1 -WowPath "D:\Games\World of Warcraft" -Install -Pause
```

### PowerShell 한 줄 설치 (main 반영 후)

파일을 받지 않고 설치하는 방법입니다. GitHub `main`에 wowf가 합쳐진 뒤부터 동작합니다.

```powershell
$f="$env:TEMP\WowF-Updater.ps1"; [Net.ServicePointManager]::SecurityProtocol='Tls12'; iwr https://raw.githubusercontent.com/onehojoe/codex-lab/main/wowf/installer/WowF-Updater.ps1 -OutFile $f -UseBasicParsing; powershell -NoProfile -ExecutionPolicy Bypass -File $f -Install -Pause
```

## 업데이트 동작

- GitHub `main`의 `WowF.toc` 버전과 설치된 버전을 비교합니다. `main`에 아직 wowf가 없으면 작업 브랜치를 대신 봅니다. **다르면 기존 `WowF` 폴더를 지우고 새로 설치합니다.**
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
- `installer/*.cmd`는 **ASCII 문자와 CRLF 줄바꿈만** 씁니다. `cmd.exe`는 배치 파일을 시스템 코드 페이지(한국어 Windows는 cp949)로 읽기 때문입니다.
