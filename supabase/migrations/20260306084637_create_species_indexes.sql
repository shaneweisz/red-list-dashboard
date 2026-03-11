-- Indexes on species table for search, filtering, and redlist_species_query.

-- pg_trgm extension for fuzzy/substring search (trigram matching)
create schema if not exists extensions;
create extension if not exists pg_trgm schema extensions;

-- Trigram index for species name search
create index idx_species_scientific_name_trgm
  on public.species using gin(scientific_name extensions.gin_trgm_ops);

-- Column indexes for common filter/sort dimensions
create index idx_species_table1a_taxon_group on public.species(table1a_taxon_group);
create index idx_species_iucn_category on public.species(iucn_category);
create index idx_species_assessment_date on public.species(assessment_date);
create index idx_species_countries on public.species using gin(countries);
create index idx_species_gbif_total_count on public.species(gbif_total_count);
create index idx_species_class_name on public.species(class_name);
create index idx_species_order_name on public.species(order_name);

-- Partial index for assessed species (used by most redlist_species_query lateral joins)
create index idx_species_group_assessed
  on species (table1a_taxon_group)
  where sis_taxon_id is not null;

-- Partial index for NE species (used by NE count lateral join)
create index idx_species_group_ne
  on species (table1a_taxon_group)
  where sis_taxon_id is null;

-- Composite: taxon group + category (used by category cross-filter)
create index idx_species_group_category
  on species (table1a_taxon_group, iucn_category)
  where sis_taxon_id is not null;
