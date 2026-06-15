-- @param facilities_json STRING
WITH pincode_district AS (
  SELECT DISTINCT
    TRIM(pincode) AS pincode,
    TRIM(district) AS district_name,
    TRIM(statename) AS state_raw
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  WHERE pincode IS NOT NULL AND district IS NOT NULL
),
facilities_by_district AS (
  SELECT
    TRIM(LOWER(pd.district_name)) AS district_key,
    TRIM(pd.district_name) AS district_name,
    TRIM(LOWER(pd.state_raw)) AS state_key,
    COUNT(*) AS facility_count,
    SUM(
      CASE
        WHEN LOWER(f.specialties) RLIKE 'cardiology|cardiac|interventionalcardiology|cardiacsurgery'
        THEN 1
        ELSE 0
      END
    ) AS cardiac_facility_count,
    SUM(COALESCE(TRY_CAST(REGEXP_REPLACE(f.capacity, '[^0-9.]', '') AS DOUBLE), 0)) AS total_bed_capacity
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities f
  INNER JOIN pincode_district pd ON TRIM(f.address_zipOrPostcode) = pd.pincode
  GROUP BY TRIM(LOWER(pd.district_name)), TRIM(pd.district_name), TRIM(LOWER(pd.state_raw))
),
nfhs AS (
  SELECT
    TRIM(LOWER(district_name)) AS district_key,
    TRIM(district_name) AS district_name,
    TRIM(state_ut) AS state_ut,
    TRIM(LOWER(state_ut)) AS state_key,
    w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct AS hypertension_demand_pct,
    w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct AS diabetes_demand_pct,
    households_surveyed
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators
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
    n.hypertension_demand_pct,
    n.diabetes_demand_pct,
    n.households_surveyed,
    COALESCE(f.facility_count, 0) AS facility_count,
    COALESCE(f.cardiac_facility_count, 0) AS cardiac_facility_count,
    COALESCE(f.total_bed_capacity, 0) AS total_bed_capacity,
    s.added_facility_count,
    s.added_cardiac_facility_count,
    s.added_bed_capacity
  FROM scenario_by_district s
  INNER JOIN nfhs n
    ON s.district_key = n.district_key
   AND s.state_key = n.state_key
  LEFT JOIN facilities_by_district f
    ON s.district_key = f.district_key
   AND s.state_key = f.state_key
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
