// ===== 중간지점(Relay) 연결 — 세 파일 공통 =====
// ENDPOINT가 비어 있으면 '로컬 데모 모드'(같은 PC 같은 브라우저의 탭끼리 IndexedDB로 주고받음)
// 우선순위: ?api=(Apps Script) → Supabase(SB_URL·SB_KEY 설정 시) → 로컬 데모(localhost 또는 ?local)
const QS = new URLSearchParams(location.search);
const API = QS.get('api') || ENDPOINT;
const STAFF_KEY = QS.get('key') || '';   // 콘솔·송출 PC 전용 (승인·반려·송출 권한)
const LOCAL_OK = QS.has('local') || location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
const USE_SB = !API && !QS.has('local') && typeof SB_URL !== 'undefined' && SB_URL && SB_KEY && window.supabase;
const Relay = API ? gasRelay(API) : USE_SB ? supabaseRelay(SB_URL, SB_KEY, STAFF_KEY) : (LOCAL_OK ? localRelay() : null);
const RELAY_KEY = API || (USE_SB ? SB_URL : 'local'); // 접수 기록이 어느 중간지점 것인지 구분

function supabaseRelay(url, key, staffKey) {
  const sb = window.supabase.createClient(url, key, { auth: { persistSession: false } });
  const BUCKET = 'guestbook';
  const paths = new Map(); // id → 저장소 경로 (목록 조회 때 기억)
  const toItem = (r) => ({ id: r.id, createdAt: Date.parse(r.created_at), status: r.status, mime: r.mime,
    message: r.message || '', side: r.side || '' });
  const fail = (e, fallback) => { throw new Error((e && e.message) || fallback || '요청 실패'); };
  return {
    mode: 'supabase',
    async upload(blob, mime, message) {
      const ext = mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
      const path = 'v/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)) + '.' + ext;
      const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
      if (up.error) fail(up.error, '업로드 실패');
      const ins = await sb.from('guestbook').insert({ path, mime, message: String(message || '').slice(0, 20) }).select('id').single();
      if (ins.error) { sb.storage.from(BUCKET).remove([path]); fail(ins.error, '접수 실패'); }
      return { ok: true, id: ins.data.id };
    },
    async list(status) {
      let q = sb.from('guestbook').select('*').order('created_at');
      if (status) q = q.in('status', String(status).split(','));
      const { data, error } = await q;
      if (error) fail(error);
      data.forEach(r => { if (r.path) paths.set(r.id, r.path); });
      return data.map(toItem);
    },
    async getFile(id) {
      let path = paths.get(id);
      if (!path) {
        const { data } = await sb.from('guestbook').select('path').eq('id', id).maybeSingle();
        path = data && data.path;
      }
      if (!path) throw new Error('파일 없음(이미 파기됨)');
      const r = await fetch(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, { cache: 'no-store' });
      if (!r.ok) throw new Error('파일 없음(이미 파기됨)');
      return r.blob();
    },
    async setStatus(id, status, side = '') {
      const { data, error } = await sb.rpc('staff_set_status', { p_key: staffKey, p_id: id, p_status: status, p_side: side });
      if (error) fail(error);
      if (data) { paths.delete(id); await sb.storage.from(BUCKET).remove([data]); } // 즉시 파기
      return { ok: true };
    },
    async status(id) {
      const { data, error } = await sb.from('guestbook').select('id,status,side,created_at').eq('id', id).maybeSingle();
      if (error) fail(error);
      if (!data) throw new Error('없음');
      let position = 0;
      if (data.status === 'approved') {
        const c = await sb.from('guestbook').select('id', { count: 'exact', head: true })
          .eq('status', 'approved').lt('created_at', data.created_at);
        position = (c.count || 0) + 1;
      }
      return { ok: true, status: data.status, position, side: data.side };
    },
    // 새 접수·상태 변경이 생기면 즉시 호출 (폴링 대신)
    subscribe(cb) {
      sb.channel('guestbook-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'guestbook' }, () => cb())
        .subscribe();
      return true;
    },
  };
}

function gasRelay(url) {
  const timeoutFetch = (u, opt = {}, ms = 60000) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    return fetch(u, { ...opt, signal: ac.signal }).finally(() => clearTimeout(t));
  };
  const get = async (params) => {
    const r = await timeoutFetch(url + '?' + new URLSearchParams(params));
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '요청 실패');
    return j;
  };
  // Content-Type text/plain = 사전요청(preflight) 없는 단순 요청 → Apps Script와 호환
  const post = async (body) => {
    const r = await timeoutFetch(url, { method: 'POST', body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '요청 실패');
    return j;
  };
  return {
    mode: 'apps-script',
    async upload(blob, mime, message) {
      const data = await blobToBase64(blob);
      return post({ action: 'upload', mime, message, data });
    },
    async list(status) { return (await get({ action: 'list', status })).items; },
    async getFile(id) {
      const j = await get({ action: 'file', id });
      return (await fetch(`data:${j.mime};base64,${j.data}`)).blob();
    },
    setStatus(id, status, side = '') { return post({ action: 'setStatus', id, status, side }); },
    status(id) { return get({ action: 'status', id }); },
  };
}

function localRelay() {
  const dbp = new Promise((res, rej) => {
    const r = indexedDB.open('woori-guestbook-demo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = async (mode) => (await dbp).transaction('items', mode).objectStore('items');
  const all = async () => rq((await store('readonly')).getAll());
  return {
    mode: 'local',
    async upload(blob, mime, message) {
      const id = Math.random().toString(36).slice(2, 10);
      const now = Date.now();
      await rq((await store('readwrite')).put({ id, createdAt: now, status: 'pending', blob, mime, message: String(message || '').slice(0, 20), side: '', updatedAt: now }));
      return { ok: true, id };
    },
    async list(status) {
      return (await all()).filter(x => !status || String(status).split(',').includes(x.status))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ blob, ...rest }) => rest);
    },
    async getFile(id) {
      const it = await rq((await store('readonly')).get(id));
      if (!it || !it.blob) throw new Error('파일 없음(이미 파기됨)');
      return it.blob;
    },
    async setStatus(id, status, side = '') {
      const it = await rq((await store('readonly')).get(id));
      if (!it) return { ok: false };
      it.status = status; it.updatedAt = Date.now();
      if (side) it.side = side;
      if (status === 'rejected' || status === 'played') { delete it.blob; it.message = ''; } // 즉시 파기
      await rq((await store('readwrite')).put(it));
      return { ok: true };
    },
    async status(id) {
      const items = await all();
      const me = items.find(x => x.id === id);
      if (!me) throw new Error('없음');
      const position = me.status === 'approved'
        ? items.filter(x => x.status === 'approved' && x.createdAt < me.createdAt).length + 1 : 0;
      return { ok: true, status: me.status, position, side: me.side };
    },
  };
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
