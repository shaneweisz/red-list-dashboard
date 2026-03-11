-- Materialized view for taxa summary (powers /api/redlist/taxa).
-- Scoped to Red List species (sis_taxon_id IS NOT NULL).
-- Refresh after each sync: SELECT refresh_taxa_summary();

create materialized view taxa_summary as
with category_counts as (
  select
    table1a_taxon_group,
    jsonb_object_agg(
      coalesce(iucn_category, 'NE'),
      cat_count
    ) as by_category
  from (
    select table1a_taxon_group, iucn_category, count(*) as cat_count
    from public.species
    where sis_taxon_id is not null
    group by table1a_taxon_group, iucn_category
  ) sub
  group by table1a_taxon_group
),
species_stats as (
  select
    table1a_taxon_group,
    count(*) filter (where iucn_category is not null) as total_assessed,
    count(*) filter (where assessment_date < current_date - interval '10 years') as outdated,
    count(*) filter (where gbif_species_key is not null) as gbif_species_count,
    coalesce(sum(gbif_total_count) filter (where gbif_species_key is not null), 0) as total_gbif_observations,
    coalesce(avg(gbif_total_count) filter (where gbif_species_key is not null), 0) as mean_gbif_obs,
    percentile_cont(0.5) within group (order by gbif_total_count)
      filter (where gbif_species_key is not null) as median_gbif_obs
  from public.species
  where sis_taxon_id is not null
  group by table1a_taxon_group
)
select
  s.table1a_taxon_group,
  s.total_assessed,
  s.outdated,
  c.by_category,
  s.gbif_species_count,
  s.total_gbif_observations,
  s.mean_gbif_obs,
  s.median_gbif_obs
from species_stats s
join category_counts c using (table1a_taxon_group);

-- Revoke direct API access — accessed via get_taxa_summary() RPC
revoke select on taxa_summary from anon, authenticated;

-- Function to refresh the materialized view (callable via supabase.rpc)
create or replace function refresh_taxa_summary()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view taxa_summary;
$$;

-- Restrict refresh to service_role only
revoke execute on function refresh_taxa_summary() from public, anon, authenticated;
grant execute on function refresh_taxa_summary() to service_role;

-- RPC wrapper for anon access
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
