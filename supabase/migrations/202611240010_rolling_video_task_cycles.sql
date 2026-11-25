create table public.user_task_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'cooldown', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  resets_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status = 'active' and completed_at is null and resets_at is null)
    or (status = 'cooldown' and completed_at is not null and resets_at is not null)
    or status = 'completed'
  )
);

create unique index user_task_cycles_one_open_cycle_idx
  on public.user_task_cycles (user_id)
  where status in ('active', 'cooldown');

alter table public.user_task_cycles enable row level security;
revoke all on public.user_task_cycles from public, anon, authenticated;

alter table public.task_completions
  add column task_cycle_id uuid references public.user_task_cycles (id) on delete cascade,
  add column task_slot integer not null default 1 check (task_slot > 0);

alter table public.task_completions
  drop constraint if exists task_completions_user_id_task_id_completed_on_key;

create unique index task_completions_cycle_slot_idx
  on public.task_completions (task_cycle_id, task_slot)
  where task_cycle_id is not null;

create index user_task_cycles_user_status_idx
  on public.user_task_cycles (user_id, status, started_at desc);

create or replace function public.get_my_task_progress()
returns table (
  cycle_id uuid,
  resets_at timestamptz,
  task_limit bigint,
  completed_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  current_cycle_id uuid;
  current_reset_at timestamptz;
  current_cycle_status text;
  active_task_limit bigint;
  approved_tasks bigint;
begin
  if requesting_user is null then
    raise exception 'You must be signed in to view task progress.';
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

  select cycle.id, cycle.resets_at, cycle.status
  into current_cycle_id, current_reset_at, current_cycle_status
  from public.user_task_cycles cycle
  where cycle.user_id = requesting_user
    and cycle.status in ('active', 'cooldown')
    and (cycle.status = 'active' or cycle.resets_at > now())
  order by cycle.started_at desc
  limit 1;

  if current_cycle_id is null then
    return query select null::uuid, null::timestamptz, active_task_limit, 0::bigint;
    return;
  end if;

  select count(*)
  into approved_tasks
  from public.task_completions completion
  where completion.task_cycle_id = current_cycle_id
    and completion.status = 'approved';

  return query
  select
    current_cycle_id,
    case when current_cycle_status = 'cooldown' then current_reset_at else null::timestamptz end,
    active_task_limit,
    approved_tasks;
end;
$$;

revoke all on function public.get_my_task_progress() from public, anon;
grant execute on function public.get_my_task_progress() to authenticated;

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
  if p_task_slot is null or p_task_slot < 1 then
    raise exception 'Select a valid task slot.';
  end if;

  perform 1
  from public.profiles
  where id = requesting_user
  for update;
  if not found then
    raise exception 'User profile was not found.';
  end if;

  perform 1
  from public.tasks
  where id = p_task_id
    and active;
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
  where cycle.user_id = requesting_user
    and cycle.status in ('active', 'cooldown')
  order by cycle.started_at desc
  limit 1
  for update;

  if current_cycle_status = 'cooldown' then
    if current_reset_at > now() then
      raise exception 'Your daily tasks are complete. They renew 24 hours after completion.';
    end if;
    update public.user_task_cycles
    set status = 'completed'
    where id = current_cycle_id;
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
  where completion.task_cycle_id = current_cycle_id
    and completion.task_slot = p_task_slot
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

  select count(*)
  into tasks_started
  from public.task_completions completion
  where completion.task_cycle_id = current_cycle_id
    and completion.status in ('pending', 'approved');

  if tasks_started >= active_task_limit then
    raise exception 'You have used all task slots for this cycle.';
  end if;

  insert into public.task_completions (
    user_id, task_id, completed_on, status, started_at, task_cycle_id, task_slot
  )
  values (
    requesting_user,
    p_task_id,
    (now() at time zone 'UTC')::date,
    'pending',
    now(),
    current_cycle_id,
    p_task_slot
  )
  returning started_at into started_time;

  return started_time;
end;
$$;

create or replace function public.complete_video_task(p_task_id uuid, p_task_slot integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  current_cycle_id uuid;
  current_cycle_status text;
  completion_id uuid;
  completion_status text;
  started_time timestamptz;
  daily_reward numeric;
  active_task_limit bigint;
  completed_tasks bigint;
  reward_amount numeric(18, 6);
  ledger_created_at timestamptz;
  cycle_reset_at timestamptz;
begin
  if requesting_user is null then
    raise exception 'You must be signed in to complete a task.';
  end if;
  if p_task_slot is null or p_task_slot < 1 then
    raise exception 'Select a valid task slot.';
  end if;

  perform 1
  from public.profiles
  where id = requesting_user
  for update;
  if not found then
    raise exception 'User profile was not found.';
  end if;

  select cycle.id, cycle.status
  into current_cycle_id, current_cycle_status
  from public.user_task_cycles cycle
  where cycle.user_id = requesting_user
    and cycle.status in ('active', 'cooldown')
  order by cycle.started_at desc
  limit 1
  for update;

  if current_cycle_id is null then
    raise exception 'Start this video task before requesting its reward.';
  end if;

  select completion.id, completion.status, completion.started_at
  into completion_id, completion_status, started_time
  from public.task_completions completion
  where completion.task_cycle_id = current_cycle_id
    and completion.task_slot = p_task_slot
    and completion.task_id = p_task_id
  for update;

  if completion_id is null then
    raise exception 'Start this video task before requesting its reward.';
  end if;

  if completion_status = 'approved' then
    select amount_usd, created_at
    into reward_amount, ledger_created_at
    from public.ledger_entries
    where reference = 'task_completion:' || completion_id::text;
    if not found then
      raise exception 'The completed task reward could not be found.';
    end if;
    select resets_at into cycle_reset_at
    from public.user_task_cycles
    where id = current_cycle_id;
    return jsonb_build_object(
      'completion_id', completion_id,
      'reward_usd', reward_amount,
      'created_at', ledger_created_at,
      'resets_at', cycle_reset_at
    );
  end if;

  if current_cycle_status <> 'active' or completion_status <> 'pending' then
    raise exception 'This task is not awaiting completion.';
  end if;

  if clock_timestamp() < started_time + interval '30 seconds' then
    raise exception 'Watch the video for at least 30 seconds before completing this task.';
  end if;

  perform 1
  from public.tasks
  where id = p_task_id
    and active;
  if not found then
    raise exception 'This video task is no longer available.';
  end if;

  select coalesce(sum(plan.daily_reward_usd), 0),
         coalesce(sum(plan.daily_task_limit), 0)
  into daily_reward, active_task_limit
  from public.user_packages user_package
  join public.plans plan on plan.id = user_package.plan_id
  where user_package.user_id = requesting_user
    and user_package.status = 'active'
    and plan.active
    and (user_package.starts_at is null or user_package.starts_at <= now())
    and (user_package.ends_at is null or user_package.ends_at > now());

  if active_task_limit < 1 or daily_reward <= 0 then
    raise exception 'An active package with a daily reward is required.';
  end if;

  reward_amount := round(daily_reward / active_task_limit, 6);
  if reward_amount <= 0 then
    raise exception 'The task reward must be greater than zero.';
  end if;

  update public.task_completions
  set status = 'approved',
      completed_at = now()
  where id = completion_id;

  insert into public.ledger_entries (user_id, entry_type, amount_usd, status, reference)
  values (
    requesting_user,
    'task_reward',
    reward_amount,
    'confirmed',
    'task_completion:' || completion_id::text
  )
  returning created_at into ledger_created_at;

  select count(*)
  into completed_tasks
  from public.task_completions completion
  where completion.task_cycle_id = current_cycle_id
    and completion.status = 'approved';

  if completed_tasks >= active_task_limit then
    update public.user_task_cycles
    set status = 'cooldown',
        completed_at = now(),
        resets_at = now() + interval '24 hours'
    where id = current_cycle_id
    returning resets_at into cycle_reset_at;
  end if;

  return jsonb_build_object(
    'completion_id', completion_id,
    'reward_usd', reward_amount,
    'created_at', ledger_created_at,
    'resets_at', cycle_reset_at,
    'completed_count', completed_tasks,
    'task_limit', active_task_limit
  );
end;
$$;

create or replace function public.begin_video_task(p_task_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  current_cycle_id uuid;
  current_cycle_status text;
  active_task_limit bigint;
  selected_slot integer;
  started_time timestamptz;
begin
  if requesting_user is null then
    raise exception 'You must be signed in to start a task.';
  end if;

  perform 1
  from public.profiles
  where id = requesting_user
  for update;
  if not found then
    raise exception 'User profile was not found.';
  end if;

  select task_limit
  into active_task_limit
  from public.get_my_task_progress();
  if active_task_limit < 1 then
    raise exception 'An active package is required to earn task rewards.';
  end if;

  select cycle.id, cycle.status
  into current_cycle_id, current_cycle_status
  from public.user_task_cycles cycle
  where cycle.user_id = requesting_user
    and cycle.status in ('active', 'cooldown')
  order by cycle.started_at desc
  limit 1;

  if current_cycle_status = 'cooldown' then
    selected_slot := 1;
  else
    select completion.task_slot
    into selected_slot
    from public.task_completions completion
    where completion.task_cycle_id = current_cycle_id
      and completion.task_id = p_task_id
      and completion.status = 'pending'
    limit 1;

    if selected_slot is null then
      select available_slot.slot
      into selected_slot
      from generate_series(1, active_task_limit::integer) as available_slot(slot)
      where not exists (
        select 1
        from public.task_completions completion
        where completion.task_cycle_id = current_cycle_id
          and completion.task_slot = available_slot.slot
      )
      order by available_slot.slot
      limit 1;
    end if;
  end if;

  if selected_slot is null then
    raise exception 'You have used all task slots for this cycle.';
  end if;

  select public.begin_video_task(p_task_id, selected_slot) into started_time;
  return started_time;
end;
$$;

create or replace function public.complete_video_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  current_cycle_id uuid;
  selected_slot integer;
  result jsonb;
begin
  if requesting_user is null then
    raise exception 'You must be signed in to complete a task.';
  end if;

  select cycle.id
  into current_cycle_id
  from public.user_task_cycles cycle
  where cycle.user_id = requesting_user
    and cycle.status in ('active', 'cooldown')
  order by cycle.started_at desc
  limit 1;

  select completion.task_slot
  into selected_slot
  from public.task_completions completion
  where completion.task_cycle_id = current_cycle_id
    and completion.task_id = p_task_id
    and completion.status in ('pending', 'approved')
  order by case when completion.status = 'pending' then 0 else 1 end,
           completion.task_slot
  limit 1;

  if selected_slot is null then
    raise exception 'Start this video task before requesting its reward.';
  end if;

  select public.complete_video_task(p_task_id, selected_slot) into result;
  return result;
end;
$$;

revoke all on function public.begin_video_task(uuid, integer),
  public.complete_video_task(uuid, integer),
  public.begin_video_task(uuid),
  public.complete_video_task(uuid)
  from public, anon;
grant execute on function public.begin_video_task(uuid, integer),
  public.complete_video_task(uuid, integer),
  public.begin_video_task(uuid),
  public.complete_video_task(uuid)
  to authenticated;
