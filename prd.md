# Voltship Client App — Product Requirements Document

**Version:** 2.0  
**Status:** Final (Phase 1 MVP) — requirements unchanged vs spec v2.0  
**Owner:** Corentin Le Gal — Voltship Logistics  
**Audience:** Development  
**Replaces:** voltship-portal-spec v1.0 (architecture reference only)  
**Confidential**

### Build status (repo, not a spec change)

Compared to spec v2.0 (same document as this PRD): **no new product requirements.** Stack exception already recorded below: **Next.js + Supabase Auth/Postgres/Storage** instead of NestJS + self-hosted Postgres.

| Slice | State |
|---|---|
| Docs (this PRD + architecture.md) | Done |
| Supabase SQL (`clients`, `profiles`, caches, RLS, storage bucket) | `00001`–`00004` applied on the project database |
| Next.js + FR/EN + client and staff login + both dashboards | Implemented, including orders-shipped, restock alerts, and staff operations home |
| Admin: create client, invite, impersonate, plan tier, lifecycle rules | Done |
| Pricing Service, Product Library, Detail, New product, Sourcer Queue | Implemented; the three acceptance tests below have not been run on live pilot data |
| Airtable | Connected to ECDF BASE. Product writes and restock requests are mapped. Inbound webhooks need a public app URL |
| Shopify | Custom app credentials work for ECDF. Connect uses the installed app. Nightly sync is defined in `docker-compose.yml` and is not running on a server yet |
| n8n / email / WhatsApp / research pack | Code is in place. Webhook URL and shared secret are still empty |
| Production cron | Airtable every 10 minutes and Shopify at 02:15 UTC, via the Compose `cron` service. Not deployed |
| ECCANG, invoices, Stripe | Phase 2 / 3 — do not start |

**Next build step:** deploy off localhost, set the n8n webhook URL and shared secret, then run the three Phase 1 acceptance tests with the pilot client.

---

## 1. Problem & product intent

Voltship clients (e-commerce founders) currently live across Airtable forms, Fillout, WhatsApp, and ops-owned tools. They cannot see, in one place:

- Their product library, classified by performance
- A simple quote (price + shipping) they can accept
- Stock, days of stock left, and restock alerts
- Inbound shipments and QC photos
- AI research already produced by Voltship’s n8n / OPTI16X agents

**This app is the client-facing product.** It is not a logistics WMS, not a billing engine, and not ECCANG. The client logs in and sees products, quotes, stock, inbound, KPIs, and research. Voltship staff (admin + sourcer) use a thin internal layer on the same product records.

**Simplicity is a hard requirement.** Target user is a non-technical e-commerce founder. Max 5 nav items. No screen should need explanation.

---

## 2. Goals & non-goals

### Goals (Phase 1)

A Voltship client can:

1. Log in and see **his** product library as visual cards, auto-classified (Winning / Testing / Declining / Dead).
2. Open a product and see sourcing status, quote (price + shipping), stock, days of stock left, unit economics, and AI research.
3. Submit a **New product request** in-app (replaces the external form).
4. Accept a quote or send a short question (not chat).
5. See a dashboard with restock alerts + at least the Orders shipped KPI.
6. Receive notifications (in-app, email, WhatsApp via n8n) in his account language (FR or EN).

Voltship staff can:

7. Create clients, invite users, set plan tier, impersonate (audit-logged).
8. Process **all** clients’ sourcing requests from one Sourcer Queue without opening Airtable for day-to-day work.
9. Connect Shopify shops, select winning products to migrate, and backfill missing sourcing data.

The system:

10. Treats Airtable as source of truth for products / sourcing / quotes / content.
11. Computes COGS and unit economics **live** from one Pricing Service (never stores computed COGS except on accepted-quote snapshots).
12. Gates AI generation by plan tier, server-side.

### Explicitly out of scope (do not build)

| Out of scope | Why |
|---|---|
| Logistics back-office / order-by-order tracking | ECCANG is used internally by Voltship staff |
| Client-facing ECCANG features | Client never sees ECCANG |
| Billing engine / invoice generation | ECCANG is master of billing; invoices = Phase 2 display-only |
| Chat / messaging | Quote “Question” is a note, not a thread |
| Native mobile apps | Responsive web only |
| Stripe subscription billing | Phase 3 (tiers set manually in v1) |
| Rebuilding n8n / OPTI16X agents | App triggers webhooks and displays/links existing outputs |
| Full spec v1.0 logistics portal | Only if later demand proves it |

