import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { promotionRemaining, tasksAllowed } from '../src/lib/promotion.js'

test('promotion countdown uses a single fixed 24-hour Zimbabwe time window', () => {
  assert.equal(promotionRemaining(new Date('2026-11-27T06:29:59Z')), 0)
  assert.equal(promotionRemaining(new Date('2026-11-27T06:30:00Z')), 86400)
  assert.equal(promotionRemaining(new Date('2026-11-28T06:29:59Z')), 1)
  assert.equal(promotionRemaining(new Date('2026-11-28T06:30:00Z')), 0)
})

test('weekend access is limited to the signup weekend in Zimbabwe time', () => {
  const saturday = new Date('2026-11-28T10:00:00Z')
  const sunday = new Date('2026-11-29T10:00:00Z')
  assert.equal(tasksAllowed(saturday, '2026-11-26T22:00:00Z'), true)
  assert.equal(tasksAllowed(sunday, '2026-11-26T21:59:59Z'), false)
  assert.equal(tasksAllowed(sunday, '2026-11-28T10:00:00Z'), true)
  assert.equal(tasksAllowed(saturday, '2026-11-28T23:00:00Z'), false)
  assert.equal(tasksAllowed(new Date('2026-12-05T10:00:00Z'), '2026-11-27T10:00:00Z'), false)
  assert.equal(tasksAllowed(new Date('2026-11-30T10:00:00Z'), null), true)
  assert.equal(tasksAllowed(saturday, null), false)
})

test('database promotion, signup weekend and purchase limits are enforced', async () => {
  const db = new PGlite()
  const user = '00000000-0000-0000-0000-000000000001'
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, created_at timestamptz not null);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.profiles (id uuid primary key);
      create table public.plans (
        id uuid primary key default gen_random_uuid(), amount_usd numeric unique,
        daily_task_limit integer, term_days integer, daily_reward_usd numeric, active boolean
      );
      create table public.user_packages (
        id uuid primary key default gen_random_uuid(), user_id uuid, plan_id uuid,
        status text, starts_at timestamptz, ends_at timestamptz
      );
      create table public.ledger_entries (
        user_id uuid, entry_type text, amount_usd numeric, status text, reference text unique
      );
      create table public.deposit_requests (
        id uuid primary key, user_id uuid, amount_usd numeric, status text, created_at timestamptz
      );
      create function public.available_wallet_balance(uuid) returns numeric
        language sql as $$ select 10000::numeric $$;
      create function public.enforce_weekday_task_completions() returns trigger
        language plpgsql as $$ begin return new; end $$;
      create table public.task_completions (user_id uuid, status text);
      create trigger task_completions_weekday_guard
        before insert or update of status on public.task_completions
        for each row execute function public.enforce_weekday_task_completions();
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/202611270001_promotion_packages_weekend.sql', import.meta.url), 'utf8'))
    await db.query(`insert into auth.users values ($1, '2026-11-26T22:00:00Z');`, [user])
    await db.query(`insert into public.profiles values ($1)`, [user])
    await db.query(`select set_config('test.uid', $1, false)`, [user])
    const plan = await db.query(`select daily_task_limit, term_days, daily_reward_usd::text from public.plans where amount_usd = 500`)
    assert.deepEqual(plan.rows, [{ daily_task_limit: 10, term_days: 365, daily_reward_usd: '20' }])

    const eligibility = await db.query(`
      select public.task_allowed_at($1, '2026-11-28T10:00:00Z') as first_weekend,
             public.task_allowed_at($1, '2026-12-05T10:00:00Z') as later_weekend,
             public.task_allowed_at($1, '2026-11-30T10:00:00Z') as weekday
    `, [user])
    assert.deepEqual(eligibility.rows[0], { first_weekend: true, later_weekend: false, weekday: true })
    await db.query(`update auth.users set created_at = '2026-11-26T21:59:59Z' where id = $1`, [user])
    const thursday = await db.query(`select public.task_allowed_at($1, '2026-11-29T10:00:00Z') as allowed`, [user])
    assert.equal(thursday.rows[0].allowed, false)

    await db.query(`
      insert into public.deposit_requests values
      ('10000000-0000-0000-0000-000000000001', $1, 50, 'pending', '2026-11-27T06:30:00Z'),
      ('10000000-0000-0000-0000-000000000002', $1, 49.99, 'pending', '2026-11-27T07:00:00Z'),
      ('10000000-0000-0000-0000-000000000003', $1, 100, 'pending', '2026-11-27T06:29:59Z'),
      ('10000000-0000-0000-0000-000000000004', $1, 100, 'pending', '2026-11-28T06:30:00Z'),
      ('10000000-0000-0000-0000-000000000005', $1, 50.01, 'pending', '2026-11-28T06:29:59Z'),
      ('10000000-0000-0000-0000-000000000006', $1, 100, 'pending', '2026-11-27T07:00:00Z')
    `, [user])
    await db.exec(`update public.deposit_requests set status = case when id = '10000000-0000-0000-0000-000000000006' then 'rejected' else 'confirmed' end`)
    const bonuses = await db.query(`select amount_usd::text, reference from public.ledger_entries order by reference`)
    assert.deepEqual(bonuses.rows.map((row) => row.amount_usd), ['25.00', '25.01'])
    await db.exec(`update public.deposit_requests set status = 'confirmed' where id = '10000000-0000-0000-0000-000000000001'`)
    assert.equal((await db.query(`select count(*)::int as count from public.ledger_entries`)).rows[0].count, 2)

    await db.exec(`insert into public.plans (amount_usd, daily_task_limit, term_days, daily_reward_usd, active) values (5, 3, 365, 0.85, true), (10, 4, 365, 1, true), (15, 5, 365, 2, true)`)
    const plans = await db.query(`select id, amount_usd::int as amount from public.plans where amount_usd in (5, 10, 15) order by amount_usd`)
    for (const { id, amount } of plans.rows) {
      await db.query(`select public.purchase_package($1)`, [id])
      if (amount === 15) await db.query(`select public.purchase_package($1)`, [id])
      else await assert.rejects(db.query(`select public.purchase_package($1)`, [id]), /only be purchased once/)
    }
  } finally {
    await db.close()
  }
})
