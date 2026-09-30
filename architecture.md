# Voltship Client App — Architecture

**Version:** 2.0  
**Companion:** [prd.md](./prd.md)  
**Phase in scope:** Phase 1 MVP, with extension points for Phase 2/3  
**Confidential**

---

## 1. Architectural intent

Build **one** client-facing web app with a thin typed API. The app stores almost nothing of business truth.

```
┌─────────────────────────────────────────────────────────┐
│                  VOLTSHIP CLIENT APP                    │
│   Next.js (App Router + Route Handlers)                 │
│   Login: Supabase Auth   Files: Supabase Storage        │
│   Caches/tenants: Supabase Postgres + RLS               │
└──────────┬──────────────────┬──────────────┬────────────┘
           │                  │              │
           ▼                  ▼              ▼
     ┌──────────┐       ┌──────────┐   ┌─────────────┐
     │ AIRTABLE │       │ n8n VPS  │   │ CRON + WH   │
     │ products │       │ AI agents│   │ Shopify     │
     │ sourcing │       │ WhatsApp │   │ (sales)     │
     │ quotes   │       │ webhooks │   │ ECCANG P2   │
     │ content  │       │ both ways│   │ (stock/inb.)│
     └──────────┘       └──────────┘   └─────────────┘
```

**Design principles**

1. **Source wins.** Cache is a projection. If cache ≠ source, fix the sync.
2. **Compute on read.** COGS, ROAS, economics, lifecycle (except persisted status for notifications) come from functions, not stored derived columns — except **accepted-quote snapshots**.
3. **Server is the gatekeeper.** Role-based field visibility is applied in serializers. Internal fields never leave the API for client roles.
4. **`client_id` from JWT only.** Never from query/body/path for tenant-scoped reads.
5. **Integrate, don’t rebuild.** n8n agents keep their HTML/file outputs. The app triggers, stores pointers, and links/embeds.
6. **Ship without ECCANG.** Feature flags hide inbound KPIs, live stock, invoices. Airtable + Shopify is a valid launch.

---

## 2. Stack (locked)

Next.js + Supabase. No NestJS, no self-hosted Postgres, no custom JWT stack.

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js** (App Router) + Tailwind + next-intl | Spec UI; FR/EN from day 1; RSC reads caches fast |
| Auth | **Supabase Auth** | Invite-only email/password; sessions as HTTP-only cookies via `@supabase/ssr` |
| Database | **Supabase Postgres** | Spec’s Postgres, hosted. **RLS** is the tenant wall |
| Files | **Supabase Storage** | New-product photos (and later client uploads). QC/agent HTML stay Airtable/Drive in v1 |
| API | Next.js `app/api/**` Route Handlers | Thin server: Airtable, Shopify, n8n, pricing, field filtering |
| Jobs | VPS crontab → `/api/cron/*` (`CRON_SECRET`) | Phase 1: no Redis/BullMQ. Webhooks persist then process |
| Hosting | Next.js Docker on existing VPS | n8n already there. Supabase Cloud = Auth + DB + Storage |
| Shared logic | `src/lib/domain/` | Pricing, economics, lifecycle, visibility, entitlements — one copy |

**Do not** compute prices in the browser as source of truth. `src/lib/domain` may be imported in the client for live unit-economics typing, but grid lookup stays **server-only**. The rate grid is never shipped in full to the browser.

**Supabase project:** hosted (Cloud). Self-hosting the full Supabase stack on the VPS is out of scope — too heavy next to n8n.

---

## 3. Repository layout

```
voltshipclientapp/
├── src/
│   ├── app/
│   │   ├── [locale]/          # next-intl: fr | en
│   │   │   ├── (auth)/login
│   │   │   ├── (client)/      # dashboard, products, inbound, notifications, settings
│   │   │   ├── (sourcer)/
│   │   │   └── (admin)/
│   │   └── api/               # Route Handlers (webhooks, cron, n8n, admin)
│   ├── lib/
│   │   ├── supabase/          # browser, server, middleware, admin (service role)
│   │   └── domain/            # pricing, economics, lifecycle, fieldVisibility
│   ├── i18n/
│   └── messages/              # en.json, fr.json
├── supabase/
│   └── migrations/            # SQL: tables, RLS, storage policies
├── docker-compose.yml         # Next.js only (prod). Local: `next dev` + hosted Supabase
├── .env.example
├── prd.md
└── architecture.md
```

