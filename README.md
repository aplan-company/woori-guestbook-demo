# 「우리 새해 방명록」 데모 — 설치·실행 안내

> **현재 기본 중간지점: Supabase** (서울 리전, 실시간 알림). `supabase_setup.sql`로 테이블·저장소·권한 설정.
> - 폰: `mobile.html` (키 불필요)
> - 콘솔·송출: `console.html?key=스태프키`, `game.html?key=스태프키` — 스태프 키는 Supabase SQL `select v from app_secret where k='staff_key'`
> - Apps Script 중간지점을 쓰려면 기존처럼 `?api=웹앱URL`을 붙이면 됩니다(우선 적용).


## 구성
| 파일 | 어디서 | 역할 |
|---|---|---|
| `mobile.html` | 참여자 폰 | 동의 → 새해 한마디 → 10초 셀피 촬영 → 전송 → 대기 상태 확인 |
| `console.html` | 검수 PC | 대기 영상 확인 → 승인(A) / 반려(R, 즉시 파기) |
| `game.html` | 서예박물관 송출 PC | 승인된 영상을 좌·우 벽에 10초×2회 송출 → 끝나면 파기 요청 |
| `Code.gs` | 구글 Apps Script | **중간지점** — 구글 시트(목록) + 드라이브(영상 임시 보관) |

```
폰 ──업로드──▶ [중간지점: Apps Script + 시트 + 드라이브] ◀──승인/반려── 검수 콘솔
                          │
                          └──승인된 영상──▶ 게임(송출) ──송출 완료──▶ 즉시 파기
```
폰과 게임 PC는 서로 직접 연결되지 않습니다. 셋 다 중간지점에만 접속합니다.

---

## A. 바로 보기 — 로컬 데모 모드 (설정 없음)
같은 PC, 같은 브라우저에서 세 화면을 탭으로 열어 흐름만 확인하는 모드입니다. (웹캠 필요)

1. 이 폴더에서 로컬 서버 실행 — 카메라는 `localhost`나 HTTPS에서만 켜집니다
   - `python -m http.server 8000` 또는 VS Code의 Live Server
2. 브라우저 탭 3개: `localhost:8000/mobile.html`, `/console.html`, `/game.html`
3. 모바일 탭에서 촬영·전송 → 콘솔에서 `A` → 게임 화면에 송출

## B. 실제 폰 연결 — Apps Script 중간지점
### 1) 중간지점 만들기 (약 5분)
1. 구글 시트 새로 만들기 (이름 자유)
2. 메뉴 **확장 프로그램 → Apps Script** → 기본 코드 지우고 `Code.gs` 내용 붙여넣기 → 저장
3. **배포 → 새 배포 → 유형 선택: 웹 앱**
   - 실행 계정: **나** / 액세스 권한: **모든 사용자**
4. 권한 승인(시트·드라이브 접근) 후 나오는 **웹 앱 URL** 복사 (`https://script.google.com/macros/s/.../exec`)
5. (선택) 영구 삭제: Apps Script 왼쪽 **서비스 +** → **Drive API** 추가. 안 하면 파기 시 휴지통으로 이동합니다.

> 웹 앱에서 `getSheetByName` 오류가 나면 `CONFIG.SHEET_ID`에 스프레드시트 ID(시트 주소의 /d/ 뒤 부분)를 넣고 다시 배포하세요.

> 코드를 고친 뒤에는 **배포 → 배포 관리 → 수정 → 새 버전**으로 다시 배포해야 반영됩니다.

### 2) 세 HTML에 URL 넣기
각 파일 `<script>` 첫 줄의 `const ENDPOINT = '';` 따옴표 안에 웹 앱 URL을 넣습니다.
(또는 주소 뒤에 `?api=웹앱URL`을 붙여 열어도 됩니다 — 공개 저장소에는 URL을 넣지 말고 이 방식을 권장. 목록 페이지(index.html)에 붙이면 세 화면에 자동 전달)

### 3) 올리기
- 실제 주소(GitHub Pages)에서는 `?api=`가 없으면 "연결 정보가 없어요"가 뜹니다. 같은 PC 로컬 테스트는 localhost로 열거나 `?local`을 붙이세요
- `mobile.html`은 **HTTPS**에서만 카메라가 켜집니다 → GitHub Pages 등에 업로드 후 그 주소를 QR로 만듭니다
- `console.html`, `game.html`은 PC에서 파일을 그냥 열어도 됩니다

## game.html 단축키
- `F` 전체화면 · `D` 상태 표시(대기열/오류) · `P` 일시정지 (브랜딩 영상 구간 등)
- 해상도: 파일 상단 `PANEL_W`, `PANEL_H` (기본 벽 한 면 1080×1920, 좌·우 나란히 = 2160×1920)
- 반복 횟수: `LOOPS` (기본 2회)

## 데이터 파기
- 반려 즉시 / 송출 완료 즉시 → 드라이브 영상 삭제 + 시트의 문구 삭제
- 행사 종료 후: Apps Script에서 `purgeAll` 함수 실행 → 남은 파일·목록 일괄 삭제

## 데모 범위에서 빠진 것 (다음 단계)
- 통신 대응(Wi-Fi 존, 사진 모드 자동 전환), AI 1차 검수, Spout 출력(Electron/OBS), 송출 장면 녹화 클립(B안)
- Apps Script는 동시 접속 한도가 있어 **데모·시연용**입니다. 본행사는 같은 구조로 Firebase/Supabase 전환을 권장합니다.
