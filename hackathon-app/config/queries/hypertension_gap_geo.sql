-- District centroids + category supply/demand balance for geographic map.
-- @param facilities_json STRING
-- @param specialty_category STRING
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
category_specialties AS (
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
pincode_one AS (
  SELECT pincode, district, statename, latitude, longitude
  FROM (
    SELECT pincode, district, statename, latitude, longitude,
      ROW_NUMBER() OVER (PARTITION BY pincode ORDER BY district) AS rn
    FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  )
  WHERE rn = 1
),
district_geo AS (
  SELECT
    UPPER(TRIM(district)) AS district_key,
    COALESCE(sm.norm_state, UPPER(TRIM(statename))) AS state_key,
    COUNT(DISTINCT pincode) AS pincode_count,
    AVG(TRY_CAST(latitude AS DOUBLE)) AS latitude,
    AVG(TRY_CAST(longitude AS DOUBLE)) AS longitude
  FROM pincode_one p
  LEFT JOIN state_map sm ON UPPER(TRIM(p.statename)) = sm.raw_state
  WHERE TRY_CAST(latitude AS DOUBLE) BETWEEN 6 AND 38
    AND TRY_CAST(longitude AS DOUBLE) BETWEEN 68 AND 98
  GROUP BY 1, 2
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
    d.state_key,
    d.demand_pct,
    COALESCE(m.households_surveyed, 0) AS households_surveyed,
    COALESCE(s.total_facilities, 0) AS total_facilities,
    COALESCE(s.category_facilities, 0) AS category_facilities
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
    demand_pct / 100.0 AS demand_norm,
    category_facilities / NULLIF(MAX(category_facilities) OVER (), 0) AS supply_norm,
    households_surveyed / NULLIF(MAX(households_surveyed) OVER (), 0) AS demand_sample_norm
  FROM joined
),
balanced AS (
  SELECT
    s.district_name,
    s.state_ut,
    s.state_key,
    s.demand_pct,
    s.households_surveyed,
    s.category_facilities,
    s.total_facilities,
    s.demand_norm,
    s.supply_norm,
    ROUND(s.supply_norm - s.demand_norm, 4) AS balance_ratio,
    ROUND(
      0.6 * s.demand_sample_norm
      + 0.4 * CASE
          WHEN s.total_facilities >= 10 THEN 1.0
          WHEN s.total_facilities >= 3 THEN 0.75
          WHEN s.total_facilities > 0 THEN 0.5
          ELSE 0.15
        END,
      3
    ) AS confidence_score
  FROM scored s
)
SELECT
  b.district_name,
  b.state_ut,
  b.demand_pct,
  b.households_surveyed,
  b.category_facilities,
  b.total_facilities,
  b.demand_norm,
  b.supply_norm,
  b.balance_ratio,
  b.confidence_score,
  g.pincode_count,
  g.latitude,
  g.longitude
FROM balanced b
INNER JOIN district_geo g
  ON UPPER(TRIM(b.district_name)) = g.district_key
 AND b.state_key = g.state_key
WHERE g.latitude IS NOT NULL AND g.longitude IS NOT NULL
