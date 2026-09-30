-- Allow "view as client" before any user exists on that tenant.
alter table public.impersonation_sessions
  alter column target_user_id drop not null;
