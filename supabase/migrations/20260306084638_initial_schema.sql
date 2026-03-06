-- Enable pg_trgm for fuzzy/substring search
create extension if not exists pg_trgm;

-- Core species table (~170K+ rows)
create table public.species (
  id integer generated always as identity primary key,
  scientific_name text not null,
  common_name text,
  family text,
  taxon_group text not null,

  -- IUCN Red List
  sis_taxon_id integer unique,
  assessment_id integer,
  iucn_category text,
  assessment_date date,
  year_published text,
  population_trend text,
  countries text[] default '{}',

  -- GBIF
  gbif_species_key integer unique,
  gbif_occurrence_count integer default 0,
  gbif_occurrences_since_assessment integer,

  -- Status tracking for taxonomic changes
  status text not null default 'active',
  constraint species_status_check check (status in ('active', 'superseded')),

  -- Metadata
  synced_at timestamptz default now()
);

-- Indexes
create index idx_species_status on public.species(status);
create index idx_species_taxon_group on public.species(taxon_group);
create index idx_species_iucn_category on public.species(iucn_category);
create index idx_species_scientific_name_trgm on public.species
  using gin(scientific_name gin_trgm_ops);
create index idx_species_countries on public.species using gin(countries);
create index idx_species_gbif_count on public.species(gbif_occurrence_count);
create index idx_species_assessment_date on public.species(assessment_date);

-- Row Level Security
alter table public.species enable row level security;
create policy "Species are readable by everyone"
  on public.species for select using (true);

-- Materialized view for taxa summary (powers /api/redlist/taxa).
-- Refresh after each sync: REFRESH MATERIALIZED VIEW taxa_summary;
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
    where status = 'active'
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
    coalesce(sum(gbif_occurrence_count), 0) as total_gbif_observations,
    coalesce(avg(gbif_occurrence_count) filter (where gbif_species_key is not null), 0) as mean_gbif_obs,
    percentile_cont(0.5) within group (order by gbif_occurrence_count)
      filter (where gbif_species_key is not null) as median_gbif_obs
  from public.species
  where status = 'active'
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

