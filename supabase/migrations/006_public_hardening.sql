-- Public release hardening (apply on existing LeagueClubs DB)
-- Locks direct table access, adds rate limits + quotas

create table if not exists public.rpc_rate_limits (
  bucket text primary key,
  window_start timestamptz not null default now(),
  hit_count int not null default 1
);

alter table public.rpc_rate_limits enable row level security;
revoke all on table public.rpc_rate_limits from anon, authenticated;

create or replace function public.check_rate_limit(
  p_bucket text,
  p_max_hits int,
  p_window interval
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.rpc_rate_limits%rowtype;
begin
  if p_bucket is null or trim(p_bucket) = '' then
    return;
  end if;

  select * into v_row
  from public.rpc_rate_limits
  where bucket = p_bucket
  for update;

  if not found then
    insert into public.rpc_rate_limits (bucket, window_start, hit_count)
    values (p_bucket, v_now, 1);
    return;
  end if;

  if v_row.window_start < v_now - p_window then
    update public.rpc_rate_limits
    set window_start = v_now, hit_count = 1
    where bucket = p_bucket;
    return;
  end if;

  if v_row.hit_count >= p_max_hits then
    raise exception 'Rate limit exceeded — try again later';
  end if;

  update public.rpc_rate_limits
  set hit_count = hit_count + 1
  where bucket = p_bucket;
end;
$$;

create or replace function public.create_club(
  p_tag text,
  p_name text,
  p_motd text,
  p_owner_puuid text,
  p_owner_name text,
  p_owner_tag text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag text := upper(trim(coalesce(p_tag, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_motd text := trim(coalesce(p_motd, ''));
  v_owned int;
  v_club public.clubs%rowtype;
  v_code text;
begin
  if p_owner_puuid is null or trim(p_owner_puuid) = '' then
    raise exception 'Invalid player identity';
  end if;

  perform public.check_rate_limit('create:' || p_owner_puuid, 5, interval '1 day');

  if v_tag !~ '^[A-Z0-9]{3,5}$' then
    raise exception 'Tag must be 3–5 letters or numbers';
  end if;

  if v_name = '' then
    raise exception 'Club name is required';
  end if;

  if char_length(v_motd) > 200 then
    raise exception 'MOTD is too long (max 200 chars)';
  end if;

  select count(*) into v_owned
  from public.club_members
  where puuid = p_owner_puuid and role = 'owner';

  if v_owned >= 5 then
    raise exception 'You can only own up to 5 clubs';
  end if;

  if exists (select 1 from public.clubs where upper(tag) = v_tag) then
    raise exception 'Tag already taken';
  end if;

  loop
    v_code := public.generate_invite_code();
    exit when not exists (select 1 from public.clubs where invite_code = v_code);
  end loop;

  insert into public.clubs (tag, name, motd, owner_puuid, invite_code)
  values (v_tag, v_name, v_motd, p_owner_puuid, v_code)
  returning * into v_club;

  insert into public.club_members (club_id, puuid, game_name, game_tag, role)
  values (
    v_club.id,
    p_owner_puuid,
    coalesce(nullif(trim(p_owner_name), ''), 'Unknown'),
    coalesce(p_owner_tag, ''),
    'owner'
  );

  insert into public.club_invites (club_id, invite_code, created_by_puuid)
  values (v_club.id, v_code, p_owner_puuid);

  return json_build_object(
    'id', v_club.id,
    'tag', v_club.tag,
    'name', v_club.name,
    'motd', v_club.motd,
    'invite_code', v_club.invite_code,
    'role', 'owner'
  );
end;
$$;

create or replace function public.join_club(
  p_invite_code text,
  p_puuid text,
  p_game_name text,
  p_game_tag text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_invite_code, '')));
  v_club public.clubs%rowtype;
  v_membership_count int;
  v_member_count int;
begin
  if p_puuid is null or trim(p_puuid) = '' then
    raise exception 'Invalid player identity';
  end if;

  perform public.check_rate_limit('join:' || p_puuid, 20, interval '1 hour');

  if v_code = '' then
    raise exception 'Invite code is required';
  end if;

  select * into v_club
  from public.clubs
  where invite_code = v_code;

  if not found then
    raise exception 'Invalid invite code';
  end if;

  select count(*) into v_membership_count
  from public.club_members
  where puuid = p_puuid;

  if v_membership_count >= 20 and not public.is_club_member(v_club.id, p_puuid) then
    raise exception 'You can only join up to 20 clubs';
  end if;

  select count(*) into v_member_count
  from public.club_members
  where club_id = v_club.id;

  if v_member_count >= 100 and not public.is_club_member(v_club.id, p_puuid) then
    raise exception 'This club is full (100 members max)';
  end if;

  insert into public.club_members (club_id, puuid, game_name, game_tag, role)
  values (
    v_club.id,
    p_puuid,
    coalesce(nullif(trim(p_game_name), ''), 'Unknown'),
    coalesce(p_game_tag, ''),
    'member'
  )
  on conflict (club_id, puuid) do update
    set game_name = excluded.game_name,
        game_tag = excluded.game_tag;

  return json_build_object(
    'id', v_club.id,
    'tag', v_club.tag,
    'name', v_club.name,
    'motd', v_club.motd,
    'invite_code', v_club.invite_code,
    'role', 'member'
  );
end;
$$;

drop function if exists public.search_clubs(text);

create or replace function public.search_clubs(p_query text, p_puuid text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_bucket text;
begin
  if char_length(v_query) < 2 then
    return '[]'::json;
  end if;

  v_bucket := 'search:' || coalesce(nullif(trim(p_puuid), ''), 'anon');
  perform public.check_rate_limit(v_bucket, 30, interval '1 minute');

  return (
    select coalesce(json_agg(row_to_json(t)), '[]'::json)
    from (
      select
        c.id,
        c.tag,
        c.name,
        c.motd,
        (select count(*)::int from public.club_members m where m.club_id = c.id) as member_count
      from public.clubs c
      where upper(c.tag) like upper(v_query) || '%'
         or c.name ilike '%' || v_query || '%'
      order by
        case when upper(c.tag) = upper(v_query) then 0 else 1 end,
        c.name
      limit 20
    ) t
  );
end;
$$;

create or replace function public.send_message(
  p_club_id uuid,
  p_puuid text,
  p_body text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := trim(coalesce(p_body, ''));
  v_msg public.messages%rowtype;
  v_member public.club_members%rowtype;
begin
  if not public.is_club_member(p_club_id, p_puuid) then
    raise exception 'Not a member of this club';
  end if;

  perform public.check_rate_limit('msg:' || p_club_id::text || ':' || p_puuid, 1, interval '1 second');
  perform public.check_rate_limit('msg-global:' || p_puuid, 60, interval '1 minute');

  if v_body = '' then
    raise exception 'Message cannot be empty';
  end if;

  if char_length(v_body) > 500 then
    raise exception 'Message too long (max 500 characters)';
  end if;

  select * into v_member
  from public.club_members
  where club_id = p_club_id and puuid = p_puuid;

  insert into public.messages (club_id, puuid, game_name, game_tag, body)
  values (p_club_id, p_puuid, v_member.game_name, v_member.game_tag, v_body)
  returning * into v_msg;

  return json_build_object(
    'id', v_msg.id,
    'club_id', v_msg.club_id,
    'puuid', v_msg.puuid,
    'game_name', v_msg.game_name,
    'game_tag', v_msg.game_tag,
    'body', v_msg.body,
    'created_at', v_msg.created_at
  );
end;
$$;

create or replace function public.regenerate_invite(p_club_id uuid, p_puuid text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_role text;
begin
  select role into v_role
  from public.club_members
  where club_id = p_club_id and puuid = p_puuid;

  if v_role is null then
    raise exception 'Not a member of this club';
  end if;

  if v_role <> 'owner' then
    raise exception 'Only the club owner can regenerate invite codes';
  end if;

  loop
    v_code := public.generate_invite_code();
    exit when not exists (
      select 1 from public.clubs where invite_code = v_code and id <> p_club_id
    );
  end loop;

  update public.clubs set invite_code = v_code where id = p_club_id;

  insert into public.club_invites (club_id, invite_code, created_by_puuid)
  values (p_club_id, v_code, p_puuid);

  return v_code;
end;
$$;

drop policy if exists anon_read_members on public.club_members;
drop policy if exists anon_read_clubs on public.clubs;
drop policy if exists anon_read_presence on public.member_presence;
drop policy if exists anon_read_messages on public.messages;

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.member_presence enable row level security;
alter table public.messages enable row level security;
alter table public.club_invites enable row level security;

revoke all on table public.clubs from anon, authenticated;
revoke all on table public.club_members from anon, authenticated;
revoke all on table public.member_presence from anon, authenticated;
revoke all on table public.club_invites from anon, authenticated;

revoke insert, update, delete on table public.messages from anon, authenticated;
grant select on table public.messages to anon, authenticated;

drop policy if exists messages_realtime_select on public.messages;
create policy messages_realtime_select
  on public.messages
  for select
  to anon, authenticated
  using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

grant execute on function public.search_clubs(text, text) to anon, authenticated;
