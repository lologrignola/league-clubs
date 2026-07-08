-- Global default lounge: League Clubs

do $$
declare
  v_club_id uuid;
begin
  select id into v_club_id
  from public.clubs
  where upper(tag) = 'LEAGC';

  if v_club_id is null then
    insert into public.clubs (tag, name, motd, invite_code, owner_puuid)
    values (
      'LEAGC',
      'League Clubs',
      'Welcome to the global League Clubs lounge. Say hi!',
      'LEAGCLUB',
      'system:league-clubs'
    )
    returning id into v_club_id;

    insert into public.club_members (club_id, puuid, game_name, game_tag, role)
    values (v_club_id, 'system:league-clubs', 'League Clubs', 'GLOBAL', 'owner');

    insert into public.club_invites (club_id, invite_code, created_by_puuid)
    values (v_club_id, 'LEAGCLUB', 'system:league-clubs');
  end if;
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
  v_max_members int;
  v_is_default boolean;
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

  v_is_default := upper(v_club.tag) = 'LEAGC';
  v_max_members := case when v_is_default then 10000 else 100 end;

  select count(*) into v_membership_count
  from public.club_members
  where puuid = p_puuid;

  if v_membership_count >= 20
     and not public.is_club_member(v_club.id, p_puuid)
     and not v_is_default then
    raise exception 'You can only join up to 20 clubs';
  end if;

  select count(*) into v_member_count
  from public.club_members
  where club_id = v_club.id;

  if v_member_count >= v_max_members and not public.is_club_member(v_club.id, p_puuid) then
    raise exception 'This club is full (% members max)', v_max_members;
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
