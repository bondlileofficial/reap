alter table public.profiles
  add column referral_code text,
  add column referred_by uuid references public.profiles (id) on delete set null;

update public.profiles
set referral_code = upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12))
where referral_code is null;

alter table public.profiles
  alter column referral_code set not null,
  add constraint profiles_referral_code_key unique (referral_code),
  add constraint profiles_not_self_referred check (referred_by is null or referred_by <> id);

create index profiles_referred_by_idx on public.profiles (referred_by);

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

  if supplied_referral_code is not null then
    select id into inviter_id
    from public.profiles
    where referral_code = supplied_referral_code;

    if inviter_id is null then
      raise exception 'Invalid referral code';
    end if;
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

alter table public.ledger_entries
  drop constraint if exists ledger_entries_entry_type_check,
  add constraint ledger_entries_entry_type_check
    check (entry_type in ('deposit', 'task_reward', 'referral_commission', 'withdrawal', 'refund', 'adjustment'));

create table public.verified_ad_revenue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  event_reference text not null unique,
  revenue_usd numeric(18, 6) not null check (revenue_usd > 0),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected')),
  created_at timestamptz not null default now()
);

create table public.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  revenue_id uuid not null references public.verified_ad_revenue (id) on delete restrict,
  recipient_id uuid not null references auth.users (id) on delete restrict,
  source_user_id uuid not null references auth.users (id) on delete restrict,
  level integer not null check (level between 1 and 3),
  rate numeric(5, 4) not null check (rate in (0.1000, 0.0500, 0.0300)),
  base_revenue_usd numeric(18, 6) not null check (base_revenue_usd > 0),
  amount_usd numeric(18, 6) not null check (amount_usd > 0),
  created_at timestamptz not null default now(),
  unique (revenue_id, level)
);

create index referral_commissions_recipient_idx
  on public.referral_commissions (recipient_id, level, created_at desc);

create function public.award_referral_commissions()
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
begin
  if new.status <> 'confirmed'
    or (tg_op = 'UPDATE' and old.status = 'confirmed') then
    return new;
  end if;

  select referred_by into current_referrer
  from public.profiles
  where id = new.user_id;

  for commission_level in 1..3 loop
    exit when current_referrer is null;

    commission_rate := case commission_level
      when 1 then 0.1000
      when 2 then 0.0500
      else 0.0300
    end;
    commission_id := null;

    if round(new.revenue_usd * commission_rate, 6) > 0 then
      insert into public.referral_commissions (
        revenue_id, recipient_id, source_user_id, level, rate,
        base_revenue_usd, amount_usd
      )
      values (
        new.id, current_referrer, new.user_id, commission_level,
        commission_rate, new.revenue_usd,
        round(new.revenue_usd * commission_rate, 6)
      )
      on conflict (revenue_id, level) do nothing
      returning id into commission_id;

      if commission_id is not null then
        insert into public.ledger_entries (
          user_id, entry_type, amount_usd, status, reference
        )
        values (
          current_referrer, 'referral_commission',
          round(new.revenue_usd * commission_rate, 6), 'confirmed',
          'referral:' || commission_id::text
        );
      end if;
    end if;

    select referred_by into current_referrer
    from public.profiles
    where id = current_referrer;
  end loop;

  return new;
end;
$$;

create trigger on_verified_ad_revenue_confirmed
  after insert or update of status on public.verified_ad_revenue
  for each row execute procedure public.award_referral_commissions();

create function public.get_my_referral_summary()
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
  with me as (
    select (select auth.uid()) as user_id
  ),
  first_level as (
    select p.id
    from public.profiles p, me
    where p.referred_by = me.user_id
  ),
  second_level as (
    select p.id
    from public.profiles p
    join first_level f on p.referred_by = f.id
  ),
  third_level as (
    select p.id
    from public.profiles p
    join second_level s on p.referred_by = s.id
  ),
  earnings as (
    select
      coalesce(sum(c.amount_usd) filter (where c.level = 1), 0) as level_1_earnings,
      coalesce(sum(c.amount_usd) filter (where c.level = 2), 0) as level_2_earnings,
      coalesce(sum(c.amount_usd) filter (where c.level = 3), 0) as level_3_earnings
    from public.referral_commissions c, me
    where c.recipient_id = me.user_id
  )
  select
    (select count(*) from first_level),
    (select count(*) from second_level),
    (select count(*) from third_level),
    earnings.level_1_earnings,
    earnings.level_2_earnings,
    earnings.level_3_earnings
  from earnings;
$$;

alter table public.verified_ad_revenue enable row level security;
alter table public.referral_commissions enable row level security;

revoke all on public.verified_ad_revenue, public.referral_commissions
  from anon, authenticated;

revoke all on function public.get_my_referral_summary() from public, anon;
grant execute on function public.get_my_referral_summary() to authenticated;