Single Next.js app. No `apps/api` package.

---

## 4. Runtime topology

```
                 ┌ nginx / Caddy (TLS) ┐
                 │  app.voltship.com   │
                 └──────────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         Next.js:3000    n8n (VPS)   crontab → /api/cron
              │
              ▼
     ┌─────────────────────┐
     │  SUPABASE CLOUD     │
     │  Auth · Postgres    │
     │  Storage · RLS      │
     └─────────────────────┘
```

- Staging + prod = two Supabase projects (or two schemas — **prefer two projects**).
- Backups: Supabase PITR on; no app-side `pg_dump` required for Phase 1.
- Browser talks **only** to Next.js + Supabase (Auth + RLS-scoped tables + Storage).
- Airtable, Shopify, ECCANG, n8n: **server Route Handlers only**, using `SUPABASE_SERVICE_ROLE_KEY` when writing caches.

---

## 5. Auth, tenancy, RBAC (Supabase)

### 5.1 Model

- **Invite-only.** Disable public signup in the Supabase dashboard. `voltship_admin` (or owner) calls `supabase.auth.admin.inviteUserByEmail()` from a server action.
- On invite, set `app_metadata`: `{ role, client_id }` (service role only — users cannot edit `app_metadata`).
- Mirror into `public.profiles` (id = `auth.users.id`) via trigger on signup.
- Session: `@supabase/ssr` cookies, refreshed in Next.js middleware. No custom JWT issuance.
- **No password column in our tables.** Supabase Auth owns credentials.

**Impersonation:** `voltship_admin` inserts `impersonation_sessions` (actor, target user, client_id, expires_at) and sets a signed httpOnly cookie. Server helpers `getAuthContext()` prefer that cookie. All writes still log **actor**. UI banner: “Viewing as {client}”. RLS for client tables still uses the **impersonated** `client_id`; audit uses actor.

### 5.2 Tenant isolation (hard rule)

Two layers, both required:

1. **RLS** on every tenant table: `client_id = public.current_client_id()`.
2. **Route/server checks:** `owner`/`staff` never pass `client_id` from the request. `sourcer` / `voltship_admin` use `/admin` and `/sourcer` route groups only.

```
current_client_id() =
  if impersonation cookie valid and actor.role = voltship_admin
    → impersonated client_id
  else if role ∈ {owner, staff}
    → profiles.client_id   -- from auth.uid()
  else
    → NULL (cross-tenant roles must use service role or explicit policy)
```

Sourcer/admin policies: `public.jwt_role() IN ('sourcer', 'voltship_admin')` for queue/admin tables. **Client-safe tables** (`products_cache`, …) still must not contain factory price / supplier.

`FieldVisibility` still applies on any DTO that mixes internal + client fields (sourcer responses vs client RSC). RLS filters **rows**, not columns — so **internal columns never live on `products_cache`**.

### 5.3 Roles → surfaces

| Role | Next.js route group | How they hit data |
|---|---|---|
| owner, staff | `(client)/` | Supabase user client + RLS |
| sourcer | `(sourcer)/` | RLS + server Airtable fetches (internal fields) |
| voltship_admin | `(admin)/` | Service role for invites/grid; RLS elsewhere |

Client nav: Dashboard, Products, Inbound, Notifications, Settings — **only** `(client)/`.

---

## 6. Data model (Supabase Postgres)

App DB owns identity + caches. Airtable record IDs are foreign keys to the real product.  
`auth.users` is the login table. `public.profiles` is our RBAC/tenant row (1:1 with `auth.users`).

### 6.1 Core (identity)