---

## 3. Users, tenancy, roles

**1 client company = 1 tenant.** Users belong to one tenant. Every tenant-scoped query **must** derive `client_id` from the authenticated session (JWT), never from request params.

| Role | Scope | Access |
|---|---|---|
| `owner` | One tenant | Full client UI + settings (financial profile, notification prefs, shops) |
| `staff` | One tenant | Client UI; no billing/plan/admin settings |
| `sourcer` | Cross-tenant | Sourcing Queue + product work form only (internal fields). Not the client library as a client. |
| `voltship_admin` | Cross-tenant | Create client, invite, shops OAuth, SKU map, sync health, impersonate, plan tier, rate grid, commissions |

**Shopify shops:** up to **10 per tenant** (hard constant). Shops exist only for sales-velocity sync. Logistics order flow Shopify → ECCANG is **outside** this app.

**Language:** set per client at creation. Entire client UI, emails, and WhatsApp copy render in that language. Launch: **FR + EN**. Adding a language = translation files only.

---

## 4. Source-of-truth rules (non-negotiable)

| Data | Owner | App role |
|---|---|---|
| Products, sourcing pipeline, quotes, suppliers, AI content | **Airtable** | Read/write via API |
| Stock, inbound, QC photos, logistics KPIs | **ECCANG WMS** | Read-only sync (cache). Phase 2; Phase 1 may use Airtable/manual stock |
| Sales / orders per shop | **Shopify** | Read-only sync (velocity) |
| Users, clients, shop mapping, notifications, sessions | **Supabase (Postgres + Auth)** | Owner |
| Product photo uploads (new-product form) | **Supabase Storage** | App writes; Airtable still holds ops attachments / Drive links |
| Rate grids (quote/COGS estimates) | **Airtable mirror of ECCANG grid** | Versioned; ECCANG is billing master |
| Computed COGS, ROAS, economics | **Pricing Service (live)** | Never stored, except accepted-quote / invoice snapshots |

If app cache and source disagree → **source is right**, fix the sync.

### Technical stack (locked)

| Layer | Choice |
|---|---|
| App | **Next.js** (App Router) + Tailwind + next-intl (FR/EN) |
| Auth | **Supabase Auth** — invite-only email/password, no public signup |
| Database | **Supabase Postgres** — tenants, caches, notifications, rate-grid mirror. Row Level Security enforces `client_id` |
| Files | **Supabase Storage** for client uploads; Airtable/Drive for QC & agent HTML in v1 |
| API | Next.js Route Handlers (server-only). Browser never talks to Airtable / Shopify / n8n / ECCANG |
| Jobs | VPS cron → authenticated `/api/cron/*` routes (no Redis required for Phase 1) |
| Hosting | Next.js Docker on Voltship VPS (beside n8n). **Supabase Cloud** for Auth + DB + Storage |

---

## 5. Client-facing information architecture

**Nav (max 5):** Dashboard · Products · Inbound · Notifications · Settings

### 5.1 Dashboard (home)

Top to bottom:

1. **Alert banner** (only if any): “N SKUs under restock threshold” + **Launch restock** per SKU (creates restock Sourcing Request in Airtable, pre-filled). Phase 1: based on whatever stock data exists. Full engine = Phase 2.
2. **4 KPI cards** — each behind a feature flag. App must look complete with **only card 1** active.
   - Orders shipped (today / 7d / 30d) — ECCANG outbound; fallback Shopify fulfilled. **Phase 1: this card on.**
   - Avg delivery time by destination (30d) — hide if no data
   - Incident rate (lost/blocked %) — feature-flagged
   - Avg logistics cost per order — feature-flagged
3. Products in progress (sourcing not finished) — compact cards
4. Inbound in transit — compact timeline rows (hide/empty if ECCANG off)
5. Recent deliverables — last AI research/content items

### 5.2 Product Library (heart of the app)

**Card:** photo dominant, lifecycle badge, name, 3 numbers: sales/day (14-day avg), stock available, days of stock left. Also show **ROAS Break-Even** at a glance.

**Default sort:** newest first (product creation date).  
**Filters:** lifecycle status, sourcing status, text search.  
**Click card → Product Detail.**

