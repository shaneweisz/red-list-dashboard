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
  table1a_taxon_group                 text not null,

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

-- RLS
alter table public.species enable row level security;
create policy "Species are readable by everyone"
  on public.species for select using (true);
