# Reap

Reap is a React app built with Vite and Supabase. Supabase Auth manages account credentials and persistent sessions. The database migration defines profiles, plans, packages, a ledger, tasks, task completions, referral attribution and commissions, verified ad revenue, and USDT deposit/withdrawal request records with row-level security.

## Set up Supabase

1. Create a project at [supabase.com](https://supabase.com/).
2. In **Project Settings → API**, copy the Project URL and the publishable key (or legacy anon key).
3. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role key in a `VITE_` variable or browser code.
4. In the Supabase SQL Editor, run [`supabase/migrations/202611230001_initial_schema.sql`](./supabase/migrations/202611230001_initial_schema.sql), then [`supabase/migrations/202611230002_referrals.sql`](./supabase/migrations/202611230002_referrals.sql). If you already ran the initial schema migration, run only the new referrals migration.
5. In **Authentication → URL Configuration**, set the local site URL to `http://localhost:5173` and add your production URL when deploying.
6. Start the app with `npm run dev`.

Without Supabase environment variables, the dashboard opens in preview mode so it can be explored without a database connection. Account features, referral data, and crypto actions remain unavailable in preview mode. Once configured, users can create accounts and sign in; Supabase Auth persists and refreshes their sessions. New users can enter a referral code or follow a `?ref=CODE` link. Email confirmation behavior is controlled in the Supabase Auth settings.

## Deploy to Netlify

1. Push this project to a Git provider such as GitHub, GitLab, or Bitbucket.
2. In Netlify, select **Add new site → Import an existing project**, authorize the provider, and choose this repository. Netlify reads [`netlify.toml`](./netlify.toml) for the build command (`npm run build`) and publish directory (`dist`).
3. If enabling Supabase, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in **Site configuration → Environment variables**, then trigger a new deploy. These are public client values; do not set a service-role key.
4. Add the deployed Netlify URL to Supabase **Authentication → URL Configuration** as the site URL and an allowed redirect URL.

Referral levels are 10% (direct), 5% (second level), and 3% (third level). The database records commissions only when a trusted backend confirms a `verified_ad_revenue` event; deposits and package purchases do not generate referral commissions. The referral page displays the user's invite link, referral counts, and verified commission totals.

## Security and next steps

Row-level security restricts personal records to their owner. The browser has read access to personal records and can update only a profile display name. Ledger, task completion, verified ad revenue, referral commission, deposit, withdrawal, and package writes are intentionally not available to the browser. Add these through a trusted server/Edge Function that verifies ad revenue, payments, and task eligibility; never expose a service-role key in React.

The deposit dialog displays the configured USDT TRC20 receiving address, but payments are not automatically detected, verified, or credited to user balances. Do not treat a transfer as a deposit until transaction verification, balance accounting, withdrawal authorization, and applicable compliance requirements are implemented and reviewed. BNB (BEP20) deposits are not supported. Withdrawals are not connected to a payment provider. Package terms should be reviewed before publishing.
