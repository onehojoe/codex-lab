# WowF 방향성 브리핑

작성일: 2026-11-17 · 대상: WoW Forever(와우 포에버) 라이브 클라이언트

---

## 0. 결론

- **만들 수 있습니다.** Forever는 Midnight(리테일) 클라이언트 위에서 돌아가고 인터페이스 번호는 `16001`입니다. 퀘스트, 경매장 시세, 던전 정보는 모두 전투 밖에서 쓰는 기능입니다. 그래서 Midnight의 전투 제한(secret value, 전투 로그 차단)은 거의 영향을 주지 않습니다.
- **다만 "기존 애드온을 통째로 따라 만들기"가 맞는지는 기능마다 다릅니다.**

  | 기능 | 판정 | 이유 |
  |---|---|---|
  | 경매장 시세 | **직접 구현** | 클라이언트 API가 데이터를 다 줍니다. 코드량이 적고 외부에 기댈 것이 없습니다. 가장 먼저 만듭니다. |
  | 던전 정보 | **정적 DB를 동봉하고 직접 수집** | Forever는 던전 저널(EJ)이 꺼져 있어 클라이언트에 보스·드랍 데이터가 없습니다. |
  | 퀘스트 | **직접 만들지 않고 Questie와 연동** | Questie의 가치는 코드가 아니라 좌표 DB와 지속 업데이트에 있습니다. 포크하면 그 유지보수를 우리가 떠안습니다. |

- **구조:** WowF는 **통합 허브**이고 기능별 **공급자(Provider)** 를 꽂아 씁니다. 공급자는 자체 구현일 수도 있고, 설치된 다른 애드온일 수도 있습니다.
- **만드는 의미(차별점):** 세 데이터를 서로 엮는 것입니다. 던전 드랍표에 경매장 시세를 붙이고, 퀘스트 보상 아이템의 골드 가치를 보여 주고, 한국어 우선 단일 패널로 묶습니다. 이 기능만 원하면 Questie, Auctionator, AtlasLoot을 따로 깔면 됩니다. 그 셋으로는 안 되는 이 교차 기능이 WowF를 만들 이유입니다.

---

## 1. 환경 사실 (Forever 클라이언트)

