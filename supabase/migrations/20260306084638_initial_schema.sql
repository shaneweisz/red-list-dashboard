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

  -- Catalogue of Life: kept for future use as a universal linking key between
  -- IUCN and GBIF. GBIF is switching to COL Extended Release as its primary
  -- taxonomy (https://docs.gbif.org/2026-work-programme/en/), so COL IDs will
  -- become available natively from the GBIF API — no separate sync needed.
  col_id text unique,

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

