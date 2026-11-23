create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  amount_usd numeric(18, 2) not null unique check (amount_usd > 0),
  daily_task_limit integer not null check (daily_task_limit > 0),
  term_days integer not null default 365 check (term_days > 0),
  daily_reward_usd numeric(18, 6) check (daily_reward_usd is null or daily_reward_usd >= 0),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.user_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  plan_id uuid not null references public.plans (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'completed', 'cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  entry_type text not null
    check (entry_type in ('deposit', 'task_reward', 'withdrawal', 'refund', 'adjustment')),
  amount_usd numeric(18, 6) not null check (amount_usd > 0),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected')),
  reference text unique,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  video_url text not null,
  reward_usd numeric(18, 6) not null check (reward_usd >= 0),
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.task_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  task_id uuid not null references public.tasks (id) on delete restrict,
  completed_on date not null default current_date,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (user_id, task_id, completed_on)
);

create table public.deposit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  amount_usd numeric(18, 2) not null check (amount_usd > 0),
  asset text not null default 'USDT' check (asset = 'USDT'),
  network text not null check (network in ('TRC20', 'BEP20')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'expired', 'rejected')),
  provider_reference text unique,
  created_at timestamptz not null default now()
);

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  amount_usd numeric(18, 2) not null check (amount_usd > 0),
  asset text not null default 'USDT' check (asset = 'USDT'),
  network text not null check (network in ('TRC20', 'BEP20')),
  destination_address text not null check (length(trim(destination_address)) between 20 and 128),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'rejected')),
  provider_reference text unique,
  created_at timestamptz not null default now()
);

create index user_packages_user_id_idx on public.user_packages (user_id, created_at desc);
create index ledger_entries_user_id_created_at_idx on public.ledger_entries (user_id, created_at desc);
create index task_completions_user_id_date_idx on public.task_completions (user_id, completed_on desc);
create index deposit_requests_user_id_idx on public.deposit_requests (user_id, created_at desc);
create index withdrawal_requests_user_id_idx on public.withdrawal_requests (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.user_packages enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;
alter table public.deposit_requests enable row level security;
alter table public.withdrawal_requests enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Anyone can read active plans"
  on public.plans for select to anon, authenticated
  using (active = true);

create policy "Users can read their own packages"
  on public.user_packages for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own ledger entries"
  on public.ledger_entries for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Anyone can read active tasks"
  on public.tasks for select to anon, authenticated
  using (active = true);

create policy "Users can read their own task completions"
  on public.task_completions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own deposit requests"
  on public.deposit_requests for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own withdrawal requests"
  on public.withdrawal_requests for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.plans, public.user_packages,
  public.ledger_entries, public.tasks, public.task_completions,
  public.deposit_requests, public.withdrawal_requests from anon, authenticated;

grant select on public.profiles, public.user_packages, public.ledger_entries,
  public.task_completions, public.deposit_requests, public.withdrawal_requests
  to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.plans, public.tasks to anon, authenticated;
