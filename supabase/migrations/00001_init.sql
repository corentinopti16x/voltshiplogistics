-- Voltship Client App — identity, tenancy, storage
-- Run in the Supabase SQL editor (or via supabase db push).
-- Then: Authentication → Providers → Email: disable "Confirm email" for local
-- if needed; Authentication → Settings: turn OFF "Allow new users to sign up".

create extension if not exists "pgcrypto";

do $$ begin
  create type public.user_role as enum ('owner', 'staff', 'sourcer', 'voltship_admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.plan_tier as enum ('bronze', 'silver', 'gold', 'scale');
exception when duplicate_object then null;
end $$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  language text not null default 'en' check (language in ('fr', 'en')),
  plan_tier public.plan_tier not null default 'bronze',
  timezone text not null default 'Europe/Paris',
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  email text not null,
  role public.user_role not null,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role::text from public.profiles where id = auth.uid()
$$;

create or replace function public.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select client_id from public.profiles where id = auth.uid()
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, client_id)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce((new.raw_app_meta_data->>'role')::public.user_role, 'staff'),
    nullif(new.raw_app_meta_data->>'client_id', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.clients enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own_or_staff" on public.profiles;
create policy "profiles_select_own_or_staff"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

drop policy if exists "clients_select_own_or_staff" on public.clients;
create policy "clients_select_own_or_staff"
  on public.clients for select
  to authenticated
  using (
    id = public.current_client_id()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

insert into storage.buckets (id, name, public)
values ('product-uploads', 'product-uploads', false)
on conflict (id) do nothing;

drop policy if exists "product_uploads_select_own_client" on storage.objects;
create policy "product_uploads_select_own_client"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'product-uploads'
    and (
      (storage.foldername(name))[1] = public.current_client_id()::text
      or public.current_role() in ('sourcer', 'voltship_admin')
    )
  );

drop policy if exists "product_uploads_insert_own_client" on storage.objects;
create policy "product_uploads_insert_own_client"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-uploads'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );
