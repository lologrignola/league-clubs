-- Member presence heartbeat

create table public.member_presence (
  club_id uuid not null references public.clubs(id) on delete cascade,
  puuid text not null,
  status text not null default 'offline' check (status in ('online', 'ingame', 'away', 'offline')),
  detail text not null default '',
  updated_at timestamptz not null default now(),
  primary key (club_id, puuid)
);

create or replace function public.upsert_presence(
  p_club_id uuid,
  p_puuid text,
  p_status text,
  p_detail text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(coalesce(p_status, 'offline'));
begin
  if not public.is_club_member(p_club_id, p_puuid) then
    raise exception 'Not a member of this club';
  end if;

  if v_status not in ('online', 'ingame', 'away', 'offline') then
    v_status := 'offline';
  end if;

  insert into public.member_presence (club_id, puuid, status, detail, updated_at)
  values (p_club_id, p_puuid, v_status, left(coalesce(p_detail, ''), 120), now())
  on conflict (club_id, puuid)
  do update set
    status = excluded.status,
    detail = excluded.detail,
    updated_at = now();
end;
$$;

create or replace function public.get_club_presence(p_club_id uuid, p_puuid text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_club_member(p_club_id, p_puuid) then
    raise exception 'Not a member of this club';
  end if;

  return (
    select coalesce(json_agg(
      json_build_object(
        'puuid', p.puuid,
        'status', case
          when p.updated_at < now() - interval '3 minutes' then 'offline'
          else p.status
        end,
        'detail', case
          when p.updated_at < now() - interval '3 minutes' then ''
          else p.detail
        end,
        'updated_at', p.updated_at
      )
    ), '[]'::json)
    from public.member_presence p
    where p.club_id = p_club_id
  );
end;
$$;

grant execute on function public.upsert_presence(uuid, text, text, text) to anon, authenticated;
grant execute on function public.get_club_presence(uuid, text) to anon, authenticated;
