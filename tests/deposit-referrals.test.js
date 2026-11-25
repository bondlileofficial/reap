import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const inviter = '00000000-0000-0000-0000-000000000001'
const direct = '00000000-0000-0000-0000-000000000002'
const indirect = '00000000-0000-0000-0000-000000000003'
const existing = '00000000-0000-0000-0000-000000000004'
const failing = '00000000-0000-0000-0000-000000000005'

test('first approved deposits pay only the direct inviter once and preserve history', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema storage;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.profiles (id uuid primary key references auth.users(id), display_name text);
      create table public.ledger_entries (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references auth.users(id),
        entry_type text not null,
        amount_usd numeric(18, 6) not null check (amount_usd > 0),
        status text not null,
        reference text unique
      );
      create table public.deposit_requests (
        id uuid primary key,
        user_id uuid not null references auth.users(id),
        amount_usd numeric(18, 2) not null,
        status text not null,
        proof_path text
      );
      create table storage.objects (bucket_id text, name text);
      create function public.is_transaction_reviewer() returns boolean language sql
        as $$ select current_setting('test.reviewer', true) = 'yes' $$;
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/202611230002_referrals.sql', import.meta.url), 'utf8'))
    const reviewMigration = await readFile(new URL('../supabase/migrations/202611240008_deposit_proofs_and_review.sql', import.meta.url), 'utf8')
    const approvalFunction = reviewMigration.match(/create or replace function public\.approve_deposit_request\(p_request_id uuid\)[\s\S]*?\n\$\$;/)
    assert.ok(approvalFunction)
    await db.exec(approvalFunction[0])

    await db.query(`insert into auth.users (id) values ($1), ($2), ($3), ($4), ($5)`, [inviter, direct, indirect, existing, failing])
    await db.query(`
      insert into public.profiles (id, referral_code, referred_by) values
      ($1, 'INVITER', null), ($2, 'DIRECT', $1), ($3, 'INDIRECT', $2),
      ($4, 'EXISTING', $1), ($5, 'FAILING', $1)
    `, [inviter, direct, indirect, existing, failing])
    await db.query(`
      insert into public.verified_ad_revenue (user_id, event_reference, revenue_usd, status)
      values ($1, 'historical', 10, 'confirmed')
    `, [direct])
    await db.query(`
      insert into public.deposit_requests (id, user_id, amount_usd, status, proof_path) values
      ('10000000-0000-0000-0000-000000000001', $1, 20, 'pending', 'direct1'),
      ('10000000-0000-0000-0000-000000000002', $1, 30, 'pending', 'direct2'),
      ('10000000-0000-0000-0000-000000000003', $2, 40, 'pending', 'indirect'),
      ('10000000-0000-0000-0000-000000000004', $3, 10, 'confirmed', 'old'),
      ('10000000-0000-0000-0000-000000000005', $3, 50, 'pending', 'existing'),
      ('10000000-0000-0000-0000-000000000006', $4, 60, 'pending', 'missing'),
      ('10000000-0000-0000-0000-000000000007', $1, 100, 'rejected', 'rejected')
    `, [direct, indirect, existing, failing])
    await db.exec(`
      insert into storage.objects values
        ('deposit-proofs', 'direct1'), ('deposit-proofs', 'direct2'),
        ('deposit-proofs', 'indirect'), ('deposit-proofs', 'existing');
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/202611250003_first_deposit_referrals.sql', import.meta.url), 'utf8'))
    await db.exec(`select set_config('test.reviewer', 'no', false)`)
    await assert.rejects(db.query(`select public.approve_deposit_request('10000000-0000-0000-0000-000000000001')`), /not authorized/)
    await db.exec(`select set_config('test.reviewer', 'yes', false)`)

    await assert.rejects(db.query(`select public.approve_deposit_request('10000000-0000-0000-0000-000000000006')`), /screenshot is missing/)
    await db.exec(`
      insert into storage.objects values ('deposit-proofs', 'missing');
      create function public.fail_referral_credit() returns trigger language plpgsql as $$
      begin
        if new.entry_type = 'referral_commission' then
          raise exception 'simulated referral ledger failure';
        end if;
        return new;
      end;
      $$;
      create trigger fail_referral_credit before insert on public.ledger_entries
        for each row execute function public.fail_referral_credit();
    `)
    await assert.rejects(db.query(`select public.approve_deposit_request('10000000-0000-0000-0000-000000000006')`), /simulated referral ledger failure/)
    const rolledBack = await db.query(`select count(*)::text as count from public.ledger_entries where user_id = $1`, [failing])
    assert.equal(rolledBack.rows[0].count, '0')
    await db.exec(`drop trigger fail_referral_credit on public.ledger_entries`)
    for (const id of ['001', '002', '003', '005']) {
      await db.query(`select public.approve_deposit_request($1)`, [`10000000-0000-0000-0000-000000000${id}`])
    }
    await assert.rejects(db.query(`select public.approve_deposit_request('10000000-0000-0000-0000-000000000001')`), /not pending/)

    const commissions = await db.query(`
      select source_user_id, recipient_id, amount_usd::text from public.deposit_referral_commissions order by source_user_id
    `)
    assert.deepEqual(commissions.rows, [
      { source_user_id: direct, recipient_id: inviter, amount_usd: '2.000000' },
      { source_user_id: indirect, recipient_id: direct, amount_usd: '4.000000' },
    ])
    const ledger = await db.query(`select amount_usd::text from public.ledger_entries where user_id = $1 and entry_type = 'referral_commission' order by amount_usd`, [inviter])
    assert.deepEqual(ledger.rows.map((row) => row.amount_usd), ['1.000000', '2.000000'])
    await db.query(`select set_config('test.uid', $1, false)`, [inviter])
    const summary = await db.query(`select level_1_count::text, level_1_earnings::text from public.get_my_referral_summary()`)
    assert.deepEqual(summary.rows, [{ level_1_count: '3', level_1_earnings: '3.000000' }])

    await db.query(`insert into public.verified_ad_revenue (user_id, event_reference, revenue_usd, status) values ($1, 'new-ad', 100, 'confirmed')`, [direct])
    const historical = await db.query(`select count(*)::text as count from public.referral_commissions`)
    assert.equal(historical.rows[0].count, '1')
    const failed = await db.query(`select status from public.deposit_requests where user_id = $1`, [failing])
    assert.equal(failed.rows[0].status, 'pending')
  } finally {
    await db.close()
  }
})
