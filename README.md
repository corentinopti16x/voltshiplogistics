# Voltship Client App

Next.js app for Voltship clients. **Supabase** is login, Postgres, and file storage. Airtable remains the source of truth for products and sourcing.

See [prd.md](./prd.md) and [architecture.md](./architecture.md).

## Stack

- Next.js (App Router) + Tailwind + FR/EN (`next-intl`)
- Supabase Auth (admin invites only — no public signup)
- Supabase Postgres + Row Level Security
- Supabase Storage (`product-uploads` bucket)

## 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Providers → Email:** enabled.
3. **Authentication → Settings:** **disable** "Allow new users to sign up". Onboarding is
   admin-invite-only; there is no public signup route.
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
5. `supabase/migrations/00005_orders_cache_rls.sql` — RLS on `shopify_orders_cache`
6. `supabase/migrations/00006_shopify_images.sql` — Shopify product images
7. `supabase/migrations/00007_rate_grid_ai.sql` — carrier line / tax flag / RMB cost on rate cells, `rate_grid_imports`, `pricing_settings`
8. `supabase/migrations/00008_eccang.sql` — ECCANG WMS integration (per-client keys, orders, stock, ASN)
9. `supabase/migrations/00009_matrix_ioss_lines.sql` — `rate_grid_cells.ioss_required`, `line_name` in the cell unique key (several lines per carrier), supplement defaulted to 0

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

## Mise à jour des tarifs (assistant + matrice Voltship)

`/admin/pricing/update` ("Mettre à jour les tarifs") lets a Voltship admin turn a carrier
price list into a new versioned rate grid through one of two paths:

- **Matrice Voltship (import direct, no AI)** — the owner's `China_Carriers_Matrix_Vxx.xlsx`
  ("TOUT COMPRIS"): one sheet per `DESTINATION-CATEGORY` (`FRANCE-STANDARD`,
  `USA-ELECTRONICS`…), a header block (`Carrier` / `Tier / Service` / `Delivery` /
  `Size limits` / `Weight (g)` rows) and gram-by-gram prices in RMB per carrier column.
  `src/lib/pricing/matrix-import.ts` (`parseVoltshipMatrix`) is used when the
  "Matrice Voltship (import direct)" box is ticked or a sheet name matches the convention.
  Rules: sheet name → ISO-2 destination + `shipping_channel` (CLOTHING/TEXTILE → standard,
  note "textile"); carrier from the header text (Tongyou/通邮/TK, YunExpress/云途/CHC,
  Huahan/华翰/智, 4PX/递四方/O5/JW); `line_name = Carrier + tier` without the
  "(direct 24/09)" / "[tout compris]" notes; delivery "9-14 d" → "9-14 j", "wd"/"工作日" →
  "j ouvrés"; columns marked OBSOLÈTE/old skipped; gram rows compressed into brackets then
  normalised to the engine's 50 g steps (500 g above 2 kg) **priced at the bracket's max
  gram** (never under-bills); blank cells = not offered; "max 1 kg" in the notes caps the
  line. **Every price is the final carrier cost per parcel**: all lines are
  `tax_included = true`, `vat_extra = false`, no supplement is ever added and every carrier
  competes for the cheapest pick. `ioss_required` (informational badge "IOSS requis", never
  a cost) is set when the notes say "IOSS obligatoire" / "TVA via IOSS" or the line is
  YunExpress CHC / 4PX EU (S5667, S5664, S5682, 欧盟专线). Two lines of one carrier on a
  sheet (USA YunExpress THPHR vs 商派 YTSPTHPH) are imported as distinct cells —
  `line_name` is part of the cell key — and `findRateCell` picks the cheaper.
  "Changement de palier (normal)" notices flag a price that drops at a tier boundary; they
  never block activation. The draft is stored with `carrier = "matrix"` (multi-carrier).
- **Assistant (Claude)** — any raw form: PDF, screenshot, Excel, CSV or pasted text (4PX,
  YunExpress 云途, Tongyou 通邮, Huahan 华翰).

Environment:

```
ANTHROPIC_API_KEY=sk-ant-…      # required; without it the actions return
                                # "Assistant tarifs non configuré (ANTHROPIC_API_KEY)"
ANTHROPIC_MODEL=claude-sonnet-4-5   # optional
```

Flow:

