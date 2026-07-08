-- Leave club + owner kick member
-- Run after 004_presence_timeout.sql

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

  delete from public.club_members
  where club_id = p_club_id and puuid = p_target_puuid;
end;
$$;

grant execute on function public.leave_club(uuid, text) to anon, authenticated;
grant execute on function public.kick_member(uuid, text, text) to anon, authenticated;
