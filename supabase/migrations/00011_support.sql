-- Voltship Client App — Public tracking API + SAV Lite (Gmail)
-- Run in the Supabase SQL editor AFTER 00010. Safe to re-run.
--
-- * shopify_orders_cache: order_number (Shopify "#1234" without the "#"), placed_at and
--   customer_email_key (SHA-256 of the lowercased e-mail) so the public API and the SAV
--   can look an order up by number / by customer e-mail. The raw e-mail is never stored.
-- * api_keys: per-client keys for the public tracking API (vs_live_… → SHA-256 hash only).
-- * support_mailboxes / support_threads / support_messages / support_drafts: SAV Lite.
--   Customer e-mails are hashed (customer_email_hash / from_email_hash); only the display
--   name is kept. Bodies are plain text trimmed to 20k characters.
--
-- Every table is readable by the tenant through RLS (select only) and written exclusively
-- through the service role (server actions / cron / OAuth callbacks).

-- --- Orders cache -----------------------------------------------------------------------

alter table public.shopify_orders_cache
  add column if not exists order_number text,
  add column if not exists placed_at timestamptz,
  add column if not exists customer_email_key text;

comment on column public.shopify_orders_cache.order_number is
  'Shopify order_number ("1234", no "#"). Used by the public API and the SAV order matcher.';
comment on column public.shopify_orders_cache.customer_email_key is
  'SHA-256("email:" || lower(email)). Second factor of the public API and SAV matcher. Raw e-mail never stored.';

create index if not exists shopify_orders_number_idx
  on public.shopify_orders_cache (client_id, order_number)
  where order_number is not null;
create index if not exists shopify_orders_email_key_idx
  on public.shopify_orders_cache (client_id, customer_email_key)
  where customer_email_key is not null;

-- --- Public API keys --------------------------------------------------------------------

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  scopes text[] not null default '{orders:read}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

comment on table public.api_keys is
  'Public tracking API keys. The key itself (vs_live_<48 hex>) is shown once; only its SHA-256 is stored.';

create index if not exists api_keys_client_idx on public.api_keys (client_id, created_at desc);

alter table public.api_keys enable row level security;

drop policy if exists "tenant_select" on public.api_keys;
create policy "tenant_select" on public.api_keys for select to authenticated
  using (client_id = public.current_client_id());

-- --- SAV Lite ---------------------------------------------------------------------------

create table if not exists public.support_mailboxes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null default 'gmail' check (provider in ('gmail')),
  email_address text not null,
  refresh_token_encrypted text not null,
  history_id text,
  last_sync_at timestamptz,
  sync_error text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, provider, email_address)
);

comment on column public.support_mailboxes.refresh_token_encrypted is
  'AES-256-GCM (iv.tag.cipher, base64url) — SUPPORT_TOKEN_ENCRYPTION_KEY or SHOPIFY_TOKEN_ENCRYPTION_KEY. Never returned to the browser.';

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  mailbox_id uuid not null references public.support_mailboxes (id) on delete cascade,
  provider_thread_id text not null,
  subject text,
  customer_email_hash text,
  customer_name text,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  matched_order_number text,
  matched_order_id uuid references public.shopify_orders_cache (id) on delete set null,
  last_message_at timestamptz,
  last_direction text check (last_direction in ('in', 'out')),
  snippet text,
  created_at timestamptz not null default now(),
  unique (mailbox_id, provider_thread_id)
);

create index if not exists support_threads_client_idx
  on public.support_threads (client_id, status, last_message_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads (id) on delete cascade,
  provider_message_id text not null unique,
  direction text not null check (direction in ('in', 'out')),
  from_name text,
  from_email_hash text,
  body_text text not null default '',
  received_at timestamptz not null default now(),
  is_draft boolean not null default false,
  sent_at timestamptz,
  rfc_message_id text,
  created_at timestamptz not null default now()
);

comment on column public.support_messages.rfc_message_id is
  'RFC 5322 Message-ID header, used for In-Reply-To / References when replying.';

create index if not exists support_messages_thread_idx
  on public.support_messages (thread_id, received_at);

create table if not exists public.support_drafts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads (id) on delete cascade,
  body_text text not null,
  intent text not null default 'other'
    check (intent in ('where_is_my_order', 'delivery_delay', 'damaged', 'return', 'other')),
  confidence numeric(4, 3),
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_message_id uuid references public.support_messages (id) on delete set null
);

create index if not exists support_drafts_thread_idx
  on public.support_drafts (thread_id, generated_at desc);

alter table public.support_mailboxes enable row level security;
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_drafts enable row level security;

drop policy if exists "tenant_select" on public.support_mailboxes;
create policy "tenant_select" on public.support_mailboxes for select to authenticated
  using (client_id = public.current_client_id());

drop policy if exists "tenant_select" on public.support_threads;
create policy "tenant_select" on public.support_threads for select to authenticated
  using (client_id = public.current_client_id());

drop policy if exists "tenant_select" on public.support_messages;
create policy "tenant_select" on public.support_messages for select to authenticated
  using (exists (
    select 1 from public.support_threads t
    where t.id = support_messages.thread_id and t.client_id = public.current_client_id()
  ));

drop policy if exists "tenant_select" on public.support_drafts;
create policy "tenant_select" on public.support_drafts for select to authenticated
  using (exists (
    select 1 from public.support_threads t
    where t.id = support_drafts.thread_id and t.client_id = public.current_client_id()
  ));

-- Writes stay service_role only (no insert/update/delete policies).