1. **Analyse** — `startRateImportAction` sends the files (≤ 3 × 8 MB; images and PDFs as
   native blocks, CSV/text inline) plus the carrier and a note ("Grille VIP du 24/09") to
   Claude with a JSON-only contract (.xlsx/.xls/.csv are converted server-side to a text
   table per sheet by `src/lib/pricing/spreadsheet-text.ts`; gram-by-gram sheets longer than
   400 rows are sampled every 50 g instead of truncated) (`src/lib/pricing/ai-import.ts`,
   `PRICE_LIST_JSON_SCHEMA`). The reply is normalised (ISO-2 destinations, category →
   `shipping_channel`, per-kg+fee vs. tabular pricing, `tax_included`, `vat_extra`,
   confidence 0–1) and stored as a `rate_grid_imports` draft.
2. **Review** — the admin sees every parsed line (formula or brackets, ⚠ non-inclusive
   tax, ⚠ VAT extra, confidence bar, notes), can exclude a line or flip its tax flag, and
   tune the margin rule for this import. `reviewRateImportAction` recomputes the cells and
   a before/after comparison (cheapest carrier at 100 / 250 / 500 / 1000 g per destination
   and channel against the active grid).
3. **Activate** — `activateRateImportAction` writes `rate_grids` (`source = 'ai_import'` or
   `'matrix_import'`, version `V13-2026-10-04-tongyou` / `-matrix`, settings snapshot) with
   the imported carriers' cells plus every other carrier's cells carried forward from the
   active grid (`mergeGridCells`: every carrier covered by the import is replaced, the rest
   is kept), sets
   `pricing_meta.active_grid_version`, marks the import `activated` and logs
   `pricing.grid_activated` in `audit_log`. Lines with confidence < 0.5 need an explicit
   confirmation. Accepted client quotes stay frozen.

Margin rule (`pricing_meta.pricing_settings`, editable from the review screen):

```
cost_eur = carrier_cost_rmb / fx_rmb_per_eur                  (default 7.50)
price    = round_0.05( cost_eur
                     + max(cost_eur × margin_pct / 100,        (default 12 %)
                           min_margin_eur_per_parcel)          (default 1.50 €)
                     + (tax_included ? 0 : eu_parcel_tax_eur) ) (default 0 — "Supplément
                                                                 manuel par colis", assistant
                                                                 imports only)
```