```
clients
  id, name, code, eccang_customer_code, airtable_client_record_id,
  language ('fr'|'en'), plan_tier, timezone,
  financial_profile_json,          -- PSP, URSSAF, VAT, other, min/target margin
  commission_pct, handling_fee, logistics_discount_pct,  -- override; null = from tier
  safety_buffer_days, coverage_target_days,
  lifecycle_thresholds_json,       -- per-client overrides
  created_at

profiles                         -- id = auth.users.id
  id, client_id NULLABLE,        -- null for sourcer / voltship_admin
  email, role, last_login_at     -- no password; Auth owns it

shops
  id, client_id, shopify_domain, access_token_encrypted, status, created_at
  UNIQUE (client_id, shopify_domain)
  CONSTRAINT max 10 shops per client (enforced in service, not only UI)

notifications
  id, client_id, user_id, type, payload_json, channels, read_at, created_at

notification_preferences
  id, client_id, user_id, event_type, in_app, email, whatsapp

audit_log
  id, actor_user_id, impersonated_user_id, client_id, action, entity, diff_json, created_at

webhook_events
  id, source, type, external_id, payload_json, status, attempts, processed_at, error
  UNIQUE (source, external_id)     -- idempotency
```

### 6.2 Caches (projections)

```
products_cache
  id, client_id, airtable_record_id UNIQUE,
  sku, title, photo_url, created_date,
  lifecycle_status, sourcing_status,
  quote_json,                       -- last *sent* quote projection (not live COGS)
  accepted_quote_snapshot_json,     -- frozen: grid_version, carrier, prices, at T
  selling_price,                    -- client-set
  weight_g, shipping_channel, production_lead_days, moq,
  client_price,                     -- the ONE client-visible unit price
  stock_manual,                     -- Phase 1 fallback if ECCANG off
  migration_state,                  -- null | imported_pending | ignored | active
  last_synced_at

  -- NEVER store: factory_price, supplier_*, sourcing_margin on rows that client APIs can leak.
  -- Internal fields live in Airtable; sourcer/admin APIs fetch them on demand and serialize internally.

sales_cache
  id, client_id, shop_id, sku, date, units_sold
  UNIQUE (client_id, shop_id, sku, date)

stock_cache                    -- Phase 2 fill; Phase 1 optional
  id, client_id, sku, qty_available, qty_reserved, inbound_qty,
  reorder_threshold, out_of_stock_since, last_synced_at

inbound_cache                  -- Phase 2
  id, client_id, eccang_ref, status, qty_announced, qty_received,
  photos_json, qc_defect_rate, eta, updated_at
```

### 6.3 Pricing (mirror)

```
rate_grids
  id, grid_version, effective_date, source ('airtable'|'eccang_export'), created_at

rate_grid_cells
  id, grid_version, carrier, destination, channel, weight_min_g, weight_max_g, price

-- Current pointer
pricing_meta
  key = 'active_grid_version', value
```

Commission defaults by tier live in `src/lib/domain/entitlements.ts`. Per-client overrides on `clients`.

### 6.5 Supabase Storage

| Bucket | Who writes | Path | v1 use |
|---|---|---|---|
| `product-uploads` | client owner/staff | `{client_id}/{product_id or tmp}/{file}` | New product photos |
| (later) `qc-photos` | ops / n8n via service role | `{client_id}/{inbound_id}/` | Phase 2 fallback if ECCANG has no photos |

Storage RLS: authenticated user may insert/select only under their `client_id` prefix. Sourcer/admin: service role or role policy.

QC photos and agent HTML in v1 remain Airtable attachments / Drive links — the app displays URLs. Storage is ready so we do not put client uploads in Airtable.

### 6.4 What we deliberately do **not** put in Postgres

- Factory price, WeChat, supplier name (Airtable only; fetched for sourcer/admin)
- Full Reddit HTML (Drive URL / VPS path stored on Airtable + pointer on `products_cache`)
- Invoice PDFs (Phase 2: URL from ECCANG export)

---

## 7. Shared domain (`src/lib/domain`)

This folder is the **contract**. Route Handlers and (limited) client components import it. No I/O.

