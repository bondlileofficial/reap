# Reap

Reap is a React app built with Vite and Supabase. Supabase Auth manages account credentials and persistent sessions. The database migration defines profiles, plans, packages, a ledger, tasks, task completions, referral attribution and commissions, verified ad revenue, and USDT deposit/withdrawal request records with row-level security.

## Set up Supabase

1. Create a project at [supabase.com](https://supabase.com/).
2. In **Project Settings → API**, copy the Project URL and the publishable key (or legacy anon key).
3. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role key in a `VITE_` variable or browser code.
4. In the Supabase SQL Editor, run [`supabase/migrations/202611230001_initial_schema.sql`](./supabase/migrations/202611230001_initial_schema.sql), [`supabase/migrations/202611230002_referrals.sql`](./supabase/migrations/202611230002_referrals.sql), [`supabase/migrations/202611240001_withdrawal_requests.sql`](./supabase/migrations/202611240001_withdrawal_requests.sql), [`supabase/migrations/202611240002_referral_required.sql`](./supabase/migrations/202611240002_referral_required.sql), then [`supabase/migrations/202611240003_deposit_requests.sql`](./supabase/migrations/202611240003_deposit_requests.sql). If earlier migrations are already applied, run only the migrations not yet applied.
5. In **Authentication → URL Configuration**, set the local site URL to `http://localhost:5173` and add your production URL when deploying.
6. Start the app with `npm run dev`.

Without Supabase environment variables, the dashboard opens in preview mode so it can be explored without a database connection. Account features, referral data, and crypto actions remain unavailable in preview mode. Once configured, users can create accounts and sign in; the website enforces a five-minute maximum session and requires sign-in again if the site is closed for more than ten seconds. New users must enter a valid referral code or follow a `https://your-site/REFERRALCODE` link. Email confirmation behavior is controlled in the Supabase Auth settings.

## Deploy to Netlify

1. Push this project to a Git provider such as GitHub, GitLab, or Bitbucket.
2. In Netlify, select **Add new site → Import an existing project**, authorize the provider, and choose this repository. Netlify reads [`netlify.toml`](./netlify.toml) for the build command (`npm run build`) and publish directory (`dist`).
3. If enabling Supabase, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in **Site configuration → Environment variables**, then trigger a new deploy. These are public client values; do not set a service-role key.
4. Add the deployed Netlify URL to Supabase **Authentication → URL Configuration** as the site URL and an allowed redirect URL.

Referral levels are 10% (direct), 5% (second level), and 3% (third level). The database records commissions only when a trusted backend confirms a `verified_ad_revenue` event; deposits and package purchases do not generate referral commissions. The referral page displays the user's invite link, referral counts, and verified commission totals.

## Security and next steps

Row-level security restricts personal records to their owner. The browser has read access to personal records and can update only a profile display name. Ledger, task completion, verified ad revenue, referral commission, deposit, and package writes are intentionally not available to the browser. Withdrawal requests are created through a database function that checks the authenticated user's confirmed balance, reserves pending requests, and records the fee and net payout; never expose a service-role key in React.

Deposit requests require a TRON transaction ID and are recorded as pending in `deposit_requests`; they are not automatically verified or credited to balances. Withdrawal requests are recorded in `withdrawal_requests`, have a $5 minimum and 5% fee, reserve funds while pending, and require manual review and payment. To sync transaction inserts and status updates to the linked Google Sheet, deploy [`google-apps-script/Code.gs`](./google-apps-script/Code.gs) as a Web App, store its secret in Apps Script properties and Netlify environment variables, and configure Supabase Database Webhooks for insert/update events on both request tables to call `/.netlify/functions/sync-transactions` with the matching `x-sync-secret` header. Never put the sync secret in frontend variables or source control. The sheet should be restricted to the intended operator before syncing transaction details. Package terms should be reviewed before publishing.
