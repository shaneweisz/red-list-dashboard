-- Single species table: all Red List and GBIF species, matched where possible.
-- Red List-only species have sis_taxon_id set, GBIF columns null.
-- GBIF-only species have gbif_species_key set, assessment columns null.
-- Matched species have both keys populated.

create table public.species (
  id                          bigint generated always as identity primary key,

  -- Natural keys (nullable — one or both populated depending on source)
  sis_taxon_id                integer unique,
  gbif_species_key            integer unique,

  -- Shared
  scientific_name             text not null,
  common_name                 text,
  taxon_group                 text not null,

  -- Red List assessment data (null for GBIF-only species)
  class_name                  text,
  order_name                  text,
  family                      text,
  assessment_id               integer,
  iucn_category               text,
  assessment_date             date,
  year_published              text,
  population_trend            text,
  countries                   text[] default '{}',

  -- GBIF occurrence data (null for Red-List-only species)
  gbif_total_count            integer,
  gbif_count_since_assessment integer,

  -- Metadata
  synced_at                   timestamptz default now()
);

-- Indexes
create index idx_species_scientific_name_trgm
  on public.species using gin(scientific_name extensions.gin_trgm_ops);
create index idx_species_taxon_group on public.species(taxon_group);
create index idx_species_iucn_category on public.species(iucn_category);
create index idx_species_assessment_date on public.species(assessment_date);
create index idx_species_countries on public.species using gin(countries);
create index idx_species_gbif_total_count on public.species(gbif_total_count);
create index idx_species_class_name on public.species(class_name);
create index idx_species_order_name on public.species(order_name);

-- RLS
alter table public.species enable row level security;
create policy "Species are readable by everyone"
  on public.species for select using (true);

-- Materialized view for taxa summary (powers /api/redlist/taxa).
-- Scoped to Red List species (sis_taxon_id IS NOT NULL).
-- No joins needed — all data is in the single species table.
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
    from public.species
    where sis_taxon_id is not null
    group by taxon_group, iucn_category
  ) sub
  group by taxon_group
),
species_stats as (
  select
    taxon_group,
    count(*) filter (where iucn_category is not null) as total_assessed,
    count(*) filter (where assessment_date < current_date - interval '10 years') as outdated,
    count(*) filter (where gbif_species_key is not null) as gbif_species_count,
    coalesce(sum(gbif_total_count) filter (where gbif_species_key is not null), 0) as total_gbif_observations,
    coalesce(avg(gbif_total_count) filter (where gbif_species_key is not null), 0) as mean_gbif_obs,
    percentile_cont(0.5) within group (order by gbif_total_count)
      filter (where gbif_species_key is not null) as median_gbif_obs
  from public.species
  where sis_taxon_id is not null
  group by taxon_group
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

-- Restrict refresh to service_role only
revoke execute on function refresh_taxa_summary() from public, anon, authenticated;
grant execute on function refresh_taxa_summary() to service_role;