| 항목 | 값 | 근거 |
|---|---|---|
| 클라이언트 | Midnight 리테일 클라이언트 기반 (Classic 클라이언트 아님) | 여러 커뮤니티 자료가 일치 |
| 인터페이스 | `## Interface: 16001` | 커뮤니티 인게임 덤프 |
| `GetBuildInfo()` | `"1.60.1", "70862", "Nov 6 2026", 16001` | 커뮤니티 덤프 |
| `WOW_PROJECT_ID` | `18` = `WOW_PROJECT_CAMELOT` (빌드 70170부터. 그 전에는 리테일과 같은 `1`) | 덤프. **ID 하나만으로 판정하면 안 됩니다** |
| TOC 게임 타입 | `camelot`, 빌드 70291부터 `forever` 별칭 | 덤프. 우리는 Forever 전용이라 `WowF.toc` 한 개만 씁니다 |
| 설치 경로 | `World of Warcraft\_forever_\Interface\AddOns\WowF\` | 여러 자료가 일치 |
| 사라진 옛 API | `GetItemInfo`, `GetQuestLogTitle`, `QueryAuctionItems` | 대신 `C_Item`, `C_QuestLog`, `C_AuctionHouse` 사용 |
| 전투 제한 | `COMBAT_LOG_EVENT_UNFILTERED` 거부. 전투 중 체력·오라 등은 secret value. 인스턴스 안 채팅도 secret | Midnight 규칙이 그대로 적용 |
| 경매장 | 리테일식 경매장. `ReplicateItems()`로 전체 목록을 받을 수 있음 (실측 약 19만 행, 약 1분). `GetReplicateItemInfo`는 0부터 세고 값 18개를 돌려줌. 판매자 이름은 `nil`. 가격은 묶음 기준이라 `count`로 나눠야 단가. 구매·등록은 하드웨어 클릭이 필요 | 커뮤니티 실측 |
| 전체 스캔 제한 | 15분에 1회로 추정 (ATT 등이 이 기준으로 스스로 제한) | **확인 안 됨** |
| 던전 저널 | `EJ_GetNumTiers()` = `0` → 클라이언트에 보스·드랍 데이터 없음 | 커뮤니티 실측 |
| 퀘스트 | Forever 신규 퀘스트는 1,000개 이상이고 ID는 약 86000번부터. 기존 퀘스트도 위치가 바뀐 경우가 있음 | 커뮤니티 자료 |
| 서버 구조 | Realm 대신 Ruleset을 고름 (Normal / PvP / RP / Hardcore) | 커뮤니티 자료 |

> ⚠️ 위 사실 대부분은 블리자드 공식 문서가 아니라 커뮤니티 실측입니다. 그래서 **Phase 0의 `/wowf probe`** 를 사용자 본인 클라이언트(koKR)에서 돌려 직접 확정합니다.

---

## 2. 문제 구조: 기능별 데이터는 어디서 오는가

**근본 제약:** 애드온은 인터넷에 접속할 수 없습니다. Lua 샌드박스에는 `io`, `os`, 소켓이 없습니다. 그래서 데이터를 얻는 길은 세 가지뿐입니다.

1. 클라이언트 API가 그 자리에서 주는 데이터
2. 애드온 파일에 미리 넣어 둔 **정적 DB**
3. 플레이하면서 모아 SavedVariables에 쌓은 데이터

| 기능 | 클라이언트 API가 주는 것 | 주지 않는 것 (정적 DB나 수집이 필요) | 어려움의 본질 |
|---|---|---|---|
| 퀘스트 | 내 퀘스트 로그, 목표 진행도, 완료 여부 (`C_QuestLog.IsQuestFlaggedCompleted`) | 퀘스트를 주는 NPC 위치, 목표 몹·오브젝트 좌표, 선행 퀘스트, 받을 수 있는 퀘스트 목록 | **데이터** (구축과 유지) |
| 경매장 시세 | 경매장을 열었을 때 전체 목록 (`ReplicateItems`) | 과거 시세(직접 쌓아야 함), 다른 서버 시세, 경매장 밖에서의 실시간 시세 | **코드** (처리 성능과 저장 용량) |
| 던전 정보 | 현재 인스턴스 정보, 루팅 창의 아이템 | 던전 목록, 레벨대, 위치, 보스, 드랍표 (EJ가 꺼져 있음) | **데이터** (특히 Forever 신규 던전) |

→ 퀘스트와 던전은 코드가 아니라 **데이터** 문제이고, 경매장은 **코드** 문제입니다. "따라 만들기" 전략이 기능마다 갈리는 근본 이유가 여기에 있습니다.

---

## 3. 데이터 흐름

```
[클라이언트 API]                          [정적 DB (애드온에 동봉)]
  C_AuctionHouse (경매장 열렸을 때) ─┐        Dungeons.lua: 던전/보스/드랍 itemID
  C_QuestLog ───────────────────────┤        (퀘스트 DB는 Questie에 맡김)
  LOOT_OPENED / GetInstanceInfo ────┤                    │
                                    ▼                    ▼
              ┌──────────────── WowF Core ────────────────────────┐
              │ Provider 레이어                                    │
              │  PriceProvider  : 자체 스캔 DB → 없으면 Auctionator API │
              │  QuestProvider  : Questie가 있으면 Questie → 없으면 C_QuestLog만 │
              │  DungeonProvider: 정적 DB + 직접 모은 드랍           │
              └───────────────────────┬────────────────────────────┘
                                      ▼
              WowFDB (SavedVariables. /reload나 로그아웃 때 디스크에 기록)
                                      ▼
              UI: 아이템 툴팁 한 줄 / 던전 패널 / 슬래시 명령 /wowf
