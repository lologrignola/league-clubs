-- Main club (club tags) — one primary club per player for gold nickname tag

create table if not exists public.player_main_club (
  puuid text primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index if not exists player_main_club_club_id_idx on public.player_main_club (club_id);

alter table public.player_main_club enable row level security;
revoke all on table public.player_main_club from anon, authenticated;

create or replace function public.set_main_club(p_puuid text, p_club_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club public.clubs%rowtype;
begin
  if p_puuid is null or trim(p_puuid) = '' then
    raise exception 'Invalid player identity';
  end if;

  if p_club_id is null then
    raise exception 'Club is required';
  end if;

  perform public.check_rate_limit('main_club:' || p_puuid, 30, interval '1 hour');

  if not public.is_club_member(p_club_id, p_puuid) then
    raise exception 'Not a member of this club';
  end if;

  select * into v_club from public.clubs where id = p_club_id;
  if not found then
    raise exception 'Club not found';
  end if;

  insert into public.player_main_club (puuid, club_id, updated_at)
  values (p_puuid, p_club_id, now())
  on conflict (puuid) do update
    set club_id = excluded.club_id,
        updated_at = now();

  return json_build_object(
    'club_id', v_club.id,
    'tag', v_club.tag,
    'name', v_club.name
  );
end;
$$;

create or replace function public.clear_main_club(p_puuid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_puuid is null or trim(p_puuid) = '' then
    raise exception 'Invalid player identity';
  end if;

  delete from public.player_main_club where puuid = p_puuid;
end;
$$;

create or replace function public.get_my_main_club(p_puuid text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result json;
begin
  if p_puuid is null or trim(p_puuid) = '' then
    return null;
  end if;

  select json_build_object(
    'club_id', c.id,
    'tag', c.tag,
    'name', c.name
  )
  into v_result
  from public.player_main_club pmc
  join public.clubs c on c.id = pmc.club_id
  join public.club_members cm on cm.club_id = c.id and cm.puuid = pmc.puuid
  where pmc.puuid = p_puuid;

  return v_result;
end;
$$;

create or replace function public.get_main_club_tags(p_puuids text[])
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_puuids is null or cardinality(p_puuids) = 0 then
    return '[]'::json;
  end if;

  -- Cap batch size to limit abuse
  if cardinality(p_puuids) > 200 then
    raise exception 'Too many players requested';
  end if;

  return (
    select coalesce(json_agg(
      json_build_object(
        'puuid', pmc.puuid,
        'tag', c.tag
      )
    ), '[]'::json)
    from public.player_main_club pmc
    join public.clubs c on c.id = pmc.club_id
    join public.club_members cm on cm.club_id = c.id and cm.puuid = pmc.puuid
    where pmc.puuid = any (p_puuids)
  );
end;
$$;

create or replace function public.get_my_clubs(p_puuid text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_puuid is null or trim(p_puuid) = '' then
    return '[]'::json;
  end if;

  return (
    select coalesce(json_agg(
      json_build_object(
        'id', c.id,
        'tag', c.tag,
        'name', c.name,
        'motd', c.motd,
        'invite_code', case when cm.role = 'owner' then c.invite_code else null end,
        'role', cm.role,
        'is_main', (pmc.club_id is not null)
      )
      order by c.name
    ), '[]'::json)
    from public.clubs c
    join public.club_members cm on cm.club_id = c.id
    left join public.player_main_club pmc on pmc.puuid = p_puuid and pmc.club_id = c.id
    where cm.puuid = p_puuid
  );
end;
$$;

create or replace function public.leave_club(p_club_id uuid, p_puuid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role
  from public.club_members
  where club_id = p_club_id and puuid = p_puuid;

  if v_role is null then
    raise exception 'Not a member of this club';
  end if;

  if v_role = 'owner' then
    raise exception 'Club owner cannot leave — transfer ownership or delete the club first';
  end if;

  delete from public.member_presence
  where club_id = p_club_id and puuid = p_puuid;

  delete from public.player_main_club
  where club_id = p_club_id and puuid = p_puuid;

  delete from public.club_members
  where club_id = p_club_id and puuid = p_puuid;
end;
$$;

create or replace function public.kick_member(
  p_club_id uuid,
  p_actor_puuid text,
  p_target_puuid text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  if p_target_puuid is null or trim(p_target_puuid) = '' then
    raise exception 'Member not found';
  end if;

  select role into v_actor_role
  from public.club_members
  where club_id = p_club_id and puuid = p_actor_puuid;

  if v_actor_role is null then
    raise exception 'Not a member of this club';
  end if;

  if v_actor_role <> 'owner' then
    raise exception 'Only the club owner can remove members';
  end if;

  if p_target_puuid = p_actor_puuid then
    raise exception 'Cannot remove yourself';
  end if;

  select role into v_target_role
  from public.club_members
  where club_id = p_club_id and puuid = p_target_puuid;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  if v_target_role = 'owner' then
    raise exception 'Cannot remove the club owner';
  end if;

  delete from public.member_presence
  where club_id = p_club_id and puuid = p_target_puuid;

  delete from public.player_main_club
  where club_id = p_club_id and puuid = p_target_puuid;

  delete from public.club_members
  where club_id = p_club_id and puuid = p_target_puuid;
end;
$$;

grant execute on function public.set_main_club(text, uuid) to anon, authenticated;
grant execute on function public.clear_main_club(text) to anon, authenticated;
grant execute on function public.get_my_main_club(text) to anon, authenticated;
grant execute on function public.get_main_club_tags(text[]) to anon, authenticated;
grant execute on function public.get_my_clubs(text) to anon, authenticated;
grant execute on function public.leave_club(uuid, text) to anon, authenticated;
grant execute on function public.kick_member(uuid, text, text) to anon, authenticated;
