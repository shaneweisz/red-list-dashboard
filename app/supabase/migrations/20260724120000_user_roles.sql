-- Role-based access control, following Supabase's documented pattern:
-- https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac
--
-- Deliberately skips that guide's Custom Access Token Auth Hook step (which
-- injects the role into the JWT for use in RLS policies elsewhere) — this
-- app checks roles from trusted server-side Next.js API routes/actions, not
-- from client-side Supabase queries gated by RLS, so a direct table query
-- is simpler and sufficient. Add the hook later only if a client-side RLS
-- policy ever needs to reference someone's role.

create type app_role as enum ('admin');

create table public.user_roles (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade not null,
  role app_role not null,
  granted_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

-- Signed-in users can see their own roles (handy for client-side UI checks
-- later, e.g. "show an admin badge"); nobody can grant/revoke their own role
-- via the client — that's deliberately not covered by any insert/update/
-- delete policy, so it only happens via the Supabase Studio Table Editor,
-- the SQL Editor, or the service-role key.
create policy "Users can view their own roles"
  on public.user_roles for select
  using (auth.uid() = user_id);

-- Run once after applying this migration, to grant yourself the admin role:
--
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'shaneweisz@gmail.com';