| Module | Responsibility |
|---|---|
| `pricing.service` | `cogs({ clientPrice, weightG, channel, destination, carrier, clientDiscount, handling })` + bracket lookup **given a grid snapshot** |
| `economics.service` | multiplier, fees, profit, ROAS BE/target/range, max ATC; `null` → `"—"` |
| `lifecycle.service` | ordered rules TESTING → WINNING → DECLINING → DEAD → ARCHIVED |
| `safetyStock.service` | auto reorder point, days left, status OK/REORDER/CRITICAL/OOS, inbound coverage, suggested qty |
| `fieldVisibility` | map `field → { client, sourcer, admin }` |
| `entitlements` | `can(tier, feature)`, quotas |
| `quoteBreakdown` | the 3-line + total client DTO |

**Anti-drift:** unit tests in `src/lib/domain` are the pricing/economics source of truth. No second formula copy in React except importing this folder.

**Accepted quote snapshot** (JSON stored on `products_cache`):

```json
{
  "grid_version": "2026-09-01.3",
  "carrier": "YunExpress",
  "destination": "FR",
  "channel": "standard",
  "weight_g": 420,
  "client_price": 4.20,
  "shipping": 3.90,
  "handling": 1.70,
  "cogs": 9.80,
  "delivery_range": "8-12",
  "accepted_at": "2026-09-03T10:00:00Z"
}
```

Live product page uses **current** grid + commission. If `active_grid_version !== snapshot.grid_version`, show “rates have changed since”.

---

## 8. API design

Reads of tenant caches (library, notifications, settings): **Server Components + Supabase user client** (RLS).  
Writes that touch Airtable / n8n / pricing snapshots: **Route Handlers or Server Actions** with `getAuthContext()` + field filtering.

- Errors: `{ code, message, details? }`
- OpenAPI optional later (`next-swagger-doc`); not a Phase 1 blocker

### 8.1 Client API (examples)

| Method | Path | Notes |
|---|---|---|
| RSC | `/[locale]/dashboard` | KPIs + alerts from caches |
| RSC | `/[locale]/products` | filters: lifecycle, sourcing, q |
| RSC | `/[locale]/products/[id]` | **client serializer** + live COGS + economics |
| PATCH | `/api/v1/products/:id` | selling_price only (client) |
| POST | `/api/v1/products` | New product → Storage upload + Airtable + cache |
| POST | `/api/v1/products/:id/accept-quote` | snapshot freeze + Airtable status + notify |
| POST | `/api/v1/products/:id/quote-question` | note on request |
| POST | `/api/v1/products/:id/deliverables/:type/generate` | entitlement + quota + n8n webhook |
| GET | `/api/v1/inbound` | empty if flag off |
| PATCH | `/api/v1/settings/financial-profile` | |
| PATCH | `/api/v1/settings/notification-preferences` | |
| POST | `/api/v1/products/:id/restock` | Airtable restock request, pre-filled qty |

### 8.2 Sourcer API

| Method | Path | Notes |
|---|---|---|
| GET | `/sourcer/queue` | filters including `backfill=true`; oldest first |
| GET | `/sourcer/queue/:id` | **internal serializer** (factory, supplier, …) |
| PATCH | `/sourcer/queue/:id` | draft fields → Airtable |
| POST | `/sourcer/queue/:id/send-quote` | validate weight+channel+price; compute client_price; notify; return **next** item id |
| POST | `/sourcer/queue/:id/flag` | |

### 8.3 Admin API

Create client, invite user, set tier/commission, connect Shopify OAuth, SKU map, sync health, impersonate, grid CRUD (version bump + audit), CSV backfill, feature flags, lifecycle threshold overrides.

### 8.4 Internal (n8n → app)

`POST /internal/n8n/callback`  
Header `X-Api-Key`. Body: `{ type, client_id, airtable_record_id, deliverable_type, status, urls? }`.  
Idempotent on `(source, external_id)`. Refresh `products_cache`, emit notification.

Outbound: `POST {N8N_WEBHOOK_URL}` with HMAC or shared secret.

---

## 9. Sync architecture

All inbound webhooks: **persist `webhook_events` first** (status=`received`), then process (inline if fast, or cron retry). Marks `processed` / `dead`. Unique `(source, external_id)`. Service role client only.

```
Shopify/Airtable/n8n
        │
        ▼
  webhook_events INSERT   (service role)
        │
        ▼
  same request or /api/cron/process-webhooks
        │
        ▼
  cache tables / notifications / Airtable write-back
```

