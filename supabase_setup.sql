-- 「우리 새해 방명록」 Supabase 중간지점 설정
-- Supabase 대시보드 → SQL Editor에 전체 붙여넣고 Run

-- 1) 접수 목록
create table if not exists public.guestbook (
  id text primary key default ('g' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 9)),
  created_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'playing', 'played')),
  path text,
  mime text,
  message text check (message is null or char_length(message) <= 20),
  side text default '',
  updated_at timestamptz not null default now()
);
alter table public.guestbook enable row level security;
grant select, insert on public.guestbook to anon, authenticated;

-- 폰: 검수 대기 상태로만 접수 가능 / 조회는 누구나(데모용)
drop policy if exists gb_insert on public.guestbook;
create policy gb_insert on public.guestbook for insert to anon, authenticated
  with check (status = 'pending');
drop policy if exists gb_select on public.guestbook;
create policy gb_select on public.guestbook for select to anon, authenticated
  using (true);
-- 상태 변경(승인·반려·송출)은 스태프 키가 있는 함수로만

-- 2) 스태프 키 (콘솔·송출 PC 주소에 ?key= 로 전달)
create table if not exists public.app_secret (k text primary key, v text not null);
alter table public.app_secret enable row level security;
revoke all on public.app_secret from anon, authenticated;
insert into public.app_secret (k, v)
  values ('staff_key', substr(md5(random()::text || clock_timestamp()::text), 1, 16))
  on conflict (k) do nothing;

create or replace function public.staff_set_status(p_key text, p_id text, p_status text, p_side text default '')
returns text
language plpgsql security definer set search_path = public
as $$
declare v_path text;
begin
  if p_key is distinct from (select v from app_secret where k = 'staff_key') then
    raise exception 'unauthorized';
  end if;
  if p_status not in ('pending', 'approved', 'rejected', 'playing', 'played') then
    raise exception 'bad status';
  end if;
  select path into v_path from guestbook where id = p_id;
  if not found then raise exception '없음'; end if;
  if p_status in ('rejected', 'played') then
    -- 즉시 파기: 파일 경로·문구 삭제 후, 지울 파일 경로를 돌려줌
    update guestbook set status = p_status, side = coalesce(nullif(p_side, ''), side),
      path = null, message = '', updated_at = now() where id = p_id;
    return v_path;
  end if;
  update guestbook set status = p_status, side = coalesce(nullif(p_side, ''), side),
    updated_at = now() where id = p_id;
  return null;
end $$;
revoke all on function public.staff_set_status(text, text, text, text) from public;
grant execute on function public.staff_set_status(text, text, text, text) to anon, authenticated;

-- 3) 실시간 알림 (새 접수·상태 변경을 콘솔·송출 PC·폰에 즉시 전달)
do $$ begin
  alter publication supabase_realtime add table public.guestbook;
exception when duplicate_object then null; end $$;

-- 4) 영상 저장소 (최대 10MB, 영상만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('guestbook', 'guestbook', true, 10485760, array['video/mp4', 'video/webm', 'video/quicktime'])
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists gb_obj_insert on storage.objects;
create policy gb_obj_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'guestbook');
drop policy if exists gb_obj_select on storage.objects;
create policy gb_obj_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'guestbook');
drop policy if exists gb_obj_delete on storage.objects;
create policy gb_obj_delete on storage.objects for delete to anon, authenticated
  using (bucket_id = 'guestbook');

-- 5) 스태프 키 확인
select v as staff_key from public.app_secret where k = 'staff_key';
