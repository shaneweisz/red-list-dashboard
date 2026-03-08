-- Enable pg_trgm for fuzzy/substring search (in extensions schema per Supabase convention)
create schema if not exists extensions;
create extension if not exists pg_trgm schema extensions;
