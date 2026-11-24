insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deposit-proofs',
  'deposit-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.transaction_review_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.transaction_review_admins enable row level security;
revoke all on public.transaction_review_admins from public, anon, authenticated;

create or replace function public.is_transaction_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.transaction_review_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_transaction_reviewer() from public, anon;
grant execute on function public.is_transaction_reviewer() to authenticated;

alter table public.deposit_requests
  add column if not exists proof_path text;

drop policy if exists "Users can upload own deposit proofs" on storage.objects;
create policy "Users can upload own deposit proofs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'deposit-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can read own deposit proofs" on storage.objects;
create policy "Users can read own deposit proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'deposit-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Review admins can read deposit proofs" on storage.objects;
create policy "Review admins can read deposit proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'deposit-proofs'
    and (select public.is_transaction_reviewer())
  );

drop policy if exists "Users can remove unlinked deposit proofs" on storage.objects;
create policy "Users can remove unlinked deposit proofs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'deposit-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1
      from public.deposit_requests
      where proof_path = name
    )
  );

drop function if exists public.request_deposit(numeric, text, text);

create or replace function public.request_deposit(
  p_amount_usd numeric,
  p_network text,
  p_provider_reference text,
  p_proof_path text
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

  if p_proof_path is null
    or p_proof_path !~ ('^' || requesting_user::text || '/[A-Fa-f0-9-]{36}\.(jpg|png|webp)$')
    or not exists (
      select 1
      from storage.objects
      where bucket_id = 'deposit-proofs'
        and name = p_proof_path
    ) then
    raise exception 'Upload a valid deposit screenshot before submitting the request.';
  end if;

  insert into public.deposit_requests (
    user_id, amount_usd, asset, network, status, provider_reference, proof_path
  )
  values (
    requesting_user, p_amount_usd, 'USDT', 'TRC20', 'pending',
    nullif(lower(trim(p_provider_reference)), ''), p_proof_path
  )
  returning id into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_deposit(numeric, text, text, text)
  from public, anon;
grant execute on function public.request_deposit(numeric, text, text, text)
  to authenticated;

create or replace function public.get_transaction_review_queue()
returns table (
  request_type text,
  id uuid,
  user_id uuid,
  user_email text,
  display_name text,
  amount_usd numeric,
  asset text,
  network text,
  status text,
  created_at timestamptz,
  proof_path text,
  destination_address text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_transaction_reviewer() then
    raise exception 'You are not authorized to review transaction requests.';
  end if;

  return query
    select
      'deposit'::text,
      d.id,
      d.user_id,
      u.email::text,
      p.display_name,
      d.amount_usd,
      d.asset,
      d.network,
      d.status,
      d.created_at,
      d.proof_path,
      null::text
    from public.deposit_requests d
    join auth.users u on u.id = d.user_id
    left join public.profiles p on p.id = d.user_id
    where d.status = 'pending'

    union all

    select
      'withdrawal'::text,
      w.id,
      w.user_id,
      u.email::text,
      p.display_name,
      w.amount_usd,
      w.asset,
      w.network,
      w.status,
      w.created_at,
      null::text,
      w.destination_address
    from public.withdrawal_requests w
    join auth.users u on u.id = w.user_id
    left join public.profiles p on p.id = w.user_id
    where w.status in ('pending', 'processing')
    order by created_at;
end;
$$;

create or replace function public.approve_deposit_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  deposit_request public.deposit_requests%rowtype;
begin
  if not public.is_transaction_reviewer() then
    raise exception 'You are not authorized to approve deposit requests.';
  end if;

  select *
  into deposit_request
  from public.deposit_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Deposit request not found.';
  end if;
  if deposit_request.status <> 'pending' then
    raise exception 'Deposit request is not pending.';
  end if;
  if deposit_request.proof_path is null
    or not exists (
      select 1
      from storage.objects
      where bucket_id = 'deposit-proofs'
        and name = deposit_request.proof_path
    ) then
    raise exception 'Deposit screenshot is missing; this request cannot be approved.';
  end if;

  insert into public.ledger_entries (
    user_id, entry_type, amount_usd, status, reference
  )
  values (
    deposit_request.user_id,
    'deposit',
    deposit_request.amount_usd,
    'confirmed',
    'deposit-request:' || deposit_request.id::text
  );

  update public.deposit_requests
  set status = 'confirmed'
  where id = deposit_request.id;

  return deposit_request.id;
end;
$$;

create or replace function public.reject_deposit_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  deposit_request public.deposit_requests%rowtype;
begin
  if not public.is_transaction_reviewer() then
    raise exception 'You are not authorized to reject deposit requests.';
  end if;

  select *
  into deposit_request
  from public.deposit_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Deposit request not found.';
  end if;
  if deposit_request.status <> 'pending' then
    raise exception 'Deposit request is not pending.';
  end if;

  update public.deposit_requests
  set status = 'rejected'
  where id = deposit_request.id;

  return deposit_request.id;
end;
$$;

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

  select coalesce(sum(
    case when entry_type = 'withdrawal' then -amount_usd else amount_usd end
  ), 0)
  into account_balance
  from public.ledger_entries
  where user_id = withdrawal_request.user_id
    and status = 'confirmed';

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

create or replace function public.reject_withdrawal_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  withdrawal_request public.withdrawal_requests%rowtype;
begin
  if not public.is_transaction_reviewer() then
    raise exception 'You are not authorized to reject withdrawal requests.';
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

  update public.withdrawal_requests
  set status = 'rejected'
  where id = withdrawal_request.id;

  return withdrawal_request.id;
end;
$$;

revoke all on function public.approve_deposit_request(uuid),
  public.reject_deposit_request(uuid),
  public.approve_withdrawal_request(uuid),
  public.reject_withdrawal_request(uuid),
  public.get_transaction_review_queue()
  from public, anon, authenticated;

grant execute on function public.approve_deposit_request(uuid),
  public.reject_deposit_request(uuid),
  public.approve_withdrawal_request(uuid),
  public.reject_withdrawal_request(uuid),
  public.get_transaction_review_queue()
  to authenticated;
