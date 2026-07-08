-- Re-run if members always show offline (extends heartbeat window to 3 min)
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
