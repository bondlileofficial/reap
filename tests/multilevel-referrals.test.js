import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('first-deposit commissions and opted-in contacts are restricted to the correct downline', async () => {
  const db = new PGlite()
  const ids = Array.from({ length: 6 }, (_, index) => `00000000-0000-0000-0000-00000000000${index + 1}`)
  const deposit = (number) => `10000000-0000-0000-0000-00000000000${number}`
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.profiles (
        id uuid primary key, referred_by uuid, display_name text, phone_number text
      );
      create table public.deposit_requests (
        id uuid primary key, user_id uuid, amount_usd numeric, status text
      );
      create table public.ledger_entries (
        user_id uuid, entry_type text, amount_usd numeric, status text, reference text unique
      );
      create table public.referral_commissions (recipient_id uuid, level integer, amount_usd numeric);
      create table public.deposit_referral_commissions (
        id uuid primary key default gen_random_uuid(),
        deposit_request_id uuid not null unique,
        source_user_id uuid not null unique,
        recipient_id uuid not null,
        rate numeric(5, 4) not null check (rate = 0.1000),
        deposit_amount_usd numeric not null,
        amount_usd numeric not null,
        created_at timestamptz not null default now()
      );
      create function public.award_first_deposit_referral() returns trigger
        language plpgsql as $$ begin return new; end $$;
      create trigger on_deposit_referral_confirmed after update of status on public.deposit_requests
        for each row execute function public.award_first_deposit_referral();
      create function public.get_my_referral_summary() returns table (
        level_1_count bigint, level_2_count bigint, level_3_count bigint,
        level_1_earnings numeric, level_2_earnings numeric, level_3_earnings numeric
      ) language sql as $$ select 0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::numeric, 0::numeric $$;
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/202611270002_multilevel_referrals.sql', import.meta.url), 'utf8'))
    for (let i = 0; i < ids.length; i++) {
      await db.query(`insert into auth.users values ($1, $2)`, [ids[i], `user${i}@example.test`])
      await db.query(`insert into public.profiles (id, referred_by, display_name, phone_number) values ($1, $2, $3, $4)`, [
        ids[i], i > 0 && i < 4 ? ids[i - 1] : null, `User ${i}`, `phone${i}`,
      ])
    }
    await db.query(`insert into public.deposit_requests values ($1, $2, 100, 'pending')`, [deposit(1), ids[3]])
    await db.query(`update public.deposit_requests set status = 'confirmed' where id = $1`, [deposit(1)])
    const commissions = await db.query(`select recipient_id, level, rate::text, amount_usd::text from public.deposit_referral_commissions order by level`)
    assert.deepEqual(commissions.rows, [
      { recipient_id: ids[2], level: 1, rate: '0.1000', amount_usd: '10.000000' },
      { recipient_id: ids[1], level: 2, rate: '0.0500', amount_usd: '5.000000' },
      { recipient_id: ids[0], level: 3, rate: '0.0300', amount_usd: '3.000000' },
    ])
    await db.query(`update public.deposit_requests set status = 'confirmed' where id = $1`, [deposit(1)])
    await db.query(`insert into public.deposit_requests values ($1, $2, 200, 'pending')`, [deposit(2), ids[3]])
    await db.query(`update public.deposit_requests set status = 'confirmed' where id = $1`, [deposit(2)])
    assert.equal((await db.query(`select count(*)::int as count from public.ledger_entries`)).rows[0].count, 3)
    await db.query(`select set_config('test.uid', $1, false)`, [ids[0]])
    const summary = await db.query(`select level_1_count::int, level_2_count::int, level_3_count::int, level_3_earnings::text from public.get_my_referral_summary()`)
    assert.deepEqual(summary.rows[0], { level_1_count: 1, level_2_count: 1, level_3_count: 1, level_3_earnings: '3.000000' })
    assert.equal((await db.query(`select * from public.get_my_referral_contacts()`)).rows.length, 0)
    await db.query(`update public.profiles set share_referral_contact = true where id in ($1, $2, $3)`, [ids[2], ids[3], ids[4]])
    const contacts = await db.query(`select * from public.get_my_referral_contacts()`)
    assert.deepEqual(contacts.rows, [
      { level: 2, display_name: 'User 2', email: 'user2@example.test', phone_number: 'phone2' },
      { level: 3, display_name: 'User 3', email: 'user3@example.test', phone_number: 'phone3' },
    ])
    await db.query(`update public.profiles set share_referral_contact = false where id = $1`, [ids[2]])
    assert.equal((await db.query(`select * from public.get_my_referral_contacts()`)).rows.length, 1)
    await db.query(`select set_config('test.uid', $1, false)`, [ids[5]])
    assert.equal((await db.query(`select * from public.get_my_referral_contacts()`)).rows.length, 0)
    const privileges = await db.query(`select has_function_privilege('anon', 'public.get_my_referral_contacts()', 'execute') as anon_allowed, has_function_privilege('authenticated', 'public.get_my_referral_contacts()', 'execute') as user_allowed`)
    assert.deepEqual(privileges.rows[0], { anon_allowed: false, user_allowed: true })
    await db.query(`insert into public.deposit_requests values ($1, $2, 100, 'pending')`, [deposit(3), ids[2]])
    await db.exec(`
      create function public.fail_commission() returns trigger language plpgsql as $$
      begin raise exception 'simulated ledger failure'; end $$;
      create trigger fail_commission before insert on public.ledger_entries
        for each row execute function public.fail_commission();
    `)
    await assert.rejects(db.query(`update public.deposit_requests set status = 'confirmed' where id = $1`, [deposit(3)]), /simulated ledger failure/)
    const rolledBack = await db.query(`select status from public.deposit_requests where id = $1`, [deposit(3)])
    assert.equal(rolledBack.rows[0].status, 'pending')
    assert.equal((await db.query(`select count(*)::int as count from public.deposit_referral_commissions`)).rows[0].count, 3)
  } finally {
    await db.close()
  }
})