Weight tiers: per-kg lines are expanded in 50 g steps to 2 000 g then 500 g steps to
5 000 g (priced at the bracket's max weight; USA minimum billable 50 g); tabular sources
keep their brackets. For assistant imports, "VAT on declared value extra" lines (Huahan
智惠选) are excluded by default; matrix imports never exclude a line.

Billed weight (`src/lib/domain/pricing.ts`): when the product has dimensions in
`quote_json` (`length_cm` / `width_cm` / `height_cm`, the same keys as the ECCANG mapping),
`billed_g = max(actual_g × n, n × L×W×H / divisor × 1000)` with the divisor per carrier from
`pricing_settings.volumetric_divisors` (default Huahan 6000, others 8000) — each carrier is
matched on its own billed weight; USA parcels bill at least 50 g; without dimensions the
actual weight is used. The quote detail and the COGS matrix tooltip show "poids facturé"
when it differs from the actual weight. Every quote shown to a client displays carrier + line, weight tier, parcel price
and delivery range taken from the grid cell.

## Shopify

Clients connect their own store through Shopify OAuth — there is no per-store custom app.

1. In the Shopify Partner / Dev dashboard, create the app and copy its client ID and secret
   into `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`.
2. Set `SHOPIFY_SCOPES` to the scope list from `.env.example` (it must match the scopes
   declared on the app).
3. Set the app's **allowed redirection URL** to exactly `NEXT_PUBLIC_APP_URL` +
   `/api/shopify/callback` (production: `https://app.voltshiplogistics.com/api/shopify/callback`).
   Shopify rejects the install if the two differ, including trailing slashes or http/https.
4. Declare the mandatory compliance webhooks (`customers/data_request`, `customers/redact`,
   `shop/redact`) in the app configuration pointing at
   `NEXT_PUBLIC_APP_URL/api/webhooks/shopify/compliance`. These topics cannot be subscribed
   from the Admin API; order webhooks are registered automatically at connect time.

How a client connects: Settings → “Boutique Shopify” → enter `monstore.myshopify.com` →
“Connecter ma boutique”. The browser goes to `/api/shopify/connect?from=client&shop=…`, which
redirects to Shopify's consent screen, then back to `/api/shopify/callback`. The callback
verifies the HMAC and signed state, stores the encrypted offline token, registers order
webhooks, backfills 90 days of orders and the catalogue, and returns to `/settings?connected=1`.
Owners only (`staff` cannot connect or disconnect); max 10 stores per client. Admins can
connect a store on behalf of a client from `/admin/shops` (`from=admin&client_id=…`); the
legacy “custom app already installed” path remains available with `&mode=installed`.

## ECCANG (entrepôt / WMS)

Go-live 8 October 2026. The integration is **flag-gated per client**: with
`clients.eccang_enabled = false` (default) nothing changes. Migration: `supabase/migrations/00008_eccang.sql`.

**Per-client keys.** ECCANG issues one `appKey` / `appToken` per end customer (no global key).
Admin → Clients → *client* → card **Entrepôt (ECCANG)**: paste the appKey and appToken (the token
is AES-GCM encrypted with `ECCANG_TOKEN_ENCRYPTION_KEY`, falling back to
`SHOPIFY_TOKEN_ENCRYPTION_KEY`, and never returned to the browser), click **Tester la connexion**
(`getWarehouse` + `getShippingMethod`), pick the warehouse code, tick *Activer*, save. Then
**Pousser tous les produits validés** creates the catalogue in ECCANG and **Synchroniser
maintenant** pulls stock, orders and inbound notices. `ECCANG_API_HOST` is a single server env
(one OMS instance).

**Shipping-method mapping** (same card, global table in `pricing_meta.eccang_shipping_methods`):
`Carrier` or `Carrier|Line` as written in the active rate grid → ECCANG `shipping_method` code
from `getShippingMethod`. `default` / `default:<ISO2>` act as fallbacks. For every Shopify order the
pricing engine picks the carrier/line for the destination + channel of the product, then the map
gives the ECCANG code. **Without a match the order is not pushed** and the client gets an in-app
notification.

**Flows (`src/lib/eccang/sync.ts`).**

| Trigger | ECCANG service | Writes |
| --- | --- | --- |
| Quote accepted / "Pousser…" | `createProduct` (then `modifyProduct` if the SKU exists) | `products_cache.quote_json._eccang` |
| Shopify `orders/create` webhook (client enabled, SKUs known in `sku_maps` / `products_cache`) | `createOrder` with `reference_no = VS-<client code>-<order number>` | `eccang_orders` |
| Callback `order` / cron | `getOrderByRefCode` → status, tracking, carrier, `order_weight` (= **poids facturé**, kg → g), fees; then Shopify `fulfillmentCreate` with the tracking | `eccang_orders`, Shopify fulfillment |
| "Lancer un restock" with a quantity | `createAsn` (`VSIN-<code>-<date>-<id>`) | `inbound_cache` |
| Callback `receiving` / cron | `getAsnList` → announced / arrived / contrôlé / en stock | `inbound_cache` |
| Callback `stock` / cron | `getProductInventory` (warehouse) → `sellable`, `reserved`, `onway + pending` | `stock_cache` (feeds the restock alerts) |

**Callback URL** to declare in the ECCANG OMS (消息订阅 → 订阅回调, types `order`, `receiving`,
`stock`):

```
https://app.voltshiplogistics.com/api/webhooks/eccang?token=<ECCANG_WEBHOOK_SECRET>
```

ECCANG validates the URL with `GET ?random=<n>` (the route echoes `{"random":"<n>"}`). POST
payloads are stored in `webhook_events` (idempotent on `msg_id`), answered immediately, then the
latest state is pulled with the services above. The tenant is resolved from the `app_key` in the
body.

**Cron** `/api/cron/eccang-sync` every 15 min (`vercel.json`, `deploy/crontab`): for each enabled
client → inventory + pending orders + ASNs; `clients.eccang_last_sync_at` /
`eccang_sync_error` are shown on the admin card and in the admin "Points d'attention" (sync
errors, orders pushed > 48 h without tracking).

## SAV & API publique

Migration : `supabase/migrations/00011_support.sql` (ajoute `order_number`, `placed_at`,
`customer_email_key` à `shopify_orders_cache`, les tables `api_keys`, `support_mailboxes`,
`support_threads`, `support_messages`, `support_drafts`). Les commandes importées avant la
migration n'ont pas de `order_number` : relancer un backfill (reconnecter la boutique ou
attendre les webhooks `orders/updated`).

### API publique de suivi (`/api/public/v1`)

Pour les outils SAV externes (Repline, Gorgias, Zendesk…). Clé créée par le owner dans
Réglages → « API & intégrations SAV » (affichée une seule fois ; seul le SHA-256 est stocké).

