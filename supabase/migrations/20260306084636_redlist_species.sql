-- IUCN Red List source data (~170K assessed species)
create table public.redlist_species (
  sis_taxon_id     integer primary key,
  scientific_name  text not null,
  common_name      text,
  class_name       text,
  order_name       text,
  family           text,
  taxon_group      text not null,
  assessment_id    integer,
  iucn_category    text,
  assessment_date  date,
  year_published   text,
  population_trend text,
  countries        text[] default '{}',
  synced_at        timestamptz default now()
);

-- Indexes
create index idx_redlist_scientific_name_trgm on public.redlist_species
  using gin(scientific_name extensions.gin_trgm_ops);
create index idx_redlist_countries on public.redlist_species using gin(countries);
create index idx_redlist_taxon_group on public.redlist_species(taxon_group);
create index idx_redlist_iucn_category on public.redlist_species(iucn_category);
create index idx_redlist_class_name on public.redlist_species(class_name);
create index idx_redlist_order_name on public.redlist_species(order_name);
create index idx_redlist_assessment_date on public.redlist_species(assessment_date);

-- RLS
alter table public.redlist_species enable row level security;
create policy "Red List species are readable by everyone"
  on public.redlist_species for select using (true);