#### Lifecycle auto-classification (nightly + on sync)

Per-client configurable thresholds in DB; Voltship admin can tune. Defaults, evaluated **in this order**:

| Status | Badge | Rule |
|---|---|---|
| TESTING | blue | created < 60 days AND not WINNING |
| WINNING | gold | avg ≥ 5 orders/day over last 14 days |
| DECLINING | orange | previously WINNING/active AND last-30-days sales < 50% of previous 30 days |
| DEAD | grey | 0 sales in last 90 days AND stock > 0 |
| ARCHIVED | hidden | 0 sales 90 days AND stock = 0 (auto-hidden, recoverable) |

Sales source: Shopify orders sync, sum per SKU per day across the client’s shops.

Status change → in-app notification + push to Airtable product field (ops/n8n can react).

**Suggested action banners:**

| Status | Banner / CTA |
|---|---|
| WINNING | “Secure your restock” → restock request · “Upgrade to branded packaging” → request to Voltship |
| TESTING | “Generate research pack” |
| DECLINING | “Stock covers ~N days at current pace — review before restocking” |
| DEAD | “Free storage ending / clearance options” → request to Voltship |

#### Stock status (library + detail + dashboard)

| Status | Meaning |
|---|---|
| OK | stock above safety level |
| Reorder now | at/below safety; waiting longer → stockout before restock arrives |
| Critical | projected stockout even if ordered today (days-left < lead time) |
| Out of stock | 0 available, with since-date + estimated lost sales |

Inbound in transit **counts toward projected coverage** (“covered by inbound”).  
Suggested reorder qty = `sales/day × coverage target` (default 60 days, client-adjustable), rounded to MOQ.

Safety stock:

- **Manual:** fixed unit threshold
- **Auto (default):** `sales/day × (production lead time + shipping-to-warehouse time + buffer days)` — buffer default 7 days

Phase 1: run on whatever stock exists (Airtable/manual). Full automation with ECCANG = Phase 2.

### 5.3 Product Detail

Sections, top to bottom:

1. **Header** — photo gallery, name, SKU, lifecycle badge, sourcing pipeline:  
   `brief → factories → samples → negotiation → validated → in production → in stock`
2. **Quote / COGS block** — max 3 lines + total, per destination (selector = client’s main markets from onboarding):
   - Product (client price — ONE number)
   - Shipping (destination) — **real carrier name + delivery time** (e.g. YunExpress · 8–12 days). Quoted range as fallback in v1; observed average = Phase 2
   - Fulfillment / handling
   - **COGS / unit** total  
   Badge: **Estimated** until first real shipments, then **Real** (Phase 2, packed weight from ECCANG).  
   Label: “per unit, single-item parcel” + tooltip that multi-SKU parcels are billed on **total packed weight**.  
   If weight + channel missing → **“pending sourcing data”**, not a fake price.  
   **Accept quote** → status change + notify Voltship.  
   **Question** → short text, creates a note on the request (not chat).
3. **Unit Economics calculator** (killer feature) — see §6
4. **Stock & safety-stock block** — available, reserved, inbound, sales/day, days-left, 30-day sparkline, stock status, suggested reorder, Launch restock
5. **Research & content** — see §7
6. **Files** — sample photos/videos, QC reports, Drive/Airtable links (display only in v1)
7. **Activity log** — status changes, quotes sent, deliverables added

### 5.4 New Product Request

Prominent **New product** button → in-app form (replaces Airtable/Fillout):

- Product name
- Photo upload and/or 1688 / AliExpress / competitor link
- Description & requirements
- Target unit price
- Expected launch qty
- Destination markets
- Notes

Submit → create **Sourcing Request + Product** in Airtable (linked to client) → n8n existing flow (Drive folder, sourcer notify). Product appears immediately with status **Sourcing: brief received**.

### 5.5 Inbound (Module 4)

List + timeline per inbound: `announced → arrived → QC in progress → stocked / quarantined`  
ETA, qty announced vs received, defect rate, QC photos.

v1: **read-only** for the client. Data from ECCANG poll 15 min (Phase 2) or Airtable/ops photos via n8n.  
v1.5: client “Announce a shipment” form.

### 5.6 Notifications

In-app list + unread. Deep links into product / inbound.

