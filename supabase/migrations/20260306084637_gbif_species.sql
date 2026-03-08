-- GBIF occurrence data (~579K species with observations)
create table public.gbif_species (
  gbif_species_key       integer primary key,
  scientific_name        text not null,
  common_name            text,
  taxon_group            text not null,
  total_count            integer,
  count_since_assessment integer,
  synced_at              timestamptz default now()
);

-- Indexes
create index idx_gbif_scientific_name_trgm on public.gbif_species
  using gin(scientific_name extensions.gin_trgm_ops);
create index idx_gbif_taxon_group on public.gbif_species(taxon_group);
create index idx_gbif_total_count on public.gbif_species(total_count);

-- RLS
alter table public.gbif_species enable row level security;
create policy "GBIF species are readable by everyone"
  on public.gbif_species for select using (true);
