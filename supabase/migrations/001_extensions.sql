-- Waka POS — foundation extensions (PostgreSQL 15+ / Supabase)
-- Safe to run multiple times.

create extension if not exists "pgcrypto";

comment on extension "pgcrypto" is 'Random UUIDs / crypto helpers used by seed scripts.';