### 5.7 Settings (client)

- Financial profile (once): PSP %, URSSAF/social %, VAT %, other fees %, min margin %, target margin %  
  Defaults: `0 / 0 / 0 / 0 / 15 / 20`  
  Disclaimer: “indicative estimates — not accounting advice”
- Safety-stock buffer days, coverage target days
- Notification preferences (event × channel toggles)
- Language (inherited from client; owner may not change freely unless product allows)
- Connected shops (read-only for client; admin connects)

---

## 6. Unit economics (one formula source)

Client types **selling price** on the product page (saved per product). Everything computes live.

| Metric | Formula |
|---|---|
| Multiplier | `selling_price ÷ COGS` — color: &lt;2 red, 2–3 orange, ≥3 green |
| Total fees | `(PSP + URSSAF + VAT + other) × selling_price` |
| Available profit / sale | `selling_price − COGS − total_fees` |
| ROAS Break-Even | `selling_price ÷ available_profit` |
| ROAS Target | `selling_price ÷ (available_profit − target_margin × selling_price)` |
| ROAS Target range | ±20% around ROAS Target |
| ROAS −20% | loss-threshold alert |
| Max ATC cost | `20% × AOV` (AOV = selling_price in v1; real AOV from Shopify in Phase 2) |

Division by zero → show **“—”**, never #DIV/0.  
All computation in **one shared typed util**, used by API and (if needed) UI for live typing — formulas must match. Prefer server-side as source of truth; client may mirror for instant feedback.

Phase 2 WINNING: “at current volume this product generates ~$X/day of available ad profit”.

---

## 7. AI research deliverables

Per product, each block: `not generated` | `generating` | `ready (date)` + Generate / Refresh.

| Deliverable | Notes |
|---|---|
| Product brief | Structured: what it is, specs, target price positioning |
| Reddit research | Level-3 persona matrices; **do not re-render HTML** — summary line + “Open full research” to hosted HTML (Drive or VPS behind app auth) |
| Personas | 2–4 cards |
| Marketing angles | Optional v1.5 |

**Mechanics:** button → `POST` n8n webhook `{ client_id, product_record_id, deliverable_type }` → agent writes Airtable + files → callback to app internal endpoint (API key) → refresh cache + notify user.

**Gating:** generation quotas per plan tier, checked server-side. Locked features **visible** with teaser + “Included from [tier] — contact us”.

App **integrates**, never rebuilds agent outputs.

---

## 8. Field visibility (CRITICAL)

Same Airtable record, two views. **Filter server-side.** Never send internal fields to the client browser.

| Field | Client | Internal | Notes |
|---|---|---|---|
| Product name, photos, SKU | yes | yes | |
| Factory purchase price | **NEVER** | yes | Margin protection |
| Supplier name & contact | **NEVER** | yes | Anti-bypass |
| Sourcing location (city/region) | no | yes | Batch factory visits |
| Supplier defect rate history | no | yes | |
| Client price (one number) | yes | yes | Factory + sourcing commission. No tier tables in client UI |
| Sourcing margin | no | yes | |
| Unit weight (g) | yes | yes | |
| Shipping channel category | yes | yes | Enum — see below |
| Production lead time (days) | yes | yes | |
| MOQ | yes | yes | |
| Estimated shipping / destination | yes | yes (+ buy rate & margin) | |
| QC sampling notes | report only | full | |

**Shipping channel enum:** `standard` | `electronics-battery` | `cosmetics` | `liquid-perfume` | `magnetic` | `sensitive-other`  
Drives eligible carrier lines, rate grid, and client warning text (e.g. battery → dedicated line, +X days).

Client-facing quote is **4 numbers max:** unit price, weight, production lead time, shipping estimate. Richer data stays internal.

Implementation: `field_visibility` constant map; API serializers select by role.

---

## 9. Sourcer Queue (staff-facing)

New role `sourcer`. One ticket-style screen across **all** clients.

**List:** open sourcing/restock requests, oldest-first. Filters: client, status, shipping channel.  
Columns: photo, client, request date, status, age (**highlight > 5 days**).  
**Backfill filter:** imported products missing internal data (migration).

**Work form (only fields he must fill):** factory purchase price, supplier name + contact, sourcing location, unit weight (g), shipping channel, production lead time, MOQ, sample photos, notes.

