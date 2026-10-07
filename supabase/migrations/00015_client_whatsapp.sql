-- Voltship Client App — WhatsApp number per client (notifications sent by n8n).
-- Run in the Supabase SQL editor. Safe to re-run.
alter table public.clients
  add column if not exists whatsapp_number text;

comment on column public.clients.whatsapp_number is
  'E.164 number (e.g. +33612345678) that receives the WhatsApp notifications (quote ready, stock, lifecycle). Null = no WhatsApp.';
