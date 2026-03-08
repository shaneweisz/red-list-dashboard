-- Materialized view for taxa summary (powers /api/redlist/taxa).
-- Driven by redlist_species.taxon_group (assessed species only).
-- GBIF stats joined via species → gbif_species.
-- Refresh after each sync: SELECT refresh_taxa_summary();
create materialized view taxa_summary as
with category_counts as (
  select
    taxon_group,
    jsonb_object_agg(
      coalesce(iucn_category, 'NE'),
      cat_count
    ) as by_category
  from (
    select taxon_group, iucn_category, count(*) as cat_count
    from public.redlist_species
    group by taxon_group, iucn_category
  ) sub
  group by taxon_group
),
species_stats as (
  select
    r.taxon_group,
    count(*) filter (where r.iucn_category is not null) as total_assessed,
    count(*) filter (where r.assessment_date < current_date - interval '10 years') as outdated,
    count(*) filter (where s.gbif_species_key is not null) as gbif_species_count,
    coalesce(sum(g.total_count), 0) as total_gbif_observations,
    coalesce(avg(g.total_count) filter (where s.gbif_species_key is not null), 0) as mean_gbif_obs,
    percentile_cont(0.5) within group (order by g.total_count)
      filter (where s.gbif_species_key is not null) as median_gbif_obs
  from public.redlist_species r
  left join public.species s on s.sis_taxon_id = r.sis_taxon_id
  left join public.gbif_species g on g.gbif_species_key = s.gbif_species_key
  group by r.taxon_group
)
select
  s.taxon_group,
  s.total_assessed,
  s.outdated,
  c.by_category,
  s.gbif_species_count,
  s.total_gbif_observations,
  s.mean_gbif_obs,
  s.median_gbif_obs
from species_stats s
join category_counts c using (taxon_group);

-- Revoke direct API access — API routes query via service role
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

-- Restrict refresh to service_role only (prevent abuse via anon/authenticated keys)
revoke execute on function refresh_taxa_summary() from public, anon, authenticated;
grant execute on function refresh_taxa_summary() to service_role;
