create or replace function public.get_my_referral_contacts()
returns table (level integer, display_name text, email text, phone_number text)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive downline as (
    select p.id, 1 as level, array[(select auth.uid()), p.id] as visited
    from public.profiles p where p.referred_by = (select auth.uid())
    union all
    select p.id, d.level + 1, d.visited || p.id
    from public.profiles p join downline d on p.referred_by = d.id
    where d.level < 3 and not p.id = any(d.visited)
  )
  select d.level, p.display_name, u.email::text, p.phone_number
  from downline d
  join public.profiles p on p.id = d.id
  join auth.users u on u.id = d.id
  order by d.level, p.display_name, p.id;
$$;

revoke all on function public.get_my_referral_contacts() from public, anon;
grant execute on function public.get_my_referral_contacts() to authenticated;
