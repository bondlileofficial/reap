alter table public.ledger_entries
  drop constraint if exists ledger_entries_entry_type_check,
  add constraint ledger_entries_entry_type_check
    check (entry_type in (
      'deposit',
      'task_reward',
      'referral_commission',
      'withdrawal',
      'package_purchase',
      'refund',
      'adjustment'
    ));

create or replace function public.confirmed_wallet_balance(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    case
      when entry_type in ('withdrawal', 'package_purchase') then -amount_usd
      else amount_usd
    end
  ), 0)
  from public.ledger_entries
  where user_id = p_user_id
    and status = 'confirmed';
$$;

revoke all on function public.confirmed_wallet_balance(uuid)
  from public, anon, authenticated;

create or replace function public.available_wallet_balance(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select floor(greatest(
    public.confirmed_wallet_balance(p_user_id)
      - coalesce((
        select sum(amount_usd)
        from public.withdrawal_requests
        where user_id = p_user_id
          and status in ('pending', 'processing')
      ), 0),
    0
  ) * 100) / 100;
$$;

revoke all on function public.available_wallet_balance(uuid)
  from public, anon, authenticated;

create or replace function public.get_my_available_wallet_balance()
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
begin
  if requesting_user is null then
    raise exception 'You must be signed in to view your wallet balance.';
  end if;

  return public.available_wallet_balance(requesting_user);
end;
$$;

revoke all on function public.get_my_available_wallet_balance()
  from public, anon;
grant execute on function public.get_my_available_wallet_balance()
  to authenticated;

create or replace function public.request_withdrawal(
  p_amount_usd numeric,
  p_network text,
  p_destination_address text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  account_balance numeric(18, 2);
  fee_amount numeric(18, 2);
  payout_amount numeric(18, 2);
  request_id uuid;
begin
  if requesting_user is null then
    raise exception 'You must be signed in to request a withdrawal.';
  end if;

  if p_amount_usd is null
    or p_amount_usd < 5
    or p_amount_usd <> round(p_amount_usd, 2) then
    raise exception 'Withdrawal amount must be at least $5.00 and use cents.';
  end if;

  if p_network is null or p_network not in ('TRC20', 'BEP20') then
    raise exception 'Unsupported withdrawal network.';
  end if;

  if p_destination_address is null
    or length(trim(p_destination_address)) not between 20 and 128 then
    raise exception 'Wallet address must be between 20 and 128 characters.';
  end if;

  perform 1
  from public.profiles
  where id = requesting_user
  for update;

  if not found then
    raise exception 'User profile was not found.';
  end if;

  account_balance := public.available_wallet_balance(requesting_user);
  if p_amount_usd > account_balance then
    raise exception 'Withdrawal amount exceeds your available balance.';
  end if;

  fee_amount := round(p_amount_usd * 0.05, 2);
  payout_amount := p_amount_usd - fee_amount;

  insert into public.withdrawal_requests (
    user_id, amount_usd, asset, network, destination_address,
    status, fee_usd, payout_usd
  )
  values (
    requesting_user, p_amount_usd, 'USDT', p_network, trim(p_destination_address),
    'pending', fee_amount, payout_amount
  )
  returning id into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_withdrawal(numeric, text, text)
  from public, anon;
grant execute on function public.request_withdrawal(numeric, text, text)
  to authenticated;

create or replace function public.purchase_package(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  package_amount numeric(18, 2);
  package_term_days integer;
  account_balance numeric(18, 2);
  package_id uuid;
begin
  if requesting_user is null then
    raise exception 'You must be signed in to purchase a package.';
  end if;

  if p_plan_id is null then
    raise exception 'Select a package before purchasing.';
  end if;

  perform 1
  from public.profiles
  where id = requesting_user
  for update;

  if not found then
    raise exception 'User profile was not found.';
  end if;

  select amount_usd, term_days
  into package_amount, package_term_days
  from public.plans
  where id = p_plan_id
    and active;

  if not found then
    raise exception 'This package is not available.';
  end if;

  account_balance := public.available_wallet_balance(requesting_user);
  if package_amount > account_balance then
    raise exception 'Your available wallet balance is not enough for this package.';
  end if;

  insert into public.user_packages (
    user_id, plan_id, status, starts_at, ends_at
  )
  values (
    requesting_user,
    p_plan_id,
    'active',
    now(),
    now() + make_interval(days => package_term_days)
  )
  returning id into package_id;

  insert into public.ledger_entries (
    user_id, entry_type, amount_usd, status, reference
  )
  values (
    requesting_user,
    'package_purchase',
    package_amount,
    'confirmed',
    'package-purchase:' || package_id::text
  );

  return package_id;
end;
$$;

revoke all on function public.purchase_package(uuid) from public, anon;
grant execute on function public.purchase_package(uuid) to authenticated;

create or replace function public.approve_withdrawal_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  withdrawal_request public.withdrawal_requests%rowtype;
  account_balance numeric(18, 6);
  other_reserved_amount numeric(18, 2);
begin
  if not public.is_transaction_reviewer() then
    raise exception 'You are not authorized to approve withdrawal requests.';
  end if;

  select *
  into withdrawal_request
  from public.withdrawal_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Withdrawal request not found.';
  end if;
  if withdrawal_request.status not in ('pending', 'processing') then
    raise exception 'Withdrawal request is not awaiting approval.';
  end if;

  perform 1
  from public.profiles
  where id = withdrawal_request.user_id
  for update;

  account_balance := public.confirmed_wallet_balance(withdrawal_request.user_id);

  select coalesce(sum(amount_usd), 0)
  into other_reserved_amount
  from public.withdrawal_requests
  where user_id = withdrawal_request.user_id
    and id <> withdrawal_request.id
    and status in ('pending', 'processing');

  if withdrawal_request.amount_usd > account_balance - other_reserved_amount then
    raise exception 'The user no longer has enough available balance for this withdrawal.';
  end if;

  insert into public.ledger_entries (
    user_id, entry_type, amount_usd, status, reference
  )
  values (
    withdrawal_request.user_id,
    'withdrawal',
    withdrawal_request.amount_usd,
    'confirmed',
    'withdrawal-request:' || withdrawal_request.id::text
  );

  update public.withdrawal_requests
  set status = 'paid'
  where id = withdrawal_request.id;

  return withdrawal_request.id;
end;
$$;
