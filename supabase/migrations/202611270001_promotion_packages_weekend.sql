insert into public.plans (amount_usd, daily_task_limit, term_days, daily_reward_usd, active)
values (500, 10, 365, 20, true)
on conflict (amount_usd) do update
set daily_task_limit = excluded.daily_task_limit,
    term_days = excluded.term_days,
    daily_reward_usd = excluded.daily_reward_usd,
    active = excluded.active;

create function public.award_deposit_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from new.status
    and new.amount_usd >= 50
    and new.created_at >= timestamptz '2026-11-27 08:30:00+02'
    and new.created_at < timestamptz '2026-11-28 08:30:00+02' then
    insert into public.ledger_entries (user_id, entry_type, amount_usd, status, reference)
    values (
      new.user_id, 'adjustment', round(new.amount_usd * 0.5, 2), 'confirmed',
      'deposit-promotion:' || new.id::text
    );
  end if;
  return new;
end;
$$;

create trigger on_deposit_promotion_confirmed
after update of status on public.deposit_requests
for each row execute function public.award_deposit_promotion();

revoke all on function public.award_deposit_promotion() from public, anon, authenticated;

create function public.task_allowed_at(p_user_id uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when extract(isodow from timezone('Africa/Harare', p_at)) <= 5 then true
    else exists (
      select 1 from auth.users u
      where u.id = p_user_id
        and u.created_at <= p_at
        and extract(isodow from timezone('Africa/Harare', u.created_at)) >= 5
        and date_trunc('week', timezone('Africa/Harare', u.created_at))
          = date_trunc('week', timezone('Africa/Harare', p_at))
    )
  end;
$$;

revoke all on function public.task_allowed_at(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.enforce_weekday_task_completions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or (new.status = 'approved' and old.status is distinct from new.status))
    and not public.task_allowed_at(new.user_id, clock_timestamp()) then
    raise exception 'Video tasks are available Monday through Friday, except on your first weekend if you joined Friday through Sunday (Africa/Harare time).';
  end if;
  return new;
end;
$$;

create or replace function public.begin_video_task(p_task_id uuid, p_task_slot integer)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  current_cycle_id uuid;
  current_cycle_status text;
  current_reset_at timestamptz;
  active_task_limit bigint;
  tasks_started bigint;
  completion_id uuid;
  completion_task_id uuid;
  completion_status text;
  started_time timestamptz;
begin
  if requesting_user is null then
    raise exception 'You must be signed in to start a task.';
  end if;
  if not public.task_allowed_at(requesting_user, clock_timestamp()) then
    raise exception 'Video tasks are available Monday through Friday, except on your first weekend if you joined Friday through Sunday (Africa/Harare time).';
  end if;
  if p_task_slot is null or p_task_slot < 1 then
    raise exception 'Select a valid task slot.';
  end if;

  perform 1 from public.profiles where id = requesting_user for update;
  if not found then
    raise exception 'User profile was not found.';
  end if;

  perform 1 from public.tasks where id = p_task_id and active;
  if not found then
    raise exception 'This video task is not available.';
  end if;

  select coalesce(sum(plan.daily_task_limit), 0)
  into active_task_limit
  from public.user_packages user_package
  join public.plans plan on plan.id = user_package.plan_id
  where user_package.user_id = requesting_user
    and user_package.status = 'active'
    and plan.active
    and (user_package.starts_at is null or user_package.starts_at <= now())
    and (user_package.ends_at is null or user_package.ends_at > now());

  if active_task_limit < 1 then
    raise exception 'An active package is required to earn task rewards.';
  end if;
  if p_task_slot > active_task_limit then
    raise exception 'This task slot is not included in your active packages.';
  end if;

  select cycle.id, cycle.status, cycle.resets_at
  into current_cycle_id, current_cycle_status, current_reset_at
  from public.user_task_cycles cycle
  where cycle.user_id = requesting_user and cycle.status in ('active', 'cooldown')
  order by cycle.started_at desc
  limit 1
  for update;

  if current_cycle_status = 'cooldown' then
    if current_reset_at > now() then
      raise exception 'Your daily tasks are complete. They renew 24 hours after completion.';
    end if;
    update public.user_task_cycles set status = 'completed' where id = current_cycle_id;
    current_cycle_id := null;
  end if;

  if current_cycle_id is null then
    insert into public.user_task_cycles (user_id)
    values (requesting_user)
    returning id into current_cycle_id;
  end if;

  select completion.id, completion.task_id, completion.status, completion.started_at
  into completion_id, completion_task_id, completion_status, started_time
  from public.task_completions completion
  where completion.task_cycle_id = current_cycle_id and completion.task_slot = p_task_slot
  for update;

  if completion_id is not null then
    if completion_task_id <> p_task_id then
      raise exception 'This task slot no longer matches its video. Refresh the page and try again.';
    end if;
    if completion_status = 'approved' then
      raise exception 'This task has already been completed in this task cycle.';
    end if;
    if completion_status = 'pending' then
      return started_time;
    end if;
  end if;

  select count(*) into tasks_started
  from public.task_completions completion
  where completion.task_cycle_id = current_cycle_id and completion.status in ('pending', 'approved');

  if tasks_started >= active_task_limit then
    raise exception 'You have used all task slots for this cycle.';
  end if;

  insert into public.task_completions (
    user_id, task_id, completed_on, status, started_at, task_cycle_id, task_slot
  )
  values (
    requesting_user, p_task_id, (now() at time zone 'UTC')::date,
    'pending', now(), current_cycle_id, p_task_slot
  )
  returning started_at into started_time;

  return started_time;
end;
$$;

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
  perform 1 from public.profiles where id = requesting_user for update;
  if not found then
    raise exception 'User profile was not found.';
  end if;
  select amount_usd, term_days into package_amount, package_term_days
  from public.plans where id = p_plan_id and active;
  if not found then
    raise exception 'This package is not available.';
  end if;
  if package_amount in (5, 10) and exists (
    select 1 from public.user_packages
    where user_id = requesting_user and plan_id = p_plan_id
  ) then
    raise exception 'The $% package may only be purchased once per account.', package_amount;
  end if;
  account_balance := public.available_wallet_balance(requesting_user);
  if package_amount > account_balance then
    raise exception 'Your available wallet balance is not enough for this package.';
  end if;
  insert into public.user_packages (user_id, plan_id, status, starts_at, ends_at)
  values (requesting_user, p_plan_id, 'active', now(), now() + make_interval(days => package_term_days))
  returning id into package_id;
  insert into public.ledger_entries (user_id, entry_type, amount_usd, status, reference)
  values (requesting_user, 'package_purchase', package_amount, 'confirmed', 'package-purchase:' || package_id::text);
  return package_id;
end;
$$;