- `GET /api/public/v1/health`
- `GET /api/public/v1/orders/{lookup}` — `lookup` = `#1234`, `1234`, `VS-ACME-1234`
  (référence entrepôt), id Shopify ou uuid du cache. `?email=` optionnel : second facteur
  (comparé au hash, jamais renvoyé).
- `GET /api/public/v1/orders?order=1234&email=…`
- Auth : `Authorization: Bearer vs_live_…` → 401 clé invalide/révoquée · 404 commande
  inconnue · 429 au-delà de 60 req/min par clé.

```bash
curl -H "Authorization: Bearer vs_live_…" \
  "https://app.voltshiplogistics.com/api/public/v1/orders/1234"
```

Réponse : `{ order: { number, placed_at, shop }, fulfillment: { status, shipped_at, carrier,
service, tracking_number, tracking_url, billed_weight_g, last_event_at }, items: [{ sku,
title, qty }], warehouse: { reference } }`. `status` ∈ received · preparing · shipped ·
delivered · cancelled · unknown (mapping ECCANG : C/pending → received, W/H → preparing,
D → shipped, X → cancelled, N/P → unknown ; `delivered` est réservé aux événements
transporteur, non suivis pour l'instant).

Le rate-limit est un token bucket en mémoire : sur Vercel il est **par instance** (60/min
par clé et par instance chaude) — suffisant pour freiner une intégration qui boucle, à
remplacer par Upstash/Redis si une limite globale stricte devient nécessaire.

### SAV Lite (Gmail)

Chaque client connecte sa boîte Gmail support (owner uniquement, Réglages → « SAV · Boîte
Gmail »). Toutes les 10 min le cron lit les nouveaux messages (7 derniers jours à la première
synchro, puis `history.list`), les range en tickets (`/support`), identifie la commande
(numéro `#1234` / référence `VS-…` dans le mail, sinon la commande la plus récente du même
e-mail client — comparé par hash, l'adresse n'est jamais stockée en clair) et, si
`ANTHROPIC_API_KEY` est défini, propose une réponse FR/EN dans la langue du client avec le
statut, le transporteur, le lien de suivi et le délai du devis. Rien ne part sans le clic
« Envoyer » (réponse envoyée via Gmail dans le même fil, In-Reply-To/References).

#### Créer l'app OAuth Google (une fois, côté Voltship)

1. Google Cloud Console → créer un projet (ex. `voltship-sav`).
2. **APIs & Services → Library** : activer **Gmail API**.
3. **OAuth consent screen** : type *External*, nom « Voltship SAV », e-mail support, domaine
   autorisé `voltshiplogistics.com`. Scopes : ajouter
   `https://www.googleapis.com/auth/gmail.modify`. Tant que l'app est en *Testing*, ajouter
   chaque boîte client dans *Test users* (max 100, refresh tokens expirent après 7 jours) ;
   passer en *Production* (vérification Google requise pour un scope Gmail restreint)
   pour un usage réel.
4. **Credentials → Create credentials → OAuth client ID** : type *Web application*,
   Authorized redirect URI **exactement**
   `https://app.voltshiplogistics.com/api/support/gmail/callback`
   (et `http://localhost:3000/api/support/gmail/callback` en dev).
5. Copier le Client ID / secret dans `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   (+ `SUPPORT_TOKEN_ENCRYPTION_KEY` optionnel, sinon `SHOPIFY_TOKEN_ENCRYPTION_KEY`).

Déconnexion : Réglages → Déconnecter (le refresh token est effacé, les tickets restent).
Révoquer aussi côté Google si besoin : myaccount.google.com → Sécurité → Accès tiers.

## Scheduled jobs

On Vercel, `vercel.json` schedules both cron routes (Vercel sends `Authorization: Bearer $CRON_SECRET` automatically — set `CRON_SECRET` in the project env). On Docker, production runs these from the `cron` service in `docker-compose.yml`. Put the same secrets in `.env` on the server (`CRON_SECRET` must be set), then:

```bash
docker compose up -d --build
```

The cron container calls the app on the Docker network:

- `/api/cron/airtable-reconcile` every 10 minutes
- `/api/cron/shopify-sync` nightly at 02:15 UTC
- `/api/cron/eccang-sync` every 15 minutes (no-op until `ECCANG_API_HOST` is set and a client is enabled)
- `/api/cron/support-sync` every 10 minutes (no-op until `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set and a client connected Gmail)

Both routes require `Authorization: Bearer $CRON_SECRET`. Order webhooks update Shopify between the nightly run.

Run `npm run test`, `npm run lint`, `npm run build`, and optionally
`npm run test:e2e` before deployment.