| Job | Trigger | Work |
|---|---|---|
| `airtable.webhook` | Airtable/n8n | Upsert `products_cache` (client-visible fields only in cache) |
| `airtable.reconcile` | every 10 min | Diff Airtable vs cache |
| `shopify.orders` | webhook | Increment `sales_cache` for date/sku |
| `shopify.backfill` | shop connect | Last 90 days orders |
| `shopify.nightly` | cron | Repair gaps |
| `lifecycle.classify` | nightly + after sales sync | Compute status; if changed: notify + Airtable patch |
| `eccang.poll` | 15 min | **Phase 2** stock/inbound/KPIs |
| `n8n.dispatch` | user Generate | Outbound webhook |
| `notify.dispatch` | domain events | in-app row + email + n8n WhatsApp event |

**Shopify:** custom app, OAuth per shop, encrypted token at rest (AES-256-GCM, key in env). Max 10 shops.

**Airtable:** official API. Week 1 includes a **schema cleanup pass with Voltship** — map tables/fields to:

- Client
- Product
- Sourcing Request
- Quote / rate grid tables
- Deliverable URLs / statuses

Until that mapping exists, implement an `AirtableAdapter` interface so field IDs live in config, not scattered queries.

**ECCANG:** signed requests, timestamp ~1 min validity → NTP/clock-sync + retry. Feature flags: `eccang.stock`, `eccang.inbound`, `kpi.delivery_time`, `kpi.incidents`, `kpi.logistics_cost`.

---

## 10. Frontend architecture

### 10.1 Route groups

```
app/
  [locale]/                    # next-intl: fr | en  (client.language)
    (client)/
      dashboard/
      products/                # library grid
      products/[id]/           # detail
      products/new/
      inbound/
      notifications/
      settings/
    (sourcer)/
      queue/
      queue/[id]/
    (admin)/
      clients/
      pricing/
      sync/
      impersonate/
```

Locale is **not** a user toggle that fights `clients.language`. Admin sets language at client creation; UI always renders that locale for that tenant.

### 10.2 Client pages (Phase 1)

| Page | Behavior |
|---|---|
| Library | Cards: photo, badge, name, sales/day, stock, days-left, ROAS BE. Filters. Newest first |
| Detail | Header → quote card → economics (selling price input) → stock → research blocks → files → activity |
| New product | Form → POST → redirect to product (sourcing: brief received) |
| Dashboard | Alerts + KPI 1 + in-progress + deliverables |
| Notifications | List + mark read |
| Settings | Financial profile, notif prefs, disclaimer |

Sourcer: queue list (age > 5 days highlight) + work form + auto-advance after Send quote.

Admin: client CRUD, invites, tier, shops OAuth, migration product picker, grid editor, sync health, impersonate.

### 10.3 i18n

- `next-intl` message files: `fr.json`, `en.json`
- Email + WhatsApp templates: same keys, rendered in API/n8n payload `locale`
- Adding ES later = new JSON file + locale enum — **no component changes**

### 10.4 Performance

- Dashboard and library read **only Supabase caches** (RLS)
- Live COGS: in-memory active grid (loaded at boot + invalidated on version bump) + product cache row — no Airtable on request path
- Generate research: 202 + `generating`; poll or websocket optional; v1 poll is enough

---

## 11. Module map (code)

| PRD module | Code | Notes |
|---|---|---|
| Auth / tenancy | `lib/supabase` + RLS | Invite, cookies, impersonation |
| Admin back-office | `app/[locale]/(admin)` + `/api/admin` | |
| Product library | `app/[locale]/(client)/products` | cache + serializers |
| Lifecycle | `/api/cron/lifecycle` | |
| New product | `/api/v1/products` + Storage | |
| Sourcer queue | `app/[locale]/(sourcer)` | |
| Pricing | `lib/domain/pricing` | rate store + cogs() |
| Economics | `lib/domain/economics` | |
| Research / n8n | `/api/v1/.../generate` + `/api/internal/n8n` | quotas |
| Inbound | `app/.../inbound` | flag-gated |
| Dashboard | `app/.../dashboard` | |
| Notifications | table + `lib/notifications` | |
| Shopify | `/api/webhooks/shopify` | |
| Airtable | `lib/airtable` adapter | |
| ECCANG | `lib/eccang` | stub + flags |
| Migration | `(admin)` import + select | |
| Entitlements | `lib/domain/entitlements` | |

