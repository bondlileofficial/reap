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
  if extract(isodow from timezone('Africa/Kampala', clock_timestamp()))::integer > 5 then
    raise exception 'Video tasks are available Monday through Friday (Africa/Kampala time).';
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

create or replace function public.enforce_weekday_task_completions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if extract(isodow from timezone('Africa/Kampala', clock_timestamp()))::integer > 5 then
    if tg_op = 'INSERT' then
      raise exception 'Video tasks are available Monday through Friday (Africa/Kampala time).';
    end if;
    if new.status = 'approved' and old.status is distinct from new.status then
      raise exception 'Video tasks are available Monday through Friday (Africa/Kampala time).';
    end if;
  end if;
  return new;
end;
$$;

create trigger task_completions_weekday_guard
before insert or update of status on public.task_completions
for each row execute function public.enforce_weekday_task_completions();

revoke all on function public.enforce_weekday_task_completions()
  from public, anon, authenticated;

create or replace function public.enforce_withdrawal_hours()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  kampala_time time := timezone('Africa/Kampala', clock_timestamp())::time;
begin
  if kampala_time < time '09:00' or kampala_time >= time '16:00' then
    raise exception 'Withdrawals are accepted from 9:00 AM to 4:00 PM Africa/Kampala time.';
  end if;
  return new;
end;
$$;

create trigger withdrawal_requests_hours_guard
before insert on public.withdrawal_requests
for each row execute function public.enforce_withdrawal_hours();

revoke all on function public.enforce_withdrawal_hours()
  from public, anon, authenticated;
