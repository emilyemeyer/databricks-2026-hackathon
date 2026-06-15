-- @param facilities_json STRING
WITH demand AS (
  SELECT
    district_name,
    state_ut,
    MAX(CASE WHEN indicator_key = 'households_surveyed' THEN indicator_value END) AS households_surveyed,
    MAX(CASE WHEN indicator_key = 'w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct' THEN indicator_value END) AS hypertension_demand_pct,
    MAX(CASE WHEN indicator_key = 'w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct' THEN indicator_value END) AS diabetes_demand_pct
  FROM dais_2026.hackathon.health_indicator
  GROUP BY district_name, state_ut
),
cardiac_by_district AS (
  SELECT
    f.district_name,
    f.state_ut,
    COUNT(DISTINCT f.facility_id) AS cardiac_facility_count
  FROM dais_2026.hackathon.facility f
  INNER JOIN dais_2026.hackathon.facility_specialty fs ON f.facility_id = fs.facility_id
  INNER JOIN dais_2026.hackathon.specialty_category_mapping m ON fs.specialty = m.specialties
  WHERE CAST(m.category AS STRING) LIKE '%Cardiovascular Care%'
  GROUP BY f.district_name, f.state_ut
),
facilities_by_district AS (
  SELECT
    f.district_name,
    f.state_ut,
    COUNT(*) AS facility_count,
    SUM(COALESCE(f.bed_count, 0)) AS total_bed_capacity
  FROM dais_2026.hackathon.facility f
  WHERE f.district_name IS NOT NULL AND f.state_ut IS NOT NULL
  GROUP BY f.district_name, f.state_ut
),
scenario_facilities AS (
  SELECT
    TRIM(LOWER(f.district_name)) AS district_key,
    TRIM(f.district_name) AS district_name,
    TRIM(LOWER(f.state_ut)) AS state_key,
    TRIM(f.state_ut) AS state_ut,
    f.capability,
    GREATEST(CAST(f.capacity AS INT), 0) AS capacity,
    CASE
      WHEN LOWER(f.capability) RLIKE 'cardio|cardiac|heart|cardiology'
      THEN 1
      ELSE 0
    END AS is_cardiac
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
    district_name,
    state_key,
    state_ut,
    COUNT(*) AS added_facility_count,
    SUM(is_cardiac) AS added_cardiac_facility_count,
    SUM(capacity) AS added_bed_capacity
  FROM scenario_facilities
  GROUP BY district_key, district_name, state_key, state_ut
),
baseline AS (
  SELECT
    s.district_name,
    s.state_ut,
    d.hypertension_demand_pct,
    d.diabetes_demand_pct,
    d.households_surveyed,
    COALESCE(f.facility_count, 0) AS facility_count,
    COALESCE(c.cardiac_facility_count, 0) AS cardiac_facility_count,
    COALESCE(f.total_bed_capacity, 0) AS total_bed_capacity,
    s.added_facility_count,
    s.added_cardiac_facility_count,
    s.added_bed_capacity
  FROM scenario_by_district s
  INNER JOIN demand d
    ON TRIM(LOWER(s.district_name)) = TRIM(LOWER(d.district_name))
   AND TRIM(LOWER(s.state_ut)) = TRIM(LOWER(d.state_ut))
  LEFT JOIN facilities_by_district f
    ON TRIM(LOWER(s.district_name)) = TRIM(LOWER(f.district_name))
   AND TRIM(LOWER(s.state_ut)) = TRIM(LOWER(f.state_ut))
  LEFT JOIN cardiac_by_district c
    ON TRIM(LOWER(s.district_name)) = TRIM(LOWER(c.district_name))
   AND TRIM(LOWER(s.state_ut)) = TRIM(LOWER(c.state_ut))
),
scenario AS (
  SELECT
    district_name,
    state_ut,
    hypertension_demand_pct,
    diabetes_demand_pct,
    households_surveyed,
    facility_count + added_facility_count AS facility_count,
    cardiac_facility_count + added_cardiac_facility_count AS cardiac_facility_count,
    total_bed_capacity + added_bed_capacity AS total_bed_capacity,
    added_facility_count,
    added_cardiac_facility_count,
    added_bed_capacity
  FROM baseline
)
SELECT
  b.district_name,
  b.state_ut,
  ROUND(b.hypertension_demand_pct, 2) AS baseline_hypertension_demand_pct,
  ROUND(s.hypertension_demand_pct, 2) AS scenario_hypertension_demand_pct,
  ROUND(b.diabetes_demand_pct, 2) AS baseline_diabetes_demand_pct,
  ROUND(s.diabetes_demand_pct, 2) AS scenario_diabetes_demand_pct,
  b.facility_count AS baseline_facility_count,
  s.facility_count AS scenario_facility_count,
  s.added_facility_count AS delta_facility_count,
  b.cardiac_facility_count AS baseline_cardiac_facility_count,
  s.cardiac_facility_count AS scenario_cardiac_facility_count,
  s.added_cardiac_facility_count AS delta_cardiac_facility_count,
  ROUND(b.total_bed_capacity, 0) AS baseline_bed_capacity,
  ROUND(s.total_bed_capacity, 0) AS scenario_bed_capacity,
  ROUND(s.added_bed_capacity, 0) AS delta_bed_capacity,
  ROUND(b.hypertension_demand_pct - (b.cardiac_facility_count * 8.0), 2) AS baseline_supply_demand_gap,
  ROUND(s.hypertension_demand_pct - (s.cardiac_facility_count * 8.0), 2) AS scenario_supply_demand_gap,
  ROUND(
    (s.hypertension_demand_pct - (s.cardiac_facility_count * 8.0))
    - (b.hypertension_demand_pct - (b.cardiac_facility_count * 8.0)),
    2
  ) AS delta_supply_demand_gap,
  ROUND(b.households_surveyed, 0) AS nfhs_households_surveyed
FROM baseline b
INNER JOIN scenario s
  ON b.district_name = s.district_name
 AND b.state_ut = s.state_ut
ORDER BY b.state_ut, b.district_name
