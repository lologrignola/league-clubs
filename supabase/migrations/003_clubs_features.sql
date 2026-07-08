-- Search, MOTD, invite regeneration

create or replace function public.search_clubs(p_query text, p_puuid text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
begin
  if char_length(v_query) < 2 then
    return '[]'::json;
  end if;

  return (
    select coalesce(json_agg(row_to_json(r)), '[]'::json)
    from (
      select
        c.id,
        c.tag,
        c.name,
        c.motd,
        count(cm.puuid)::int as member_count
      from public.clubs c
      left join public.club_members cm on cm.club_id = c.id
      where c.tag ilike '%' || upper(v_query) || '%'
         or c.name ilike '%' || v_query || '%'
      group by c.id
      order by count(cm.puuid) desc, c.name asc
      limit 20
    ) r
  );
end;
$$;

create or replace function public.update_club_motd(
  p_club_id uuid,
  p_puuid text,
  p_motd text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motd text := trim(coalesce(p_motd, ''));
  v_role text;
begin
  select role into v_role
  from public.club_members
  where club_id = p_club_id and puuid = p_puuid;

  if v_role is null then
    raise exception 'Not a member of this club';
  end if;

  if v_role not in ('owner', 'admin') then
    raise exception 'Only owner or admin can edit MOTD';
  end if;

  if char_length(v_motd) > 200 then
    raise exception 'MOTD is too long (max 200 chars)';
  end if;

  update public.clubs
  set motd = v_motd
  where id = p_club_id;

  return json_build_object('motd', v_motd);
end;
$$;

create or replace function public.regenerate_invite(p_club_id uuid, p_puuid text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_code text;
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

  update public.clubs
  set invite_code = v_code
  where id = p_club_id;

  insert into public.club_invites (club_id, invite_code, created_by_puuid)
  values (p_club_id, v_code, p_puuid);

  return v_code;
end;
$$;

grant execute on function public.search_clubs(text, text) to anon, authenticated;
grant execute on function public.update_club_motd(uuid, text, text) to anon, authenticated;
grant execute on function public.regenerate_invite(uuid, text) to anon, authenticated;
