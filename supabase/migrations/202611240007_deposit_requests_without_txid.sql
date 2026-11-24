create or replace function public.request_deposit(
  p_amount_usd numeric,
  p_network text,
  p_provider_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  request_id uuid;
begin
  if requesting_user is null then
    raise exception 'You must be signed in to create a deposit request.';
  end if;

  if p_amount_usd is null
    or p_amount_usd < 5
    or p_amount_usd <> round(p_amount_usd, 2) then
    raise exception 'Deposit amount must be at least $5.00 and use cents.';
  end if;

  if p_network is distinct from 'TRC20' then
    raise exception 'Only USDT deposits on TRON (TRC20) are supported.';
  end if;

  if p_provider_reference is not null
    and trim(p_provider_reference) !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'TRON transaction ID must contain 64 hexadecimal characters.';
  end if;

  insert into public.deposit_requests (
    user_id, amount_usd, asset, network, status, provider_reference
  )
  values (
    requesting_user, p_amount_usd, 'USDT', 'TRC20', 'pending',
    nullif(lower(trim(p_provider_reference)), '')
  )
  returning id into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_deposit(numeric, text, text)
  from public, anon;
grant execute on function public.request_deposit(numeric, text, text)
  to authenticated;
