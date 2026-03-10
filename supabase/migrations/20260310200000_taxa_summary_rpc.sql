-- Wrap taxa_summary in an RPC so anon doesn't need direct select on the mat view.
-- Revoke the direct grant from the earlier migration.
revoke select on taxa_summary from anon, authenticated;

create or replace function get_taxa_summary()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_agg(row_to_json(t))
  from taxa_summary t;
$$;

grant execute on function get_taxa_summary() to anon, authenticated;
