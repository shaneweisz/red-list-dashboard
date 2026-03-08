-- Linking/identity table (joins IUCN and GBIF data)
create table public.species (
  id               bigint generated always as identity primary key,
  sis_taxon_id     integer unique references public.redlist_species(sis_taxon_id) on delete set null,
  gbif_species_key integer unique references public.gbif_species(gbif_species_key) on delete set null
);

-- RLS
alter table public.species enable row level security;
create policy "Species links are readable by everyone"
  on public.species for select using (true);
