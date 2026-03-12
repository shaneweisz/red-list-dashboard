-- Index on synced_at for efficient stale-row deletion during sync.
create index idx_species_synced_at on public.species(synced_at);
