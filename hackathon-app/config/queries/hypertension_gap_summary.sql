-- Category demand vs supply summary (demand via health_indicator_specialty, supply via specialty_category_mapping).
-- @param facilities_json STRING
-- @param specialty_category STRING
WITH category_specialties AS (
  SELECT DISTINCT TRIM(specialties) AS specialty
  FROM dais_2026.hackathon.specialty_category_mapping
  WHERE CAST(category AS STRING) = :specialty_category
),
scenario_facilities AS (
  SELECT
    UPPER(TRIM(f.district_name)) AS district_key,
    UPPER(TRIM(f.state_ut)) AS state_key,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM category_specialties cs
        WHERE LOWER(TRIM(f.capability)) LIKE CONCAT('%', LOWER(cs.specialty), '%')
      ) THEN 1
      ELSE 0
    END AS is_category_match
  FROM (
    SELECT explode(
      from_json(
        :facilities_json,
        'array<struct<district_name:string,state_ut:string,capability:string,capacity:int>>'
      )
    ) AS f
  )
),
scenario_by_district AS (
  SELECT
    district_key,
    state_key,
    COUNT(*) AS added_facilities,
    SUM(is_category_match) AS added_category_facilities
  FROM scenario_facilities
  GROUP BY district_key, state_key
),
district_demand AS (
  SELECT
    TRIM(hi.district_name) AS district_name,
    TRIM(hi.state_ut) AS state_ut,
    UPPER(TRIM(hi.district_name)) AS district_key,
    UPPER(TRIM(hi.state_ut)) AS state_key,
    ROUND(AVG(hi.indicator_value), 2) AS demand_pct
  FROM dais_2026.hackathon.health_indicator hi
  INNER JOIN dais_2026.hackathon.health_indicator_specialty his
    ON hi.indicator_key = his.indicator_key
  WHERE his.specialty_category = :specialty_category
    AND NOT COALESCE(hi.is_suppressed, false)
    AND hi.indicator_key NOT IN (
      'households_surveyed',
      'women_15_49_interviewed',
      'men_15_54_interviewed'
    )
    AND hi.indicator_value IS NOT NULL
  GROUP BY 1, 2, 3, 4
),
district_supply_base AS (
  SELECT
    UPPER(TRIM(f.district_name)) AS district_key,
    UPPER(TRIM(f.state_ut)) AS state_key,
    COUNT(DISTINCT f.facility_id) AS total_facilities,
    COUNT(DISTINCT CASE WHEN m.specialties IS NOT NULL THEN f.facility_id END) AS category_facilities
  FROM dais_2026.hackathon.facility f
  LEFT JOIN dais_2026.hackathon.facility_specialty fs
    ON f.facility_id = fs.facility_id
  LEFT JOIN dais_2026.hackathon.specialty_category_mapping m
    ON fs.specialty = m.specialties
   AND CAST(m.category AS STRING) = :specialty_category
  WHERE f.district_name IS NOT NULL
    AND TRIM(f.district_name) != ''
    AND f.state_ut IS NOT NULL
    AND TRIM(f.state_ut) != ''
  GROUP BY 1, 2
),
district_supply AS (
  SELECT
    COALESCE(b.district_key, s.district_key) AS district_key,
    COALESCE(b.state_key, s.state_key) AS state_key,
    COALESCE(b.total_facilities, 0) + COALESCE(s.added_facilities, 0) AS total_facilities,
    COALESCE(b.category_facilities, 0) + COALESCE(s.added_category_facilities, 0) AS category_facilities
  FROM district_supply_base b
  FULL OUTER JOIN scenario_by_district s
    ON b.district_key = s.district_key AND b.state_key = s.state_key
),
joined AS (
  SELECT
    d.district_name,
    d.state_ut,
    d.demand_pct,
    COALESCE(s.total_facilities, 0) AS total_facilities,
    COALESCE(s.category_facilities, 0) AS category_facilities
  FROM district_demand d
  LEFT JOIN district_supply s
    ON d.district_key = s.district_key
   AND d.state_key = s.state_key
),
scored AS (
  SELECT
    *,
    demand_pct / 100.0 AS demand_norm,
    category_facilities / NULLIF(MAX(category_facilities) OVER (), 0) AS supply_norm
  FROM joined
),
flagged AS (
  SELECT
    district_name,
    state_ut,
    demand_pct,
    category_facilities,
    ROUND(demand_norm - COALESCE(supply_norm, 0), 4) AS gap_score,
    CASE
      WHEN category_facilities = 0
        AND demand_pct > (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY demand_pct) FROM scored)
        THEN 'no_supply'
      WHEN demand_norm - COALESCE(supply_norm, 0) > 0.3 THEN 'high_gap'
      WHEN COALESCE(supply_norm, 0) - demand_norm > 0.3 THEN 'low_demand_high_supply'
      ELSE 'balanced'
    END AS gap_flag
  FROM scored
),
top10 AS (
  SELECT district_name, state_ut, demand_pct, category_facilities, gap_score, gap_flag
  FROM flagged
  ORDER BY gap_score DESC
  LIMIT 10
)
SELECT
  (SELECT COUNT(*) FROM scored) AS districts_analyzed,
  (SELECT COUNT(*) FROM scored WHERE category_facilities = 0) AS districts_with_zero_category_supply,
  (SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY demand_pct), 2) FROM scored) AS median_demand_pct,
  (SELECT COUNT(*) FROM flagged WHERE gap_flag IN ('high_gap', 'no_supply')) AS districts_high_gap_or_no_supply,
  (SELECT TO_JSON(COLLECT_LIST(STRUCT(district_name, state_ut, demand_pct, category_facilities, gap_score, gap_flag))) FROM top10) AS top_10_high_gap_districts
