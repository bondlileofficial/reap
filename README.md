# Reap

Reap is a React app built with Vite and Supabase. Supabase Auth manages account credentials and persistent sessions. The database migration defines profiles, plans, packages, a ledger, tasks, task completions, referral attribution and commissions, verified ad revenue, and USDT deposit/withdrawal request records with row-level security.

## Set up Supabase

1. Create a project at [supabase.com](https://supabase.com/).
2. In **Project Settings → API**, copy the Project URL and the publishable key (or legacy anon key).
3. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role key in a `VITE_` variable or browser code.
4. In the Supabase SQL Editor, run [`supabase/migrations/202611230001_initial_schema.sql`](./supabase/migrations/202611230001_initial_schema.sql), [`supabase/migrations/202611230002_referrals.sql`](./supabase/migrations/202611230002_referrals.sql), [`supabase/migrations/202611240001_withdrawal_requests.sql`](./supabase/migrations/202611240001_withdrawal_requests.sql), [`supabase/migrations/202611240002_referral_required.sql`](./supabase/migrations/202611240002_referral_required.sql), [`supabase/migrations/202611240003_deposit_requests.sql`](./supabase/migrations/202611240003_deposit_requests.sql), [`supabase/migrations/202611240004_timed_video_tasks.sql`](./supabase/migrations/202611240004_timed_video_tasks.sql), [`supabase/migrations/202611240005_profile_contact_details.sql`](./supabase/migrations/202611240005_profile_contact_details.sql), [`supabase/migrations/202611240006_validate_referral_code.sql`](./supabase/migrations/202611240006_validate_referral_code.sql), [`supabase/migrations/202611240007_deposit_requests_without_txid.sql`](./supabase/migrations/202611240007_deposit_requests_without_txid.sql), [`supabase/migrations/202611240008_deposit_proofs_and_review.sql`](./supabase/migrations/202611240008_deposit_proofs_and_review.sql), and [`supabase/migrations/202611240009_wallet_package_purchases.sql`](./supabase/migrations/202611240009_wallet_package_purchases.sql). If earlier migrations are already applied, run only the migrations not yet applied.
5. In **Authentication → URL Configuration**, set the Site URL to `https://reapnow.netlify.app` and add `https://reapnow.netlify.app/**` to Redirect URLs. Add `http://localhost:5173/**` only for local development. Signup confirmation emails explicitly redirect to the origin where the user registered.
6. Start the app with `npm run dev`.

Without Supabase environment variables, the dashboard opens in preview mode so it can be explored without a database connection. Account features, referral data, and crypto actions remain unavailable in preview mode. Once configured, users can create accounts and sign in; the website enforces a five-minute maximum session and requires sign-in again if the site is closed for more than ten seconds. New users must enter a valid referral code or follow a `https://your-site/REFERRALCODE` link. Email confirmation behavior is controlled in the Supabase Auth settings.

## Deploy to Netlify

1. Push this project to a Git provider such as GitHub, GitLab, or Bitbucket.
2. In Netlify, select **Add new site → Import an existing project**, authorize the provider, and choose this repository. Netlify reads [`netlify.toml`](./netlify.toml) for the build command (`npm run build`) and publish directory (`dist`).
3. If enabling Supabase, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in **Site configuration → Environment variables**, then trigger a new deploy. These are public client values; do not set a service-role key.
4. Add the deployed Netlify URL to Supabase **Authentication → URL Configuration** as the site URL and an allowed redirect URL.

Referral levels are 10% (direct), 5% (second level), and 3% (third level). The referral page displays the full invite URL; opening it takes a new visitor to signup with the referral code prefilled. The database records commissions only when a trusted backend confirms a `verified_ad_revenue` event; deposits and package purchases do not generate referral commissions. The referral page displays the user's referral counts and verified commission totals.

## Security and next steps

Row-level security restricts personal records to their owner. The browser can update only the signed-in user's profile name and phone number; email is managed by Supabase Auth and shown as read-only in Settings. Ledger, task completion, verified ad revenue, referral commission, deposit, and package writes are intentionally not available to the browser. Withdrawal requests are created through a database function that checks the authenticated user's confirmed balance, reserves pending requests, and records the fee and net payout; never expose a service-role key in React.

Deposit requests require a screenshot (JPG, PNG, or WebP up to 5 MB), stored in the private `deposit-proofs` bucket. The admin-only **Review** page shows pending requests and uses short-lived signed links to display proofs. To grant access, first sign in to Reap with the operator's account, then run this once in the Supabase SQL Editor (replace the email):

```sql
insert into public.transaction_review_admins (user_id)
select id from auth.users where lower(email) = lower('operator@example.com')
on conflict (user_id) do nothing;
```

The allowlist is empty by default, so no account has review access until an operator is explicitly added. The page's database functions independently verify reviewer authorization. Verify deposits on-chain before using **Approve & credit**; approval confirms the request and adds one confirmed ledger entry. For withdrawals, send the payout manually first, then use **Approve & mark paid** to debit the wallet and mark the request paid. Rejection does not credit a deposit and releases a withdrawal reservation. Each decision is transactional and cannot be repeated after the request status changes. Existing pending deposits without a proof image cannot be approved by the new function. Wallet balances refresh while the user is signed in.

Withdrawal requests are recorded in `withdrawal_requests`, have a $5 minimum and 5% fee, reserve funds while pending, and require manual review and payment. Users can buy an active package with their confirmed wallet balance; the purchase is debited from the wallet and the package activates immediately, while any remainder stays available. Video tasks use the local files in `public/task videos`; the timed-task migration seeds them and adds server-side start/completion functions. Rewards are split evenly across the daily rewards and task limits of the user's active packages, and are credited only after the server confirms the task has been started for at least 30 seconds. The timer only counts while the video is playing and the page is visible; a timer does not independently prove a person watched or generate revenue. To sync transaction inserts and status updates to the linked Google Sheet, deploy [`google-apps-script/Code.gs`](./google-apps-script/Code.gs) as a Web App, store its secret in Apps Script properties and Netlify environment variables, and configure Supabase Database Webhooks for insert/update events on both request tables to call `/.netlify/functions/sync-transactions` with the matching `x-sync-secret` header. Never put the sync secret in frontend variables or source control. The sheet should be restricted to the intended operator before syncing transaction details. Package terms should be reviewed before publishing.
