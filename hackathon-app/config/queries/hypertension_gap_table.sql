-- Top 25 districts for in-app table (category demand vs supply).
-- @param facilities_json STRING
-- @param specialty_category STRING
-- @param _run STRING
WITH category_specialties AS (
  SELECT DISTINCT TRIM(specialties) AS specialty
  FROM dais_2026.hackathon.specialty_category_mapping
  WHERE :specialty_category = 'ALL'
     OR CAST(category AS STRING) = :specialty_category
),
scenario_facilities AS (
  SELECT
    UPPER(TRIM(f.district_name)) AS district_key,
    UPPER(TRIM(f.state_ut)) AS state_key,
    GREATEST(COALESCE(f.capacity, 0), 0) AS capacity,
    CASE
      WHEN TRIM(COALESCE(f.capability, '')) = '' THEN 0
      WHEN :specialty_category = 'ALL' THEN 1
      WHEN EXISTS (
        SELECT 1
        FROM category_specialties cs
        WHERE LOWER(TRIM(f.capability)) LIKE CONCAT('%', LOWER(cs.specialty), '%')
      ) THEN 1
      WHEN LOWER(TRIM(f.capability)) LIKE CONCAT('%', LOWER(:specialty_category), '%') THEN 1
      ELSE 1
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
    SUM(is_category_match) AS added_category_facilities,
    SUM(CASE WHEN is_category_match > 0 THEN GREATEST(capacity, 1) ELSE 0 END) AS added_category_beds
  FROM scenario_facilities
  GROUP BY district_key, state_key
),
district_meta AS (
  SELECT
    TRIM(district_name) AS district_name,
    TRIM(state_ut) AS state_ut,
    UPPER(TRIM(district_name)) AS district_key,
    UPPER(TRIM(state_ut)) AS state_key,
    MAX(CASE WHEN indicator_key = 'households_surveyed' THEN indicator_value END) AS households_surveyed
  FROM dais_2026.hackathon.health_indicator
  GROUP BY 1, 2, 3, 4
),
district_demand AS (
  SELECT
    TRIM(hi.district_name) AS district_name,
    TRIM(hi.state_ut) AS state_ut,
    UPPER(TRIM(hi.district_name)) AS district_key,
    UPPER(TRIM(hi.state_ut)) AS state_key,
    ROUND(AVG(hi.indicator_value), 2) AS demand_pct
  FROM dais_2026.hackathon.health_indicator hi
  WHERE EXISTS (
      SELECT 1
      FROM dais_2026.hackathon.health_indicator_specialty his
      WHERE his.indicator_key = hi.indicator_key
        AND (
          :specialty_category = 'ALL'
          OR his.specialty_category = :specialty_category
        )
    )
    AND NOT COALESCE(hi.is_suppressed, false)
    AND hi.indicator_key NOT IN (
      'households_surveyed',
      'women_15_49_interviewed',
      'men_15_54_interviewed'
    )
    AND hi.indicator_value IS NOT NULL
  GROUP BY 1, 2, 3, 4
),
facility_category AS (
  SELECT
    UPPER(TRIM(f.district_name)) AS district_key,
    UPPER(TRIM(f.state_ut)) AS state_key,
    f.facility_id,
    MAX(COALESCE(NULLIF(f.bed_count, 0), 25)) AS bed_units
  FROM dais_2026.hackathon.facility f
  INNER JOIN dais_2026.hackathon.facility_specialty fs
    ON f.facility_id = fs.facility_id
  INNER JOIN dais_2026.hackathon.specialty_category_mapping m
    ON fs.specialty = m.specialties
   AND (
     :specialty_category = 'ALL'
     OR CAST(m.category AS STRING) = :specialty_category
   )
  WHERE f.district_name IS NOT NULL
    AND TRIM(f.district_name) != ''
    AND f.state_ut IS NOT NULL
    AND TRIM(f.state_ut) != ''
  GROUP BY 1, 2, 3
),
all_facilities_by_district AS (
  SELECT
    UPPER(TRIM(f.district_name)) AS district_key,
    UPPER(TRIM(f.state_ut)) AS state_key,
    COUNT(DISTINCT f.facility_id) AS total_facilities
  FROM dais_2026.hackathon.facility f
  WHERE f.district_name IS NOT NULL
    AND TRIM(f.district_name) != ''
    AND f.state_ut IS NOT NULL
    AND TRIM(f.state_ut) != ''
  GROUP BY 1, 2
),
category_supply_by_district AS (
  SELECT
    district_key,
    state_key,
    COUNT(DISTINCT facility_id) AS category_facilities,
    SUM(bed_units) AS category_bed_capacity
  FROM facility_category
  GROUP BY 1, 2
),
district_supply_base AS (
  SELECT
    COALESCE(a.district_key, c.district_key) AS district_key,
    COALESCE(a.state_key, c.state_key) AS state_key,
    COALESCE(a.total_facilities, 0) AS total_facilities,
    COALESCE(c.category_facilities, 0) AS category_facilities,
    COALESCE(c.category_bed_capacity, 0) AS category_bed_capacity
  FROM all_facilities_by_district a
  FULL OUTER JOIN category_supply_by_district c
    ON a.district_key = c.district_key AND a.state_key = c.state_key
),
district_supply AS (
  SELECT
    COALESCE(b.district_key, s.district_key) AS district_key,
    COALESCE(b.state_key, s.state_key) AS state_key,
    COALESCE(b.total_facilities, 0) + COALESCE(s.added_facilities, 0) AS total_facilities,
    COALESCE(b.category_facilities, 0) + COALESCE(s.added_category_facilities, 0) AS category_facilities,
    COALESCE(b.category_bed_capacity, 0) + COALESCE(s.added_category_beds, 0) AS category_bed_capacity
  FROM district_supply_base b
  FULL OUTER JOIN scenario_by_district s
    ON b.district_key = s.district_key AND b.state_key = s.state_key
),
joined AS (
  SELECT
    d.district_name,
    d.state_ut,
    d.demand_pct,
    COALESCE(m.households_surveyed, 0) AS households_surveyed,
    COALESCE(s.total_facilities, 0) AS total_facilities,
    COALESCE(s.category_facilities, 0) AS category_facilities,
    COALESCE(s.category_bed_capacity, 0) AS category_bed_capacity
  FROM district_demand d
  LEFT JOIN district_meta m
    ON d.district_key = m.district_key
   AND d.state_key = m.state_key
  LEFT JOIN district_supply s
    ON d.district_key = s.district_key
   AND d.state_key = s.state_key
),
scored AS (
  SELECT
    *,
    (demand_pct / 100.0) * GREATEST(households_surveyed, 1.0) AS demand_burden,
    ((demand_pct / 100.0) * GREATEST(households_surveyed, 1.0))
      / NULLIF(
          MAX((demand_pct / 100.0) * GREATEST(households_surveyed, 1.0)) OVER (),
          0
        ) AS demand_norm,
    GREATEST(
      ((demand_pct / 100.0) * GREATEST(households_surveyed, 1.0)) * 5.0,
      1.0
    ) AS expected_beds,
    LEAST(
      1.0,
      COALESCE(category_bed_capacity, 0) / NULLIF(
        GREATEST(
          ((demand_pct / 100.0) * GREATEST(households_surveyed, 1.0)) * 5.0,
          1.0
        ),
        0
      )
    ) AS supply_norm,
    households_surveyed / NULLIF(MAX(households_surveyed) OVER (), 0) AS demand_sample_norm
  FROM joined
),
median_d AS (
  SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY demand_burden) AS med
  FROM scored
),
final_scored AS (
  SELECT
    *,
    ROUND(demand_norm - COALESCE(supply_norm, 0), 4) AS gap_score,
    ROUND(demand_norm * (1 - COALESCE(supply_norm, 0)), 4) AS desert_risk_score,
    CASE
      WHEN category_bed_capacity = 0
        AND demand_burden > (SELECT med FROM median_d)
        THEN 'no_supply'
      WHEN demand_norm - COALESCE(supply_norm, 0) > 0.3 THEN 'high_gap'
      WHEN COALESCE(supply_norm, 0) - demand_norm > 0.3 THEN 'low_demand_high_supply'
      ELSE 'balanced'
    END AS gap_flag,
    ROUND(demand_norm, 3) AS demand_score,
    ROUND(COALESCE(supply_norm, 0), 3) AS supply_score,
    ROUND(
      0.6 * demand_sample_norm
      + 0.4 * CASE
          WHEN total_facilities >= 10 THEN 1.0
          WHEN total_facilities >= 3 THEN 0.75
          WHEN total_facilities > 0 THEN 0.5
          ELSE 0.15
        END,
      3
    ) AS confidence_score
  FROM scored
)
SELECT
  district_name,
  state_ut,
  demand_pct,
  households_surveyed,
  total_facilities,
  category_facilities,
  category_bed_capacity,
  expected_beds,
  gap_score,
  desert_risk_score,
  gap_flag,
  demand_score,
  supply_score,
  confidence_score
FROM final_scored
WHERE COALESCE(:_run, '') = COALESCE(:_run, '')
ORDER BY desert_risk_score DESC
LIMIT 25
