# Voltship Client App

Next.js app for Voltship clients. **Supabase** is login, Postgres, and file storage. Airtable remains the source of truth for products and sourcing.

See [prd.md](./prd.md) and [architecture.md](./architecture.md).

## Stack

- Next.js (App Router) + Tailwind + FR/EN (`next-intl`)
- Supabase Auth (admin invites plus optional self-service workspace signup)
- Supabase Postgres + Row Level Security
- Supabase Storage (`product-uploads` bucket)

## 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Providers → Email:** enabled.
3. **Authentication → Settings:** leave signup enabled for the current self-service
   `/signup` flow. Turn it off if Voltship chooses admin-invite-only onboarding.
4. Copy Project URL, `anon` key, and `service_role` key.

```bash
cp .env.example .env.local
```

Fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only — never expose to the browser)

## 2. Run the migrations

In the Supabase SQL editor, run in order:

1. `supabase/migrations/00001_init.sql` — `clients`, `profiles`, RLS, storage
2. `supabase/migrations/00002_app_tables.sql` — caches, audit, impersonation, rate grid
3. `supabase/migrations/00003_impersonation_nullable.sql` — view-as-client before the first invite
4. `supabase/migrations/00004_phase1_foundation.sql` — pricing delivery ranges, sourcing work, Shopify caches and atomic sales updates

## 3. Create the first admin (one-time)

Authentication → Users → Add user (email + password).

Then in SQL (replace the email):

```sql
update public.profiles
set role = 'voltship_admin', client_id = null
where email = 'you@voltship.com';
```

If the profile row is missing (trigger didn’t fire), insert it using the user’s UUID from Authentication.

Also set Auth redirect URLs:

- `http://localhost:3000/auth/callback`
- later: `https://app.voltship.com/auth/callback`

## 4. Run the app

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → client login at `/login`.

- **Client owner / staff** → `/login` then `/dashboard` (tenant-scoped, no admin access)
- **voltship_admin / sourcer** → `/staff/login` then `/admin` or `/sourcer`
- **View as client** → client dashboard with an audit-logged banner

French UI: [http://localhost:3000/fr/login](http://localhost:3000/fr/login). Staff: [http://localhost:3000/staff/login](http://localhost:3000/staff/login).

Invite a user from the client page. If you leave the password blank, the admin screen shows a generated password once — give it to the client so they can sign in.

## Phase 1 modules

- Auth, tenancy, admin onboarding and impersonation
- Product library, detail, requests, financial profile and notifications
- Versioned Pricing Service with frozen accepted quotes
- Airtable adapter, webhook and reconciliation cron
- Sourcer Queue with isolated internal supplier fields
- Shopify OAuth, 90-day backfill, product migration and lifecycle classification
- Research dispatch/callback with plan entitlements and quotas
- Docker, CI, unit tests and Playwright smoke/acceptance coverage

External integrations activate when their server-only values from `.env.example` are
configured. Without Airtable or n8n credentials, local development keeps requests in
a visible pending/fallback state rather than exposing secrets to the browser.

## Scheduled jobs

Production runs these from the `cron` service in `docker-compose.yml`. Put the same secrets in `.env` on the server (`CRON_SECRET` must be set), then:

```bash
docker compose up -d --build
```

The cron container calls the app on the Docker network:

- `/api/cron/airtable-reconcile` every 10 minutes
- `/api/cron/shopify-sync` nightly at 02:15 UTC

Both routes require `Authorization: Bearer $CRON_SECRET`. Order webhooks update Shopify between the nightly run.

Run `npm run test`, `npm run lint`, `npm run build`, and optionally
`npm run test:e2e` before deployment.
