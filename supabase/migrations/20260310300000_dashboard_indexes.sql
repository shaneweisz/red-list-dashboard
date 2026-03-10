-- Composite and partial indexes to speed up dashboard_query lateral joins.

-- Partial index for assessed species (used by most lateral joins)
create index if not exists idx_species_group_assessed
  on species (table1a_taxon_group)
  where sis_taxon_id is not null;

-- Partial index for NE species (used by NE count lateral join)
create index if not exists idx_species_group_ne
  on species (table1a_taxon_group)
  where sis_taxon_id is null;

-- Composite: taxon group + category (used by category cross-filter)
create index if not exists idx_species_group_category
  on species (table1a_taxon_group, iucn_category)
  where sis_taxon_id is not null;

-- Revert dashboard_query to v1 lateral joins (CTE approach was slower)
create or replace function dashboard_query(
  p_taxon_groups     text[],
  p_categories       text[]  default null,
  p_year_ranges      text[]  default null,
  p_countries        text[]  default null,
  p_search           text    default null,
  p_obs_ranges       text[]  default null,
  p_sort_field       text    default 'priority',
  p_sort_direction   text    default 'desc',
  p_page             int     default 1,
  p_page_size        int     default 10
)
returns json
language plpgsql
stable
set search_path = public
set statement_timeout = '5s'
as $$
declare
  result json;
  v_offset int := (p_page - 1) * p_page_size;
  v_current_year int := extract(year from current_date)::int;
  v_has_categories boolean := coalesce(array_length(p_categories, 1), 0) > 0;
  v_has_year_ranges boolean := coalesce(array_length(p_year_ranges, 1), 0) > 0;
  v_has_countries boolean := coalesce(array_length(p_countries, 1), 0) > 0;
  v_has_obs_ranges boolean := coalesce(array_length(p_obs_ranges, 1), 0) > 0;
  v_has_ne boolean := 'NE' = any(coalesce(p_categories, '{}'::text[]));
  v_search text := nullif(trim(p_search), '');
