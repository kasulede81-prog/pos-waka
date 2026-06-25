-- Waka POS — transactional email delivery audit log (Resend / Auth hook).

create table if not exists public.email_delivery_log (
  id uuid primary key default gen_random_uuid(),
  template text not null,
  recipient_email text not null,
  recipient_user_id uuid references auth.users (id) on delete set null,
  subject text,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  resend_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_delivery_log_created_at_idx
  on public.email_delivery_log (created_at desc);

create index if not exists email_delivery_log_recipient_email_idx
  on public.email_delivery_log (recipient_email);

create index if not exists email_delivery_log_template_idx
  on public.email_delivery_log (template);

comment on table public.email_delivery_log is
  'Audit trail for Resend transactional emails (auth hook + future EmailService sends).';

alter table public.email_delivery_log enable row level security;

-- Service role / edge functions only; internal staff read via RPC if needed later.
revoke all on table public.email_delivery_log from anon, authenticated;

grant select, insert on table public.email_delivery_log to service_role;
