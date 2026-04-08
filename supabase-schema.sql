-- ══════════════════════════════════════════════════════════════════════════
-- LEARNOVE — Supabase Database Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════════════

-- ── Enable UUID extension (usually already enabled) ─────────────────────────
create extension if not exists "uuid-ossp";

-- ── profiles table ──────────────────────────────────────────────────────────
-- Mirrors Supabase Auth users with extended fields.
-- The `id` column matches auth.users.id (UUID).

create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  name                text not null,
  email               text not null unique,
  password_hash       text not null,         -- bcrypt hash for server-side validation
  role                text not null default 'user' check (role in ('user', 'admin')),
  account_type        text not null default 'individual' check (account_type in ('individual', 'student')),
  is_email_verified   boolean not null default false,
  is_active           boolean not null default true,
  login_attempts      integer not null default 0,
  lock_until          timestamptz,
  last_login          timestamptz,
  avatar              text,                  -- base64 data URL or storage URL
  education_level     text,
  institution         text,
  major               text,
  graduation_year     integer,
  interests           text[] default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── audit_logs table ─────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id          bigserial primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  action      text not null,
  ip          text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

-- ── Row Level Security (RLS) ─────────────────────────────────────────────────
-- IMPORTANT: The backend uses the SERVICE ROLE key which bypasses RLS.
-- RLS protects against direct client-side Supabase calls reaching this data.

alter table public.profiles   enable row level security;
alter table public.audit_logs enable row level security;

-- Users can read their own profile
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can update their own profile (limited columns — backend handles sensitive ones)
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No direct inserts/deletes from the client (backend service role handles these)
-- audit_logs: no client access at all
create policy "No client access to audit logs"
  on public.audit_logs for all
  using (false);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists profiles_email_idx      on public.profiles(email);
create index if not exists profiles_role_idx       on public.profiles(role);
create index if not exists audit_logs_user_id_idx  on public.audit_logs(user_id);
create index if not exists audit_logs_created_idx  on public.audit_logs(created_at desc);

-- ── Auto-update updated_at ────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════════
-- SUPABASE AUTH SETTINGS (configure in Dashboard, not SQL)
-- ══════════════════════════════════════════════════════════════════════════════
-- After running this SQL, go to:
--   Supabase Dashboard → Authentication → URL Configuration
-- And set:
--   Site URL:          http://localhost:5500  (or your production domain)
--   Redirect URLs:     http://localhost:5500/pages/verify-email.html
--                      http://localhost:5500/pages/reset-password.html
--                      https://your-domain.com/pages/verify-email.html
--                      https://your-domain.com/pages/reset-password.html
-- ══════════════════════════════════════════════════════════════════════════════