begin
  select json_build_object(
    'species', coalesce(sp.arr, '[]'::json),
    'total', coalesce(cnt.total, 0),
    'cross_filters', json_build_object(
      'categories', coalesce(cf_cat.obj, '{}'::json),
      'years',      coalesce(cf_yr.obj, '{}'::json),
      'countries',  coalesce(cf_co.obj, '{}'::json),
      'obs_ranges', coalesce(cf_obs.obj, '{}'::json)
    ),
    'ne_count', coalesce(ne.cnt, 0)
  )
  into result
  from

  lateral (
    select true
  ) _driver

  -- Species list (fully filtered, sorted, paginated)
  left join lateral (
    select json_agg(row_to_json(t)) as arr
    from (
      select
        s.id,
        s.sis_taxon_id,
        s.assessment_id,
        s.scientific_name,
        s.common_name,
        s.family,
        coalesce(s.iucn_category, 'NE') as category,
        s.assessment_date,
        s.year_published,
        s.population_trend,
        s.countries,
        s.class_name,
        s.order_name,
        s.table1a_taxon_group as taxon_group,
        s.gbif_species_key,
        s.gbif_total_count as gbif_occurrence_count,
        s.gbif_count_since_assessment as gbif_observations_after_assessment_year,
        case
          when s.iucn_category in ('EX', 'EW') then 0
          else
            coalesce(case s.iucn_category
              when 'DD' then 50 when 'CR' then 40 when 'EN' then 30
              when 'VU' then 20 when 'NT' then 10
              when 'LR/nt' then 10 when 'LR/cd' then 15
              else 0
            end, 0)
            + case
                when s.assessment_date is null then 0
                else greatest(0, least(25,
                  round(1.25 * (v_current_year - extract(year from s.assessment_date)::int - 5))
                ))
              end
            + case
                when s.gbif_count_since_assessment is null or s.gbif_total_count is null then 0
                else least(25, round(
                  (s.gbif_count_since_assessment::numeric / (s.gbif_total_count + 50)) * 50
                ))
              end
        end as priority_score
      from species s
      where s.table1a_taxon_group = any(p_taxon_groups)
        and (v_search is null
             or s.scientific_name ilike '%' || v_search || '%'
             or s.common_name ilike '%' || v_search || '%')
        and (
          (not v_has_categories and s.sis_taxon_id is not null)
          or (v_has_categories and (
            s.iucn_category = any(p_categories)
            or (s.sis_taxon_id is null and v_has_ne)
          ))
        )
        and (
          s.sis_taxon_id is null
          or not v_has_year_ranges
          or (
            case
              when s.assessment_date is null then null
              when v_current_year - extract(year from s.assessment_date)::int <= 1 then '0-1 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 5 then '2-5 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 10 then '6-10 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 20 then '11-20 years'
              else '20+ years'
            end
          ) = any(p_year_ranges)
        )
        and (not v_has_countries or s.countries && p_countries)
        and (not v_has_obs_ranges or (
          case
            when coalesce(s.gbif_total_count, 0) = 0 then '0'
            when s.gbif_total_count <= 10 then '1-10'
            when s.gbif_total_count <= 100 then '11-100'
            when s.gbif_total_count <= 1000 then '101-1K'
            when s.gbif_total_count <= 10000 then '1K-10K'
            else '10K+'
          end
        ) = any(p_obs_ranges))
      order by
        case when p_sort_field = 'priority' and p_sort_direction = 'desc' then
          case
            when s.iucn_category in ('EX', 'EW') then 0
            else
              coalesce(case s.iucn_category
                when 'DD' then 50 when 'CR' then 40 when 'EN' then 30
                when 'VU' then 20 when 'NT' then 10
                when 'LR/nt' then 10 when 'LR/cd' then 15
                else 0
              end, 0)
              + case
                  when s.assessment_date is null then 0
                  else greatest(0, least(25,
                    round(1.25 * (v_current_year - extract(year from s.assessment_date)::int - 5))
                  ))
                end
              + case
                  when s.gbif_count_since_assessment is null or s.gbif_total_count is null then 0
                  else least(25, round(
                    (s.gbif_count_since_assessment::numeric / (s.gbif_total_count + 50)) * 50
                  ))
                end
          end
        end desc nulls last,
        case when p_sort_field = 'priority' and p_sort_direction = 'asc' then
          case
            when s.iucn_category in ('EX', 'EW') then 0
            else
              coalesce(case s.iucn_category
                when 'DD' then 50 when 'CR' then 40 when 'EN' then 30
                when 'VU' then 20 when 'NT' then 10
                when 'LR/nt' then 10 when 'LR/cd' then 15
                else 0
              end, 0)
              + case
                  when s.assessment_date is null then 0
                  else greatest(0, least(25,
                    round(1.25 * (v_current_year - extract(year from s.assessment_date)::int - 5))
                  ))
                end
              + case
                  when s.gbif_count_since_assessment is null or s.gbif_total_count is null then 0
                  else least(25, round(
                    (s.gbif_count_since_assessment::numeric / (s.gbif_total_count + 50)) * 50
                  ))
                end
          end
        end asc nulls last,
        case when p_sort_field = 'category' and p_sort_direction = 'desc' then
          case s.iucn_category
            when 'EX' then 0 when 'EW' then 1 when 'CR' then 2 when 'EN' then 3
            when 'VU' then 4 when 'NT' then 5 when 'LC' then 6 when 'DD' then 7
            else 8
          end
        end asc nulls last,
        case when p_sort_field = 'category' and p_sort_direction = 'asc' then
          case s.iucn_category
            when 'EX' then 0 when 'EW' then 1 when 'CR' then 2 when 'EN' then 3
            when 'VU' then 4 when 'NT' then 5 when 'LC' then 6 when 'DD' then 7
            else 8
          end
        end desc nulls last,
        case when p_sort_field = 'year' and p_sort_direction = 'desc' then s.assessment_date end desc nulls last,
        case when p_sort_field = 'year' and p_sort_direction = 'asc' then s.assessment_date end asc nulls last,
        case when p_sort_field = 'newGbif' and p_sort_direction = 'desc' then coalesce(s.gbif_count_since_assessment, -1) end desc,
        case when p_sort_field = 'newGbif' and p_sort_direction = 'asc' then coalesce(s.gbif_count_since_assessment, -1) end asc,
        s.id
      limit p_page_size
      offset v_offset
    ) t
  ) sp on true

  -- Total count
  left join lateral (
    select count(*)::int as total
    from species s
    where s.table1a_taxon_group = any(p_taxon_groups)
      and (v_search is null
           or s.scientific_name ilike '%' || v_search || '%'
           or s.common_name ilike '%' || v_search || '%')
      and (
        (not v_has_categories and s.sis_taxon_id is not null)
        or (v_has_categories and (
          s.iucn_category = any(p_categories)
          or (s.sis_taxon_id is null and v_has_ne)
        ))
      )
      and (
        s.sis_taxon_id is null
        or not v_has_year_ranges
        or (
          case
            when s.assessment_date is null then null
            when v_current_year - extract(year from s.assessment_date)::int <= 1 then '0-1 years'
            when v_current_year - extract(year from s.assessment_date)::int <= 5 then '2-5 years'
            when v_current_year - extract(year from s.assessment_date)::int <= 10 then '6-10 years'
            when v_current_year - extract(year from s.assessment_date)::int <= 20 then '11-20 years'
            else '20+ years'
          end
        ) = any(p_year_ranges)
      )
      and (not v_has_countries or s.countries && p_countries)
      and (not v_has_obs_ranges or (
        case
          when coalesce(s.gbif_total_count, 0) = 0 then '0'
          when s.gbif_total_count <= 10 then '1-10'
          when s.gbif_total_count <= 100 then '11-100'
          when s.gbif_total_count <= 1000 then '101-1K'
          when s.gbif_total_count <= 10000 then '1K-10K'
          else '10K+'
        end
      ) = any(p_obs_ranges))
  ) cnt on true

  -- Cross-filter: categories
  left join lateral (
    select json_object_agg(cat, cnt) as obj
    from (
      select s.iucn_category as cat, count(*)::int as cnt
      from species s
      where s.table1a_taxon_group = any(p_taxon_groups)
        and s.sis_taxon_id is not null
        and (v_search is null
             or s.scientific_name ilike '%' || v_search || '%'
             or s.common_name ilike '%' || v_search || '%')
        and (
          not v_has_year_ranges
          or (
            case
              when s.assessment_date is null then null
              when v_current_year - extract(year from s.assessment_date)::int <= 1 then '0-1 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 5 then '2-5 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 10 then '6-10 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 20 then '11-20 years'
              else '20+ years'
            end
          ) = any(p_year_ranges)
        )
        and (not v_has_countries or s.countries && p_countries)
        and (not v_has_obs_ranges or (
          case
            when coalesce(s.gbif_total_count, 0) = 0 then '0'
            when s.gbif_total_count <= 10 then '1-10'
            when s.gbif_total_count <= 100 then '11-100'
            when s.gbif_total_count <= 1000 then '101-1K'
            when s.gbif_total_count <= 10000 then '1K-10K'
            else '10K+'
          end
        ) = any(p_obs_ranges))
      group by s.iucn_category
    ) sub
  ) cf_cat on true

  -- Cross-filter: year ranges
  left join lateral (
    select json_object_agg(bucket, cnt) as obj
    from (
      select
        case
          when v_current_year - extract(year from s.assessment_date)::int <= 1 then '0-1 years'
          when v_current_year - extract(year from s.assessment_date)::int <= 5 then '2-5 years'
          when v_current_year - extract(year from s.assessment_date)::int <= 10 then '6-10 years'
          when v_current_year - extract(year from s.assessment_date)::int <= 20 then '11-20 years'
          else '20+ years'
        end as bucket,
        count(*)::int as cnt
      from species s
      where s.table1a_taxon_group = any(p_taxon_groups)
        and s.sis_taxon_id is not null
        and s.assessment_date is not null
        and (v_search is null
             or s.scientific_name ilike '%' || v_search || '%'
             or s.common_name ilike '%' || v_search || '%')
        and (
          not v_has_categories
          or s.iucn_category = any(p_categories)
        )
        and (not v_has_countries or s.countries && p_countries)
        and (not v_has_obs_ranges or (
          case
            when coalesce(s.gbif_total_count, 0) = 0 then '0'
            when s.gbif_total_count <= 10 then '1-10'
            when s.gbif_total_count <= 100 then '11-100'
            when s.gbif_total_count <= 1000 then '101-1K'
            when s.gbif_total_count <= 10000 then '1K-10K'
            else '10K+'
          end
        ) = any(p_obs_ranges))
      group by 1
    ) sub
  ) cf_yr on true

  -- Cross-filter: countries
  left join lateral (
    select json_object_agg(country, cnt) as obj
    from (
      select unnest(s.countries) as country, count(*)::int as cnt
      from species s
      where s.table1a_taxon_group = any(p_taxon_groups)
        and (v_search is null
             or s.scientific_name ilike '%' || v_search || '%'
             or s.common_name ilike '%' || v_search || '%')
        and (
          (not v_has_categories and s.sis_taxon_id is not null)
          or (v_has_categories and (
            s.iucn_category = any(p_categories)
            or (s.sis_taxon_id is null and v_has_ne)
          ))
        )
        and (
          s.sis_taxon_id is null
          or not v_has_year_ranges
          or (
            case
              when s.assessment_date is null then null
              when v_current_year - extract(year from s.assessment_date)::int <= 1 then '0-1 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 5 then '2-5 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 10 then '6-10 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 20 then '11-20 years'
              else '20+ years'
            end
          ) = any(p_year_ranges)
        )
        and (not v_has_obs_ranges or (
          case
            when coalesce(s.gbif_total_count, 0) = 0 then '0'
            when s.gbif_total_count <= 10 then '1-10'
            when s.gbif_total_count <= 100 then '11-100'
            when s.gbif_total_count <= 1000 then '101-1K'
            when s.gbif_total_count <= 10000 then '1K-10K'
            else '10K+'
          end
        ) = any(p_obs_ranges))
      group by 1
    ) sub
  ) cf_co on true

  -- Cross-filter: observation ranges
  left join lateral (
    select json_object_agg(bucket, cnt) as obj
    from (
      select
        case
          when coalesce(s.gbif_total_count, 0) = 0 then '0'
          when s.gbif_total_count <= 10 then '1-10'
          when s.gbif_total_count <= 100 then '11-100'
          when s.gbif_total_count <= 1000 then '101-1K'
          when s.gbif_total_count <= 10000 then '1K-10K'
          else '10K+'
        end as bucket,
        count(*)::int as cnt
      from species s
      where s.table1a_taxon_group = any(p_taxon_groups)
        and (v_search is null
             or s.scientific_name ilike '%' || v_search || '%'
             or s.common_name ilike '%' || v_search || '%')
        and (
          (not v_has_categories and s.sis_taxon_id is not null)
          or (v_has_categories and (
            s.iucn_category = any(p_categories)
            or (s.sis_taxon_id is null and v_has_ne)
          ))
        )
        and (
          s.sis_taxon_id is null
          or not v_has_year_ranges
          or (
            case
              when s.assessment_date is null then null
              when v_current_year - extract(year from s.assessment_date)::int <= 1 then '0-1 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 5 then '2-5 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 10 then '6-10 years'
              when v_current_year - extract(year from s.assessment_date)::int <= 20 then '11-20 years'
              else '20+ years'
            end
          ) = any(p_year_ranges)
        )
        and (not v_has_countries or s.countries && p_countries)
      group by 1
    ) sub
  ) cf_obs on true

  -- NE count
  left join lateral (
    select count(*)::int as cnt
    from species s
    where s.table1a_taxon_group = any(p_taxon_groups)
      and s.sis_taxon_id is null
      and (v_search is null
           or s.scientific_name ilike '%' || v_search || '%'
           or s.common_name ilike '%' || v_search || '%')
      and (not v_has_countries or s.countries && p_countries)
      and (not v_has_obs_ranges or (
        case
          when coalesce(s.gbif_total_count, 0) = 0 then '0'
          when s.gbif_total_count <= 10 then '1-10'
          when s.gbif_total_count <= 100 then '11-100'
          when s.gbif_total_count <= 1000 then '101-1K'
          when s.gbif_total_count <= 10000 then '1K-10K'
          else '10K+'
        end
      ) = any(p_obs_ranges))
  ) ne on true;

  return result;
end;
$$;

grant execute on function dashboard_query to anon, authenticated;