Buttons: **Save draft** · **Send quote to client** · **Flag problem** (needs client input → notification + short reason).

**Send quote validation:** weight + channel + price required. Client price = factory + commission % (client settings) or manual override. Then status → quote sent, client notified. **Next queue item auto-opens.**

All writes go to Airtable. Sourcer never needs Airtable for daily work.

---

## 10. Pricing Service (CRITICAL)

One rate store, one commission table, one pricing function. Displayed numbers are computed **live**.

```
COGS(product, destination, client) =
  client_product_price
  + grid[carrier][destination][bracket(weight)] × (1 − client_discount)
  + handling(client)
```

- **Rate store:** carrier × destination × weight bracket → price. Data, not code. Lives in Airtable, mirrored to app DB, **versioned** (`grid_version`, `effective_date`).
- **Commission table:** per-client sourcing commission %, handling fee, logistics discount % (tier default, admin override).
- **Never store** COGS / ROAS / economics. Update a grid cell or commission % → every page shows new numbers on next load.
- **Snapshots only** for: accepted quote, invoices (Phase 2). Historical docs never change. If live rates differ from snapshot → “rates have changed since” notice.
- Grid edits: admin-only, audit-logged, bump `grid_version`.
- App **never generates invoices**. ECCANG is billing master. App grid is a **mirror**.
- Quotes store the `grid_version` they were computed with. Outdated → subtle “rates updated” on product page.
- **Multi-SKU:** do not display or imply per-SKU shipping sums. Per-product COGS labeled “per unit, single-item parcel”.

Carrier-change (Phase 2): admin selects products/destinations, new carrier, one reason line → notifications + live COGS cascade. Example: *“YunExpress raised rates on FR; we moved your product X to 4PX — new COGS $9.50 (−$0.30), delivery 8–10 days”*.

---

## 11. Plans & entitlements

`plan_tier` on client + entitlements matrix in **config** (feature → min tier + quota). Tier names/prices/mapping are data — Voltship iterates without code changes.

v1: tier set **manually** by admin. Stripe = Phase 3.

| Tier (indicative) | In-app entitlements | Logistics discount* |
|---|---|---|
| Bronze (~€1,300/mo) | Product pages agent, AI video, Static agent, base ecosystem | 5% |
| Silver (~€2,000/mo) | + deep Reddit research (HTML), content/winner scraping | 10% |
| Gold (~€3,500/mo) | + Meta Ads daily report, Kalodata/TrendTrack deliverables, monthly API credit quota, priority support flag | 15–20% |
| Scale (~€7,500/mo) | + early access feature flags | 20%+ |

\*Discount = `client_discount` in Pricing Service. Changing tier instantly updates displayed COGS.

Locked features: **visible teaser**, not hidden. Generation quotas + usage counter visible to client.

Human services (dedicated staff, media buyer, China trip) are **outside the app**; listed on plan description only.

---

## 12. Notifications

One internal module; channels pluggable.

| Channel | v1 | Who sends |
|---|---|---|
| In-app | yes | App |
| Email | yes | App |
| WhatsApp | yes | App emits event → **n8n** owns templates/numbers. No WhatsApp API in the app |

All copy localized to client language.

**Events:** quote ready (with deep link), quote accepted (to Voltship/sourcer), inbound received (+ photos), stock under threshold, lifecycle change (esp. → WINNING / → DECLINING), deliverable ready, carrier change (Phase 2), flag problem.

Per-client prefs: which events × which channels.

---

## 13. Bulk migration (existing catalogs)

**Policy:** import **WINNING products only**. Dead/dormant stay out; future tests enter via New Product.

Flow:

1. Client connects shop(s)
2. App imports Shopify products
3. Admin (or client) **selects** which to activate
4. Selected land in library as **imported — data pending**
5. Rest stay ignored (re-importable later)
6. **90-day Shopify order backfill** on connect so classification works day 1
7. Sourcer Backfill queue (and admin CSV) fills weight, channel, factory price, supplier, lead time
8. Product is fully **active** (COGS + economics) only when weight + channel + price are filled — never show fake numbers

**Acceptance:** 30-product existing shop → classified library day 1; sourcer finishes backfill in days; no extra dev.

---

## 14. Integrations (product requirements)