---

## 12. Security

- HTTPS only; secrets in env / VPS files, never git
- Shopify tokens encrypted
- Rate limit: auth endpoints strict; Generate endpoints by quota **and** IP
- CORS: web origin only
- Internal n8n routes: API key + optional allowlist
- Audit log for: impersonate, grid edit, tier/commission change, quote send/accept, role changes
- OWASP: RLS + parameterized queries (Supabase client), XSS via React default, CSRF via same-site cookies
- `SUPABASE_SERVICE_ROLE_KEY` **server-only** — never `NEXT_PUBLIC_`
- **Penetration-style check:** client session against `/sourcer/*` and `products_cache` must not contain `factory_price`, `supplier_*`

---

## 13. Feature flags & entitlements

```
FEATURE_FLAGS=
  eccang.stock=false
  eccang.inbound=false
  kpi.orders_shipped=true
  kpi.delivery_time=false
  kpi.incidents=false
  kpi.logistics_cost=false
  inbound.announce=false
```

Entitlements matrix (config, not code branches scattered):

```
brief:           bronze, quota
reddit_html:     silver
personas:        bronze
meta_ads_report: gold
early_access:    scale
```

UI: locked tile with teaser + “Included from Silver — contact us”. API returns 403 with `{ upgrade_to: "silver" }` — never hide the tile.

---

## 14. Observability (minimum)

- Structured logs (request id, client_id, actor)
- Worker failure → dead-letter + admin “sync health” page
- Health: `/api/health` (Supabase ping, last successful Airtable reconcile, last Shopify webhook)

---

## 15. Testing strategy

| Layer | What |
|---|---|
| `src/lib/domain` | Pricing, economics (incl. ÷0), lifecycle order, safety stock, entitlements |
| RLS / API | Tenant isolation tests (client A cannot read B), field visibility snapshots, quote snapshot freeze vs live grid |
| E2E (Playwright) | Phase 1 acceptance: new product cycle; migration select; admin grid edit cascade |

---

## 16. How we build — sequence under the full requirement

Do **not** start with the Product Library UI. The library is worthless without tenancy, Airtable mapping, and live pricing. Build in this order; each step is demoable.

### Stage 0 — Kickoff (days 1–2, with Voltship)

**This is the first step. Engineering without it guesses field names and ships the wrong product.**

1. Airtable walkthrough + schema cleanup: lock table/field map into `airtable.mapping.ts`
2. Inventory n8n webhooks (brief, Reddit VOC, statics, Shopify, Meta) — request/response contracts
3. Receive rate grid + one pilot client + Shopify app credentials
4. Agree wireframes: Library, Detail, Dashboard, Sourcer Queue (if no screenshots)

**Exit:** mapping file, webhook contracts, grid CSV in repo as seed, Figma/wireframes signed off.

### Stage 1 — Foundation (week 1)

Scaffold Next.js, Supabase clients, SQL migrations (RLS), CI, `.env.example`.

Implement:

- Tables: `clients`, `profiles`, empty caches later
- Supabase Auth: invite-only, login, middleware session refresh
- Storage bucket `product-uploads` + RLS
- Admin: create client (language, tier), invite user, impersonate + audit
- Seed: one admin, one client, FR + EN messages skeleton

**Exit:** admin can create a client, invite an owner, that owner logs in via Supabase and sees an empty shell in FR or EN. Impersonation audited.

### Stage 2 — Pricing Service + grid (week 1–2)

- Import grid into `rate_grid_cells` with `grid_version`
- `cogs()` + economics util + unit tests
- Admin: edit a cell → version bump → audit
- Client financial profile in Settings (even before products)

**Exit:** given weight/channel/destination/client, API returns COGS; changing a cell changes the next GET. Acceptance test 3 starts here.

### Stage 3 — Airtable sync + Product cache (week 2)

- `AirtableAdapter` + webhook + 10 min reconcile
- `products_cache` upsert of **client-visible** fields
- Client Product Library (cards) + Detail shell (no fake COGS)
- Field visibility serializers + tests that factory/supplier never appear on `/v1/products/:id`

