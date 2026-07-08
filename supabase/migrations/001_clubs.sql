-- Core clubs schema + RPCs

create extension if not exists pgcrypto;

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  tag text not null,
  name text not null,
  motd text not null default '',
  invite_code text not null unique,
  owner_puuid text not null,
  created_at timestamptz not null default now(),
  constraint clubs_tag_format check (tag ~ '^[A-Z0-9]{3,5}$'),
  constraint clubs_name_len check (char_length(name) between 1 and 50),
  constraint clubs_motd_len check (char_length(motd) <= 200)
);

create unique index clubs_tag_unique_idx on public.clubs (upper(tag));

create table public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  puuid text not null,
  game_name text not null,
  game_tag text not null default '',
  role text not null default 'member' check (role in ('owner', 'member', 'admin')),
  joined_at timestamptz not null default now(),
  primary key (club_id, puuid)
);

create index club_members_puuid_idx on public.club_members (puuid);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  puuid text not null,
  game_name text not null,
  game_tag text not null default '',
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_len check (char_length(body) between 1 and 500)
);

create index messages_club_created_idx on public.messages (club_id, created_at desc);

create table public.club_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  invite_code text not null,
  created_by_puuid text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index club_invites_code_idx on public.club_invites (upper(invite_code));

create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..8 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.is_club_member(p_club_id uuid, p_puuid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_members
    where club_id = p_club_id
      and puuid = p_puuid
  );
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

  insert into public.clubs (tag, name, motd, invite_code, owner_puuid)
  values (v_tag, v_name, v_motd, v_code, p_owner_puuid)
  returning * into v_club;

  insert into public.club_members (club_id, puuid, game_name, game_tag, role)
  values (v_club.id, p_owner_puuid, coalesce(nullif(trim(p_owner_name), ''), 'Unknown'), coalesce(p_owner_tag, ''), 'owner');

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

  if v_code = '' then
    raise exception 'Invite code is required';
  end if;

  select count(*) into v_membership_count
  from public.club_members
  where puuid = p_puuid;

  if v_membership_count >= 20 then
    raise exception 'You can only join up to 20 clubs';
  end if;

  select * into v_club
  from public.clubs
  where invite_code = v_code;

  if not found then
    raise exception 'Invalid invite code';
  end if;

  if public.is_club_member(v_club.id, p_puuid) then
    raise exception 'Already a member of this club';
  end if;

  select count(*) into v_member_count
  from public.club_members
  where club_id = v_club.id;

  if v_member_count >= 100 then
    raise exception 'This club is full (100 members max)';
  end if;

  insert into public.club_members (club_id, puuid, game_name, game_tag, role)
  values (
    v_club.id,
    p_puuid,
    coalesce(nullif(trim(p_game_name), ''), 'Unknown'),
    coalesce(p_game_tag, ''),
    'member'
  );

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
        'role', cm.role
      )
      order by c.name
    ), '[]'::json)
    from public.clubs c
    join public.club_members cm on cm.club_id = c.id
    where cm.puuid = p_puuid
  );
end;
$$;

create or replace function public.get_club_members(p_club_id uuid, p_puuid text)
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
        'puuid', cm.puuid,
        'game_name', cm.game_name,
        'game_tag', cm.game_tag,
        'role', cm.role
      )
      order by case cm.role when 'owner' then 0 when 'admin' then 1 else 2 end, cm.game_name
    ), '[]'::json)
    from public.club_members cm
    where cm.club_id = p_club_id
  );
end;
$$;

create or replace function public.get_club_messages(
  p_club_id uuid,
  p_puuid text,
  p_limit int default 50,
  p_before timestamptz default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if not public.is_club_member(p_club_id, p_puuid) then
    raise exception 'Not a member of this club';
  end if;

  return (
    select coalesce(json_agg(row_to_json(m) order by m.created_at asc), '[]'::json)
    from (
      select id, club_id, puuid, game_name, game_tag, body, created_at
      from public.messages
      where club_id = p_club_id
        and (p_before is null or created_at < p_before)
      order by created_at desc
      limit v_limit
    ) m
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
  v_last timestamptz;
begin
  if not public.is_club_member(p_club_id, p_puuid) then
    raise exception 'Not a member of this club';
  end if;

  if v_body = '' then
    raise exception 'Message cannot be empty';
  end if;

  if char_length(v_body) > 500 then
    raise exception 'Message is too long (max 500 chars)';
  end if;

  select created_at into v_last
  from public.messages
  where club_id = p_club_id and puuid = p_puuid
  order by created_at desc
  limit 1;

  if v_last is not null and v_last > now() - interval '1 second' then
    raise exception 'Slow down — max 1 message per second';
  end if;

  insert into public.messages (club_id, puuid, game_name, game_tag, body)
  select p_club_id, p_puuid, cm.game_name, cm.game_tag, v_body
  from public.club_members cm
  where cm.club_id = p_club_id and cm.puuid = p_puuid
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

grant execute on function public.create_club(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.join_club(text, text, text, text) to anon, authenticated;
grant execute on function public.get_my_clubs(text) to anon, authenticated;
grant execute on function public.get_club_members(uuid, text) to anon, authenticated;
grant execute on function public.get_club_messages(uuid, text, int, timestamptz) to anon, authenticated;
grant execute on function public.send_message(uuid, text, text) to anon, authenticated;
