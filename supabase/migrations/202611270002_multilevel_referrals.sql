alter table public.deposit_referral_commissions
  add column level integer not null default 1 check (level between 1 and 3),
  drop constraint deposit_referral_commissions_deposit_request_id_key,
  drop constraint deposit_referral_commissions_source_user_id_key,
  drop constraint deposit_referral_commissions_rate_check,
  add constraint deposit_referral_commissions_source_level_key unique (source_user_id, level),
  add constraint deposit_referral_commissions_deposit_level_key unique (deposit_request_id, level),
  add constraint deposit_referral_commissions_level_rate_check check (
    (level = 1 and rate = 0.1000) or
    (level = 2 and rate = 0.0500) or
    (level = 3 and rate = 0.0300)
  );

alter table public.profiles
  add column share_referral_contact boolean not null default false;

grant update (share_referral_contact) on public.profiles to authenticated;

create or replace function public.award_first_deposit_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_referrer uuid;
  commission_level integer;
  commission_rate numeric(5, 4);
  commission_id uuid;
  commission_amount numeric(18, 6);
  visited uuid[] := array[new.user_id];
begin
  if new.status <> 'confirmed' or old.status = 'confirmed' then
    return new;
  end if;

  select referred_by into current_referrer
  from public.profiles where id = new.user_id for update;
  if not found then
    raise exception 'Profile not found for deposit referral.';
  end if;

  if current_referrer is null or exists (
    select 1 from public.deposit_requests
    where user_id = new.user_id and status = 'confirmed' and id <> new.id
  ) then
    return new;
  end if;

  for commission_level in 1..3 loop
    exit when current_referrer is null or current_referrer = any(visited);
    visited := array_append(visited, current_referrer);
    commission_rate := case commission_level
      when 1 then 0.1000
      when 2 then 0.0500
      else 0.0300
    end;
    commission_amount := round(new.amount_usd * commission_rate, 6);
    commission_id := null;

    insert into public.deposit_referral_commissions (
      deposit_request_id, source_user_id, recipient_id, level, rate, deposit_amount_usd, amount_usd
    )
    values (
      new.id, new.user_id, current_referrer, commission_level,
      commission_rate, new.amount_usd, commission_amount
    )
    on conflict (source_user_id, level) do nothing
    returning id into commission_id;

    if commission_id is not null then
      insert into public.ledger_entries (user_id, entry_type, amount_usd, status, reference)
      values (
        current_referrer, 'referral_commission', commission_amount, 'confirmed',
        'deposit-referral:' || commission_id::text
      );
    end if;

    select referred_by into current_referrer
    from public.profiles where id = current_referrer;
  end loop;
  return new;
end;
$$;

create or replace function public.get_my_referral_summary()
returns table (
  level_1_count bigint,
  level_2_count bigint,
  level_3_count bigint,
  level_1_earnings numeric,
  level_2_earnings numeric,
  level_3_earnings numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as user_id),
  first_level as (
    select p.id from public.profiles p, me where p.referred_by = me.user_id
  ),
  second_level as (
    select p.id from public.profiles p join first_level f on p.referred_by = f.id
  ),
  third_level as (
    select p.id from public.profiles p join second_level s on p.referred_by = s.id
  ),
  earnings as (
    select level, amount_usd from public.referral_commissions where recipient_id = (select user_id from me)
    union all
    select level, amount_usd from public.deposit_referral_commissions where recipient_id = (select user_id from me)
  )
  select
    (select count(*) from first_level),
    (select count(*) from second_level),
    (select count(*) from third_level),
    coalesce(sum(amount_usd) filter (where level = 1), 0),
    coalesce(sum(amount_usd) filter (where level = 2), 0),
    coalesce(sum(amount_usd) filter (where level = 3), 0)
  from earnings;
$$;

create function public.get_my_referral_contacts()
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
  where p.share_referral_contact
  order by d.level, p.display_name, p.id;
$$;

revoke all on function public.get_my_referral_contacts() from public, anon;
grant execute on function public.get_my_referral_contacts() to authenticated;