| Integration | Direction | Method | Frequency |
|---|---|---|---|
| Airtable | R/W | REST + webhooks (or n8n relay) | webhook + 10 min reconcile |
| Shopify | Read | OAuth per shop, orders webhook + daily backfill | real-time + nightly |
| ECCANG | Read | Signed Open API (clock-sync + retry) | poll 15 min — **Phase 2** |
| n8n | Both | Outbound webhooks / inbound internal API (API key) | event-driven |

Webhook events persisted to `webhook_events` **before** processing; retries + dead-letter; **idempotent** handlers.

**Launch constraint:** ship even if only Airtable + Shopify are live. ECCANG features **flagged off**; quote grid maintained manually in Airtable with `grid_version` discipline.

---

## 15. Non-functional requirements

- **UX:** max 5 client nav items; cut or move complexity to internal views
- **i18n:** FR + EN from day 1; new language = translation files only
- **Security:** tenant isolation, RBAC, encrypted Shopify tokens, HTTPS, rate limiting, audit log, OWASP basics, no secrets in repo. Internal fields never reach client responses
- **Performance:** dashboard &lt; 2s from caches; never block UI on Airtable/Shopify/ECCANG
- **Time:** store UTC, display client TZ
- **Files:** QC photos / deliverables = Airtable attachments or Drive links in v1 — app displays
- **Ops:** Next.js on Voltship VPS (n8n already there). Supabase Cloud for Auth/DB/Storage (point-in-time recovery on). App secrets in env, never in git.
- **Code:** Voltship-owned Git org, CI (lint/test/build), README, `.env.example`, staging + prod

---

## 16. Phasing

### Phase 1 — MVP (~4–5 weeks) — BUILD THIS

Auth + tenancy + admin (create client, invite, impersonate, plan tier) · Airtable sync · Product Library + lifecycle (Shopify sales + 90-day backfill) · Bulk migration (Shopify import, winning-only select, sourcer Backfill) · Product Detail (COGS with carrier + delivery time, Unit Economics, research blocks gated by tier, Generate → n8n, HTML links) · New Product form · Sourcer Queue · Client financial profile · Central Pricing Service · Dashboard (alerts + orders-shipped KPI) · Notifications (in-app + email + WhatsApp via n8n) · per-client language · safety-stock on whatever stock exists

**Phase 1 acceptance tests:**

1. **New product cycle entirely in-app:** client submits → sourcer processes from Queue → quote sent → client gets WhatsApp → sees COGS card (carrier + delivery time) → accepts → research pack generated (if tier allows). **Nobody opened Airtable.**
2. **Migration:** 30-product shop connects → winning products selected → library classified day 1 → sourcer completes backfill from Queue.
3. **Pricing cascade:** admin updates one grid cell or a client’s commission % → every COGS/ROAS display updates on next load; a previously **accepted** quote still shows its frozen snapshot.

### Phase 2 (~2–3 weeks)

ECCANG syncs (stock, inbound + QC, remaining KPIs, invoices display, real-weight COGS) · full safety-stock engine · weekly quote-vs-invoice reconciliation · restock buttons wired fully · client inbound announcement · observed delivery times · carrier-change notifications

### Phase 3

Stripe tiers · marketing angles deliverable · white-label (logo, app.voltship.com) · spec v1.0 logistics portal **only if demand**

---

## 17. Kickoff inputs (Voltship must provide)

These are **blocking** for real data, not for scaffolding:

1. Airtable base access + 30-min table walkthrough (schema cleanup is week 1, done together)
2. n8n access + OPTI16X agent inventory + webhook contracts
3. 1 pilot client: shops, SKUs, sample sourcing records + 1 existing shop for migration test
4. Current rate grids + commission/discount settings
5. Shopify custom app credentials (or dev creates, Voltship owns)
6. ECCANG API docs/credentials when obtained (**Phase 2 blocker only**)
7. UI direction / screenshots, else wireframes for Library + Detail + Dashboard + Sourcer Queue **before** coding screens

---

## 18. Success metrics (product)

- Zero Airtable usage by clients and sourcers for the happy path
- Pilot client sees classified library the day their shop is connected
- Quote → WhatsApp → Accept round-trip without ops copy-paste
- Grid/commission change reflected on next page load with no recalc job
- No internal field (factory price, supplier, WeChat) ever present in a client API payload