**Exit:** Airtable product appears in the app within ~10 min; client payload is clean.

### Stage 4 — New Product + Sourcer Queue (week 2–3)

- New Product form → Airtable Product + Sourcing Request → cache row `brief received`
- Sourcer queue (cross-tenant), work form (internal fields), Send quote (validate, compute client_price, notify), auto-open next, Flag problem
- Client quote card + Accept (snapshot) + Question note

**Exit:** acceptance test 1 path exists except WhatsApp/n8n and research.

### Stage 5 — Shopify velocity + lifecycle + migration (week 3)

- OAuth, max 10 shops, 90-day backfill, order webhooks, `sales_cache`
- Lifecycle job + Airtable status write-back + notifications
- Migration: import products → admin/client **select winners** → `imported_pending` vs ignored
- Sourcer Backfill filter + admin CSV
- Library badges, banners, ROAS BE on card
- Safety-stock on `stock_manual` / Airtable stock

**Exit:** acceptance test 2 on the pilot shop.

### Stage 6 — n8n agents + notifications (week 3–4)

- Generate buttons → quota → webhook → `generating` → callback → `ready` + Drive/HTML link
- Notification module: in-app + email + event to n8n for WhatsApp
- Quote ready / accepted / deliverable ready / lifecycle events
- Entitlement teasers on locked research

**Exit:** full acceptance test 1 including WhatsApp.

### Stage 7 — Dashboard + polish (week 4–5)

- Alerts banner, KPI 1 (Shopify fulfilled fallback if ECCANG off)
- In-progress products, recent deliverables
- Feature-flagged empty slots so the dashboard looks complete
- Activity log, files as links
- Playwright acceptance suite, README, Docker image on VPS

**Phase 2 after launch:** ECCANG module, inbound UI, remaining KPIs, real stock engine, invoice list, carrier-change admin flow, reconciliation job.

---

## 17. First step — do this on day 1

**Do not open Figma-to-code for the library first.**

### Step 1A (Voltship, same day)

Book the Airtable + n8n walkthrough. Export the current rate grid. Confirm Shopify app ownership.

### Step 1B (dev, same day, even before walkthrough ends)

1. Create a **Supabase** project (staging). Turn **off** public signup. Copy URL + anon key + service role into `.env.local`.
2. Scaffold **Next.js** (App Router, Tailwind, TypeScript) in this repo.
3. Add `@supabase/ssr` + `@supabase/supabase-js`: browser client, server client, middleware, service-role admin client.
4. Apply first SQL migration: `clients` + `profiles` + RLS + `product-uploads` bucket.
5. Login page (email/password) + empty dashboard behind session, **next-intl** `fr`/`en`.

That is the smallest slice that respects **tenancy, language, and Supabase login** — the three rules that every later module hangs off.

Everything in the PRD that is not in Stages 0–7 is **Phase 2/3** and must stay behind flags: ECCANG, invoices, Stripe, marketing angles, client inbound announce, observed transit times, carrier-change notifications, WINNING $X/day ad profit.

---

## 18. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Airtable schema messy | Week 1 cleanup together; adapter isolates field IDs |
| ECCANG API late | Flags off; manual stock; KPI 1 from Shopify |
| Agent HTML reports on Drive | App auth-gated proxy or signed Drive links; do not parse HTML |
| Dual formula implementations | Only `src/lib/domain`; CI fails if UI reimplements |
| Sourcer still uses Airtable | Queue UX + auto-advance is P0, not polish |
| Token leak / tenant bleed | Automated isolation + visibility tests in CI |
| Clock skew vs ECCANG | NTP on VPS; retry window (Phase 2) |

---

## 19. Definition of done (Phase 1)

- README: `npm run dev`, `.env.example`, Supabase migrations, VPS notes
- Three PRD acceptance tests pass (new product cycle, 30-SKU migration, pricing cascade)
- Client queries prove internal fields absent from `products_cache` / client RSC
- FR and EN complete for client surfaces
- Next.js on VPS beside n8n; Auth/DB/Storage on Supabase
