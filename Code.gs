/**
 * 「우리 새해 방명록」 데모 — 중간지점(Relay)
 * 구글 시트(접수 목록) + 구글 드라이브(영상 임시 보관) + 이 스크립트(창구)
 *
 * 설치: 구글 시트 새로 만들기 → 확장 프로그램 → Apps Script → 이 코드 전체 붙여넣기
 *       → 배포 → 새 배포 → 유형: 웹 앱 → 실행: 나 / 액세스 권한: 모든 사용자 → 배포 → URL 복사
 */

const CONFIG = {
  SHEET_ID: '',               // 비워두면 연결된 시트 사용. 웹 앱에서 못 찾으면 스프레드시트 ID 입력
  SHEET_NAME: 'queue',
  FOLDER_NAME: '우리새해방명록_임시영상',
  AUTO_APPROVE: false,        // true면 검수 없이 바로 송출 대기
  MAX_MESSAGE: 20,
};

const COLS = ['id', 'createdAt', 'status', 'fileId', 'mime', 'message', 'side', 'updatedAt'];
const C = Object.fromEntries(COLS.map((k, i) => [k, i]));

// ---------- 진입점 ----------
function doGet(e) {
  const p = e.parameter || {};
  try {
    switch (p.action) {
      case 'ping':   return json_({ ok: true, time: Date.now() });
      case 'list':   return json_({ ok: true, items: list_(p.status) });
      case 'file':   return json_(file_(p.id));
      case 'status': return json_(status_(p.id));
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'upload':    return json_(upload_(body));
      case 'setStatus': return json_(setStatus_(body.id, body.status, body.side));
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// ---------- 동작 ----------
function upload_(b) {
  if (!b.data || !b.mime) throw new Error('영상 데이터 없음');
  const id = 'g' + Utilities.getUuid().replace(/-/g, '').slice(0, 9); // 숫자로 읽히지 않게 문자 접두사
  const ext = b.mime.indexOf('mp4') >= 0 ? '.mp4' : '.webm';
  const blob = Utilities.newBlob(Utilities.base64Decode(b.data), b.mime, id + ext);
  const file = folder_().createFile(blob);
  const now = Date.now();
  const msg = String(b.message || '').slice(0, CONFIG.MAX_MESSAGE);
  withLock_(() => {
    sheet_().appendRow([id, now, CONFIG.AUTO_APPROVE ? 'approved' : 'pending', file.getId(), b.mime, msg, '', now]);
  });
  return { ok: true, id: id };
}

function list_(status) {
  return rows_()
    .filter(r => !status || String(status).split(',').indexOf(r[C.status]) >= 0) // 'pending,approved'처럼 여러 상태 가능
    .sort((a, b) => a[C.createdAt] - b[C.createdAt])
    .map(r => ({ id: r[C.id], createdAt: r[C.createdAt], status: r[C.status], mime: r[C.mime], message: r[C.message], side: r[C.side] }));
}

function file_(id) {
  const r = rows_().find(x => x[C.id] === id);
  if (!r || !r[C.fileId]) return { ok: false, error: '파일 없음(이미 파기됨)' };
  const blob = DriveApp.getFileById(r[C.fileId]).getBlob();
  return { ok: true, mime: r[C.mime], data: Utilities.base64Encode(blob.getBytes()) };
}

function status_(id) {
  const all = rows_();
  const me = all.find(x => x[C.id] === id);
  if (!me) return { ok: false, error: '없음' };
  let position = 0;
  if (me[C.status] === 'approved') {
    position = all.filter(x => x[C.status] === 'approved' && x[C.createdAt] < me[C.createdAt]).length + 1;
  }
  return { ok: true, status: me[C.status], position: position, side: me[C.side] };
}

function setStatus_(id, status, side) {
  const allowed = ['pending', 'approved', 'rejected', 'playing', 'played'];
  if (allowed.indexOf(status) < 0) throw new Error('잘못된 상태');
  let fileId = '';
  withLock_(() => {
    const sh = sheet_();
    const values = sh.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][C.id]) !== String(id)) continue;
      const r = values[i].slice();
      r[C.status] = status;
      r[C.updatedAt] = Date.now();
      if (side) r[C.side] = side;
      if (status === 'rejected' || status === 'played') {
        fileId = r[C.fileId];
        r[C.fileId] = '';   // 파일 참조 제거
        r[C.message] = '';  // 문구도 파기
      }
      sh.getRange(i + 1, 1, 1, r.length).setValues([r]); // 한 번에 쓰기
      break;
    }
  });
  if (fileId) destroy_(fileId);
  return { ok: true };
}

// 즉시 파기: 고급 서비스(Drive API)를 켜면 영구 삭제, 아니면 휴지통 이동
function destroy_(fileId) {
  try { Drive.Files.remove(fileId); }
  catch (e) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e2) {} }
}

// 행사 종료 후 일괄 정리 (수동 실행 또는 트리거)
function purgeAll() {
  const it = folder_().getFiles();
  while (it.hasNext()) destroy_(it.next().getId());
  const sh = sheet_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, COLS.length).clearContent();
}

// ---------- 유틸 ----------
function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(CONFIG.SHEET_NAME); sh.appendRow(COLS); sh.getRange('A:A').setNumberFormat('@'); }
  return sh;
}
function rows_() {
  const v = sheet_().getDataRange().getValues();
  return v.slice(1).filter(r => r[C.id]).map(r => { r[C.id] = String(r[C.id]); return r; });
}
function folder_() {
  const it = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.FOLDER_NAME);
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { fn(); } finally { lock.releaseLock(); }
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
