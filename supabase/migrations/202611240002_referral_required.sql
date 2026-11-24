create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter_id uuid;
  new_referral_code text;
  supplied_referral_code text;
begin
  supplied_referral_code := upper(nullif(trim(new.raw_user_meta_data ->> 'referral_code'), ''));

  if supplied_referral_code is null then
    raise exception 'A referral code is required';
  end if;

  select id into inviter_id
  from public.profiles
  where referral_code = supplied_referral_code;

  if inviter_id is null then
    raise exception 'Invalid referral code';
  end if;

  loop
    new_referral_code := upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12));
    exit when not exists (
      select 1 from public.profiles where referral_code = new_referral_code
    );
  end loop;

  insert into public.profiles (id, display_name, referral_code, referred_by)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    new_referral_code,
    inviter_id
  );
  return new;
end;
$$;
