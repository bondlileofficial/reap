alter table public.withdrawal_requests
  add column fee_usd numeric(18, 2) not null default 0,
  add column payout_usd numeric(18, 2) not null default 0;

update public.withdrawal_requests
set fee_usd = round(amount_usd * 0.05, 2),
    payout_usd = amount_usd - round(amount_usd * 0.05, 2);

alter table public.withdrawal_requests
  add constraint withdrawal_requests_fee_check
    check (fee_usd >= 0 and fee_usd <= amount_usd),
  add constraint withdrawal_requests_payout_check
    check (payout_usd >= 0 and fee_usd + payout_usd = amount_usd);

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
  account_balance numeric(18, 6);
  reserved_amount numeric(18, 2);
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

  select coalesce(sum(
    case when entry_type = 'withdrawal' then -amount_usd else amount_usd end
  ), 0)
  into account_balance
  from public.ledger_entries
  where user_id = requesting_user
    and status = 'confirmed';

  select coalesce(sum(amount_usd), 0)
  into reserved_amount
  from public.withdrawal_requests
  where user_id = requesting_user
    and status in ('pending', 'processing');

  if p_amount_usd > account_balance - reserved_amount then
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