```

교차 기능은 전부 `PriceProvider`를 공통 기반으로 씁니다. 던전 드랍 가치 = 드랍표 × 시세, 퀘스트 보상 가치 = 보상 itemID × 시세입니다.

---

## 4. 병목 분석

### 4.1 경매장 (코드 병목)

| 병목 | 원인 | 대응 |
|---|---|---|
| 스캔 빈도 | 전체 스캔은 15분에 1회로 추정 | 마지막 스캔 시각을 저장하고, 버튼에 남은 쿨다운을 표시 |
| 화면 멈춤 | 19만 행을 한 프레임에 돌리면 몇 초간 멈춤 | 프레임마다 시간 예산(예: 8ms, `debugprofilestop`)을 두고 나눠서 처리 |
| 아이템 정보 미캐시 | `hasAllInfo=false`인 행이 있음 | 이름이 아니라 **itemID(17번째 반환값)** 를 키로 씀. 이름은 화면에 보일 때 `C_Item.GetItemInfo`로 채움 |
| 가격 단위 | `buyoutPrice`는 묶음 가격 | `count`로 나눈 단가를 저장하고, 즉시 구매가가 0인(입찰 전용) 행은 뺌 |
| SavedVariables 비대 | 원본 행을 그대로 저장하면 수십 MB가 되어 로그인이 느려짐 | itemID별 `{최저 단가, 수량, 스캔 시각}`만 저장. 날짜별 기록은 N일까지만 보관 |
| 장비 접미사 | 아이템 링크의 suffix 필드가 비어 있다는 보고 | 첫 버전은 itemID 단위. 장비 세분화는 2차 |
| 서버·진영 분리 | Forever는 Realm 대신 Ruleset 구조 | 키를 `GetRealmName()` + 진영으로 두고, probe 결과를 보고 확정 |
| 메모리 | 스캔 중 임시 테이블이 대량으로 생김 | 테이블을 재사용하고, 스캔이 끝나면 참조를 끊음. `collectgarbage`를 강제로 부르지 않음 |

### 4.2 던전 정보 (데이터 병목)

- EJ가 꺼져 있어 클라이언트에서 보스와 드랍을 가져올 수 없습니다.
- **기존 클래식 던전:** AtlasLootClassic의 데이터 구조를 참고합니다. 이 애드온은 GPL-2.0이라, 그대로 복사하려면 라이선스 호환을 먼저 확인해야 합니다 (§5).
- **Forever 신규 던전** (커뮤니티 자료 기준 9곳 이상, 예: Barrow Deeps)은 공개 데이터가 부족합니다. 그래서 수집기를 직접 만듭니다. 루팅 창이 열리면(`LOOT_OPENED`) `GetInstanceInfo()`와 `GetLootSlotLink()`로 `(instanceID, itemID)` 횟수를 쌓습니다. 보스별로 묶는 데 쓸 `ENCOUNTER_END`는 아직 확인되지 않았습니다.
- **다국어:** DB에는 itemID와 npcID만 넣습니다. 이름은 클라이언트가 현지화해 주므로 한국어는 저절로 해결됩니다.

### 4.3 퀘스트 (데이터 병목. 세 기능 중 가장 큼)

- Questie는 커밋이 약 2만 3천 개인 프로젝트입니다. DB는 별도 애드온(QuestieDB)으로 나뉘어 있고, Forever 데이터를 계속 갱신하고 있습니다. 12.0.4에서 Forever 기본 데이터가 들어갔고, QuestieDB 1.0.x에서도 수정이 이어지고 있습니다.
- 포크하면 Forever 패치마다 신규 퀘스트 1,000개 이상의 좌표와 선후관계를 우리가 갱신해야 합니다. 사실상 불가능하고, 포크는 몇 주 안에 낡아 버립니다.
- **결론:** Questie가 설치되어 있다고 전제하고 연동합니다. WowF만의 기능은 **Questie가 하지 않는 것**으로 한정합니다. 퀘스트 보상의 경매장 가치, 던전 패널 안의 해당 던전 퀘스트 목록 같은 것입니다.

---

## 5. 기존 애드온 분석과 라이선스 ("따라 만들기" 가능 범위)

| 애드온 | Forever 상태 | 라이선스 | 판정 |
|---|---|---|---|
| Questie | Forever 전용 toc 있음 (`Questie_Forever.toc`), 12.x | GPL-3.0 (`LICENSE.md`, `gpl-3.0.md`) | 포크하지 않고 **연동(의존)** |
| Auctionator (plusmouse) | Forever 대응판 있음 | GPL-3.0 (미러 저장소 기준이라 원본 확인 필요) | 구현 패턴 참고 + `Auctionator.API.v1`을 대체 공급자로 연동 (Forever에서는 아직 확인 안 됨, `pcall`로 감쌈) |
| AtlasLootClassic (Hoizame, 원본) | Forever 버전 없음 | GPL-2.0 | 데이터 구조 참고 |
| AtlasLoot Classic Forever | Forever 전용 | 확인 안 됨. 의존 라이브러리 FojjiCore는 "All rights reserved" | **복사 금지** |
| Atlas Forever (포크) | Forever 전용 | GPL | 지도 기능이 필요할 때 참고 |
| Forever Assist | Forever 전용 올인원 | 표기 없음, 소스 비공개 | 기능 비교 대상으로만 |
| TradeSkillMaster | Forever 미지원 | 독점 | 해당 없음 |

**라이선스 함정**

- GPL 코드를 복사하면 WowF 전체가 GPL이 됩니다. WoW 애드온은 어차피 소스가 공개되므로 그 자체는 문제가 아닙니다.
- **GPL-2.0-only 코드와 GPL-3.0 코드를 한 애드온에 섞으면 충돌할 수 있습니다.** AtlasLootClassic이 "or later" 조건인지 확인하기 전에는 두 쪽 코드를 함께 복사하지 않습니다.
- 다른 애드온을 **설치된 별도 애드온으로 호출**하는 것은 복사가 아닙니다. 그래서 Provider 구조가 법적으로도 가장 깔끔합니다.
- 블리자드 애드온 정책: 무료로 배포해야 하고, 코드 난독화와 게임 안 후원·광고 요구는 금지입니다.

---

## 6. 솔루션 전략과 로드맵

**원칙: 코드는 직접 짜고, 데이터는 빌리고, 거대 DB는 맡긴다.**

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **Phase 0** (이번 커밋) | 애드온 뼈대 + `/wowf probe` | 사용자 클라이언트에서 probe 결과를 받아 가정 확정 |
| **Phase 1 경매장** | 경매장을 열면 스캔 버튼. `ReplicateItems` 결과를 나눠서 처리. itemID별 최저 단가·수량·시각 저장. 아이템 툴팁에 `경매장: 12g 30s (2시간 전) · 상점: 1g` 표시. `/wowf price [아이템 링크]` | 스캔 중 화면 멈춤 없음. `/reload` 뒤에도 시세 유지 |
| **Phase 2 던전** | 던전 패널(레벨대, 위치, 보스, 드랍). 드랍에 시세 결합. 루팅 수집기 | 클래식 던전 전체 + 신규 던전 일부 |
| **Phase 3 퀘스트** | Questie 연동: 보상 아이템 가치, 던전별 퀘스트 | Questie가 있을 때와 없을 때 모두 에러 없음 |
| **Phase 4 마감** | 옵션 UI, koKR/enUS 문자열 분리, CurseForge 배포(선택) | — |

**경매장을 먼저 하는 이유:** 외부 데이터에 기대지 않습니다. 핵심 API도 이미 실측되었습니다(19만 행). 그리고 나머지 두 기능의 교차 가치(드랍 가치, 보상 가치)가 모두 이 위에 올라갑니다.

### 폴더 구조 (계획)

```
wowf/
  BRIEFING.md          ← 이 문서
  README.md            ← 설치와 테스트 방법
  installer/
    WowF-Updater.ps1   ← 게임 PC용 설치·자동 업데이트 도구 (Windows)
  WowF/                ← 게임의 AddOns 폴더에 설치되는 단위
    WowF.toc
    Core.lua           ← 네임스페이스, SavedVariables, /wowf 명령 분배
    Probe.lua          ← Phase 0 API 점검
    Price/             ← Phase 1 (Scanner.lua, Store.lua, Tooltip.lua)
    Dungeon/           ← Phase 2 (Data/*.lua, Collector.lua, Panel.lua)
    Quest/             ← Phase 3 (QuestieBridge.lua)
```

---

## 7. 개발·테스트 방식

- 저는 클라우드 컨테이너에서 작업하므로 게임을 실행할 수 없습니다. 여기서 할 수 있는 것은 **Lua 5.1(WoW와 같은 버전)로 문법 검사**하고 **WoW API 스텁으로 로직을 테스트**하는 데까지입니다.
- 실제 검증은 사용자가 게임 PC에서 합니다. 제가 GitHub `main`에 버전을 올려 푸시하면, 게임 PC의 설치기가 윈도우 로그인 때나 바탕화면 `WowF 업데이트`를 누를 때 받아서 다시 설치합니다. 게임에서 `/reload`하고, BugSack(Forever 버전)으로 에러를 잡은 다음, 에러 문구나 `SavedVariables\WowF.lua` 내용을 붙여 넣어 주시면 됩니다.
- 그래서 Phase 0이 probe입니다. 커뮤니티 실측을 사용자 클라이언트의 사실로 바꿔 두면 이후 단계가 재작업 없이 진행됩니다.

---

## 8. 결정 사항 (2026-11-17 확정)

| 항목 | 결정 | 설계에 주는 영향 |
|---|---|---|
| 퀘스트 | **Questie 연동** (무료, GPL-3.0) | WowF는 퀘스트 DB를 만들지 않습니다. Questie가 있으면 그 데이터를 읽고, 없으면 퀘스트 기능만 끕니다. `WowF.toc`에 `## OptionalDeps: Questie`를 넣어 Questie가 먼저 로드되게 했습니다 |
| 배포 | **본인 전용.** CurseForge에 올리지 않음 | 게임 PC의 설치기(`installer/WowF-Updater.ps1`)가 GitHub `main`에서 직접 받아 설치하고 자동 업데이트합니다. 저장소가 공개라서 GPL 코드를 가져올 때는 출처와 라이선스 고지를 남깁니다 |
| 캐릭터 | **한국 서버 · PvP · 호드** | 시세 DB 키는 `GetRealmName()` + `UnitFactionGroup("player")`입니다. 호드 한 진영만 저장하므로 저장 용량이 절반으로 줄어듭니다. 경매장이 진영 공용인지는 probe와 첫 스캔으로 확인합니다 |
| 게임 PC | 개발 환경과 다른 PC | 경로 자동 탐지, 버전 비교 후 재설치, 로그인 시 자동 업데이트를 설치기가 맡습니다 |

---

## 출처

- [Kami-labs: WoW Forever Addons – 호환성 목록](https://kami-labs.fr/en/addons-wow-forever/)
- [ForeverChanges: Forever 버전이 있는 애드온](https://foreverchanges.pro/addons)
- [WoW Forever Guides: Addon Development Guide (Interface 16001)](https://wowforeverguides.com/addons/developers)
- [ForeverPlusPlus: docs/forever-api.md](https://github.com/xIGBClutchIx/ForeverPlusPlus/blob/main/docs/forever-api.md)
- [ryna_agent: docs/forever-client-api.md (경매장, EJ, WOW_PROJECT_ID 실측)](https://github.com/MaddisonM79/ryna_agent/blob/main/docs/forever-client-api.md)
- [aux-forever: docs/status-history.md (경매장 스캔 실측)](https://github.com/TylerHampton/aux-forever/blob/main/docs/status-history.md)
- [Questie GitHub](https://github.com/Questie/Questie)
- [Auctionator 미러 (plusmouse)](https://github.com/curseforge-mirror/auctionator)
- [AtlasLootClassic (Hoizame)](https://github.com/Hoizame/AtlasLootClassic)
- [AtlasLoot Classic Forever (CurseForge)](https://www.curseforge.com/projects/1422985)
- [Forever Assist](https://www.forever-assist.com/en)
- [인벤: WoW Forever 게임 시스템 총정리](https://www.inven.co.kr/board/wow/6567/18)
- [epiccarry: Questie Forever 업데이트 내역](https://epiccarry.com/blogs/?p=44611)
