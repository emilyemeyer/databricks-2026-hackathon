-- Top 25 districts for in-app table (full dataset: hypertension_gap_by_district.sql).
-- Includes demand vs supply scores for side-by-side visual comparison.
-- confidence_score matches the geographic map logic:
-- 60% NFHS household sample size + 40% total facility count strength.

WITH state_map AS (
  SELECT * FROM VALUES
    ('DELHI', 'NCT OF DELHI'),
    ('NCT OF DELHI', 'NCT OF DELHI'),
    ('JAMMU AND KASHMIR', 'JAMMU & KASHMIR'),
    ('JAMMU & KASHMIR', 'JAMMU & KASHMIR'),
    ('ANDAMAN & NICOBAR ISLANDS', 'ANDAMAN & NICOBAR ISLANDS'),
    ('ANDAMAN AND NICOBAR ISLANDS', 'ANDAMAN & NICOBAR ISLANDS'),
    ('ODISHA', 'ODISHA'),
    ('ORISSA', 'ODISHA'),
    ('PUDUCHERRY', 'PUDUCHERRY'),
    ('PONDICHERRY', 'PUDUCHERRY'),
    ('CHHATTISGARH', 'CHHATTISGARH'),
    ('CHATTISGARH', 'CHHATTISGARH'),
    ('UTTARAKHAND', 'UTTARAKHAND'),
    ('UTTARANCHAL', 'UTTARAKHAND'),
    ('DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'DADRA & NAGAR HAVELI AND DAMAN & DIU'),
    ('DADRA & NAGAR HAVELI AND DAMAN & DIU', 'DADRA & NAGAR HAVELI AND DAMAN & DIU')
  AS t(raw_state, norm_state)
),

pincode_one AS (
  SELECT
    pincode,
    district,
    statename
  FROM (
    SELECT
      pincode,
      district,
      statename,
      ROW_NUMBER() OVER (
        PARTITION BY pincode
        ORDER BY district
      ) AS rn
    FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  )
  WHERE rn = 1
),

facility_district AS (
  SELECT
    f.unique_id,
    f.specialties,
    p.district,
    p.statename
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities f
  INNER JOIN pincode_one p
    ON TRY_CAST(REGEXP_REPLACE(f.address_zipOrPostcode, '[^0-9]', '') AS BIGINT) = p.pincode
  WHERE TRY_CAST(REGEXP_REPLACE(f.address_zipOrPostcode, '[^0-9]', '') AS BIGINT) IS NOT NULL
),

district_supply AS (
  SELECT
    UPPER(TRIM(district)) AS district_key,
    COALESCE(sm.norm_state, UPPER(TRIM(statename))) AS state_key,
    COUNT(*) AS total_facilities,
    SUM(
      CASE
        WHEN LOWER(COALESCE(specialties, '')) LIKE '%cardiology%'
          OR LOWER(COALESCE(specialties, '')) LIKE '%interventionalcardiology%'
          OR LOWER(COALESCE(specialties, '')) LIKE '%cardiacsurgery%'
          OR LOWER(COALESCE(specialties, '')) LIKE '%cardiothoracicsurgery%'
          OR LOWER(COALESCE(specialties, '')) LIKE '%pediatriccardiology%'
          OR LOWER(COALESCE(specialties, '')) LIKE '%vascularsurgery%'
        THEN 1
        ELSE 0
      END
    ) AS cardiac_facilities
  FROM facility_district fd
  LEFT JOIN state_map sm
    ON UPPER(TRIM(fd.statename)) = sm.raw_state
  GROUP BY 1, 2
),

nfhs AS (
  SELECT
    TRIM(district_name) AS district_name,
    TRIM(state_ut) AS state_ut,
    COALESCE(sm.norm_state, UPPER(TRIM(state_ut))) AS state_key,
    w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct AS hypertension_pct,
    households_surveyed
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators n
  LEFT JOIN state_map sm
    ON UPPER(TRIM(n.state_ut)) = sm.raw_state
),

joined AS (
  SELECT
    n.district_name,
    n.state_ut,
    n.hypertension_pct,
    n.households_surveyed,
    COALESCE(s.total_facilities, 0) AS total_facilities,
    COALESCE(s.cardiac_facilities, 0) AS cardiac_facilities
  FROM nfhs n
  LEFT JOIN district_supply s
    ON UPPER(TRIM(n.district_name)) = s.district_key
   AND n.state_key = s.state_key
),

scored AS (
  SELECT
    *,
    hypertension_pct / 100.0 AS demand_norm,
    cardiac_facilities / NULLIF(MAX(cardiac_facilities) OVER (), 0) AS supply_norm,
    households_surveyed / NULLIF(MAX(households_surveyed) OVER (), 0) AS demand_sample_norm
  FROM joined
),

median_h AS (
  SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hypertension_pct) AS med
  FROM scored
),

final_scored AS (
  SELECT
    *,
    ROUND(demand_norm - COALESCE(supply_norm, 0), 4) AS gap_score,

    -- Cardiac desert risk: demand weighted by lack of supply.
    ROUND(demand_norm * (1 - COALESCE(supply_norm, 0)), 4) AS desert_risk_score,

    CASE
      WHEN cardiac_facilities = 0
        AND hypertension_pct > (SELECT med FROM median_h)
        THEN 'no_supply'
      WHEN demand_norm - COALESCE(supply_norm, 0) > 0.3
        THEN 'high_gap'
      WHEN COALESCE(supply_norm, 0) - demand_norm > 0.3
        THEN 'low_demand_high_supply'
      ELSE 'balanced'
    END AS gap_flag,

    -- For demand-vs-supply stacked / side-by-side bar visual
    ROUND(demand_norm, 3) AS demand_score,
    ROUND(COALESCE(supply_norm, 0), 3) AS supply_score,

    -- Matches map confidence logic:
    -- 60% relative NFHS sample size + 40% facility-count strength
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
  hypertension_pct,
  households_surveyed,
  total_facilities,
  cardiac_facilities,
  gap_score,
  desert_risk_score,
  gap_flag,
  demand_score,
  supply_score,
  confidence_score
FROM final_scored
ORDER BY desert_risk_score DESC
LIMIT 25;