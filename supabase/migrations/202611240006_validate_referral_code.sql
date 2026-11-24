create or replace function public.is_valid_referral_code(p_referral_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where referral_code = pg_catalog.upper(pg_catalog.btrim(p_referral_code))
  );
$$;

revoke all on function public.is_valid_referral_code(text) from public;
grant execute on function public.is_valid_referral_code(text) to anon, authenticated;
