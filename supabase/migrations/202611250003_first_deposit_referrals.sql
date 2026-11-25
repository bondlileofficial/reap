create table public.deposit_referral_commissions (
  id uuid primary key default gen_random_uuid(),
  deposit_request_id uuid not null unique references public.deposit_requests (id) on delete restrict,
  source_user_id uuid not null unique references auth.users (id) on delete restrict,
  recipient_id uuid not null references auth.users (id) on delete restrict,
  rate numeric(5, 4) not null check (rate = 0.1000),
  deposit_amount_usd numeric(18, 2) not null check (deposit_amount_usd > 0),
  amount_usd numeric(18, 6) not null check (amount_usd > 0),
  created_at timestamptz not null default now()
);

create index deposit_referral_commissions_recipient_idx
  on public.deposit_referral_commissions (recipient_id, created_at desc);

alter table public.deposit_referral_commissions enable row level security;
revoke all on public.deposit_referral_commissions from public, anon, authenticated;

drop trigger on_verified_ad_revenue_confirmed on public.verified_ad_revenue;

create function public.award_first_deposit_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter_id uuid;
  commission_id uuid;
  commission_amount numeric(18, 6);
begin
  if new.status <> 'confirmed' or old.status = 'confirmed' then
    return new;
  end if;

  select referred_by into inviter_id
  from public.profiles
  where id = new.user_id
  for update;

  if not found then
    raise exception 'Profile not found for deposit referral.';
  end if;

  if inviter_id is null or exists (
    select 1
    from public.deposit_requests
    where user_id = new.user_id
      and status = 'confirmed'
      and id <> new.id
  ) then
    return new;
  end if;

  commission_amount := round(new.amount_usd * 0.10, 6);
  insert into public.deposit_referral_commissions (
    deposit_request_id, source_user_id, recipient_id, rate, deposit_amount_usd, amount_usd
  )
  values (
    new.id, new.user_id, inviter_id, 0.1000, new.amount_usd, commission_amount
  )
  on conflict (source_user_id) do nothing
  returning id into commission_id;

  if commission_id is not null then
    insert into public.ledger_entries (user_id, entry_type, amount_usd, status, reference)
    values (
      inviter_id, 'referral_commission', commission_amount, 'confirmed',
      'deposit-referral:' || commission_id::text
    );
  end if;

  return new;
end;
$$;

create trigger on_deposit_referral_confirmed
  after update of status on public.deposit_requests
  for each row execute function public.award_first_deposit_referral();

revoke all on function public.award_first_deposit_referral() from public, anon, authenticated;

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
  with me as (
    select (select auth.uid()) as user_id
  ),
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
    earnings.level_1_earnings + coalesce((
      select sum(c.amount_usd)
      from public.deposit_referral_commissions c, me
      where c.recipient_id = me.user_id
    ), 0),
    earnings.level_2_earnings,
    earnings.level_3_earnings
  from earnings;
$$;
