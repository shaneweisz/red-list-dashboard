-- Grant anon read access to taxa_summary materialized view.
-- The view contains only public aggregate statistics.
grant select on taxa_summary to anon, authenticated;
