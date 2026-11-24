insert into public.plans (
  amount_usd, daily_task_limit, term_days, daily_reward_usd, active
)
values
  (5, 3, 365, 0.85, true),
  (10, 4, 365, 1, true),
  (15, 5, 365, 2, true),
  (30, 6, 365, 5.5, true),
  (50, 7, 365, 8, true),
  (80, 8, 365, 12, true),
  (100, 9, 365, 15, true),
  (120, 10, 365, 18, true),
  (200, 12, 365, 30, true),
  (250, 15, 365, 38, true)
on conflict (amount_usd) do nothing;

alter table public.task_completions
  add column started_at timestamptz not null default now(),
  add column completed_at timestamptz;

insert into public.tasks (title, video_url, reward_usd, active, sort_order)
select task.title, task.video_url, 0, true, task.sort_order
from (values
  ('Video task 1', '/task%20videos/12248500_1920_1080_30fps.mp4', 1),
  ('Video task 2', '/task%20videos/13649040_1920_1080_30fps.mp4', 2),
  ('Video task 3', '/task%20videos/15257423_1920_1080_60fps.mp4', 3)
) as task(title, video_url, sort_order)
where not exists (
  select 1 from public.tasks existing where existing.video_url = task.video_url
);

create or replace function public.begin_video_task(p_task_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := (select auth.uid());
  utc_today date := (now() at time zone 'UTC')::date;
  task_limit bigint;
  started_time timestamptz;
  completion_status text;
  completion_id uuid;
  tasks_started bigint;
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

  perform 1
  from public.tasks
  where id = p_task_id
    and active;

  if not found then
    raise exception 'This video task is not available.';
  end if;

  select coalesce(sum(plan.daily_task_limit), 0)
  into task_limit
  from public.user_packages user_package
  join public.plans plan on plan.id = user_package.plan_id
  where user_package.user_id = requesting_user
    and user_package.status = 'active'
    and plan.active
    and (user_package.starts_at is null or user_package.starts_at <= now())
    and (user_package.ends_at is null or user_package.ends_at > now());

  if task_limit < 1 then
    raise exception 'An active package is required to earn task rewards.';
  end if;

  select id, status, started_at
  into completion_id, completion_status, started_time
  from public.task_completions
  where user_id = requesting_user
    and task_id = p_task_id
    and completed_on = utc_today
  for update;

  if completion_id is not null then
    if completion_status = 'approved' then
      raise exception 'This task has already been completed today.';
    end if;

    if completion_status = 'pending' then
      return started_time;
    end if;

    select count(*)
    into tasks_started
    from public.task_completions
    where user_id = requesting_user
      and completed_on = utc_today
      and status in ('pending', 'approved');

    if tasks_started >= task_limit then
      raise exception 'You have reached the daily task limit for your active packages.';
    end if;

    update public.task_completions
    set status = 'pending',
        started_at = now(),
        completed_at = null
    where id = completion_id
    returning started_at into started_time;
    return started_time;
  end if;

  select count(*)
  into tasks_started
  from public.task_completions
  where user_id = requesting_user
    and completed_on = utc_today
    and status in ('pending', 'approved');

  if tasks_started >= task_limit then
    raise exception 'You have reached the daily task limit for your active packages.';
  end if;

  insert into public.task_completions (user_id, task_id, completed_on, status, started_at)
  values (requesting_user, p_task_id, utc_today, 'pending', now())
  returning started_at into started_time;

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
  utc_today date := (now() at time zone 'UTC')::date;
  completion_id uuid;
  completion_status text;
  started_time timestamptz;
  daily_reward numeric;
  task_limit bigint;
  reward_amount numeric(18, 6);
  ledger_created_at timestamptz;
begin
  if requesting_user is null then
    raise exception 'You must be signed in to complete a task.';
  end if;

  perform 1
  from public.profiles
  where id = requesting_user
  for update;

  if not found then
    raise exception 'User profile was not found.';
  end if;

  select id, status, started_at
  into completion_id, completion_status, started_time
  from public.task_completions
  where user_id = requesting_user
    and task_id = p_task_id
    and completed_on = utc_today
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

    return jsonb_build_object(
      'completion_id', completion_id,
      'reward_usd', reward_amount,
      'created_at', ledger_created_at
    );
  end if;

  if completion_status <> 'pending' then
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
  into daily_reward, task_limit
  from public.user_packages user_package
  join public.plans plan on plan.id = user_package.plan_id
  where user_package.user_id = requesting_user
    and user_package.status = 'active'
    and plan.active
    and (user_package.starts_at is null or user_package.starts_at <= now())
    and (user_package.ends_at is null or user_package.ends_at > now());

  if task_limit < 1 or daily_reward <= 0 then
    raise exception 'An active package with a daily reward is required.';
  end if;

  reward_amount := round(daily_reward / task_limit, 6);
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

  return jsonb_build_object(
    'completion_id', completion_id,
    'reward_usd', reward_amount,
    'created_at', ledger_created_at
  );
end;
$$;

revoke all on function public.begin_video_task(uuid) from public, anon;
revoke all on function public.complete_video_task(uuid) from public, anon;
grant execute on function public.begin_video_task(uuid) to authenticated;
grant execute on function public.complete_video_task(uuid) to authenticated;
