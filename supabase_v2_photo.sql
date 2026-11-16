-- 「우리 새해 방명록」 v2: 사진 모드 + 운영 설정(사진 전용 전환)
-- Supabase 대시보드 → SQL Editor에 붙여넣고 Run (기존 supabase_setup.sql 실행 후)

-- 5) 저장소에 사진 허용
update storage.buckets
  set allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/webp', 'image/png']
  where id = 'guestbook';

-- 6) 운영 설정 — capture_mode: 'both'(영상+사진) | 'photo'(사진만, 네트워크 혼잡 시)
create table if not exists public.app_config (
  k text primary key,
  v text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
grant select on public.app_config to anon, authenticated;
drop policy if exists cfg_select on public.app_config;
create policy cfg_select on public.app_config for select to anon, authenticated using (true);
insert into public.app_config (k, v) values ('capture_mode', 'both') on conflict (k) do nothing;

-- 설정 변경은 스태프 키가 있는 함수로만 (검수 콘솔 버튼)
create or replace function public.staff_set_config(p_key text, p_k text, p_v text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_key is distinct from (select v from app_secret where k = 'staff_key') then
    raise exception 'unauthorized';
  end if;
  if p_k = 'capture_mode' and p_v not in ('both', 'photo') then
    raise exception 'bad value';
  end if;
  insert into app_config (k, v, updated_at) values (p_k, p_v, now())
    on conflict (k) do update set v = excluded.v, updated_at = now();
end $$;
revoke all on function public.staff_set_config(text, text, text) from public;
grant execute on function public.staff_set_config(text, text, text) to anon, authenticated;

-- 실시간 알림 (콘솔에서 바꾸면 폰에 즉시 반영)
do $$ begin
  alter publication supabase_realtime add table public.app_config;
exception when duplicate_object then null; end $$;
