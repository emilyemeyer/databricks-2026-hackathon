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
  SELECT pincode, district, statename
  FROM (
    SELECT pincode, district, statename,
      ROW_NUMBER() OVER (PARTITION BY pincode ORDER BY district) AS rn
    FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  )
  WHERE rn = 1
),
facilities_all AS (
  SELECT
    unique_id,
    TRY_CAST(REGEXP_REPLACE(address_zipOrPostcode, '[^0-9]', '') AS BIGINT) AS pincode_clean
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
),
facility_pincode_matched AS (
  SELECT DISTINCT fa.unique_id
  FROM facilities_all fa
  INNER JOIN pincode_one p ON fa.pincode_clean = p.pincode
  WHERE fa.pincode_clean IS NOT NULL
),
facility_district AS (
  SELECT
    f.unique_id,
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
    COALESCE(sm.norm_state, UPPER(TRIM(statename))) AS state_key
  FROM facility_district fd
  LEFT JOIN state_map sm ON UPPER(TRIM(fd.statename)) = sm.raw_state
  GROUP BY 1, 2
),
nfhs AS (
  SELECT
    TRIM(district_name) AS district_name,
    COALESCE(sm.norm_state, UPPER(TRIM(state_ut))) AS state_key
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators n
  LEFT JOIN state_map sm ON UPPER(TRIM(n.state_ut)) = sm.raw_state
),
nfhs_joined AS (
  SELECT
    n.district_name,
    CASE WHEN s.district_key IS NOT NULL THEN 1 ELSE 0 END AS has_facilities
  FROM nfhs n
  LEFT JOIN district_supply s
    ON UPPER(TRIM(n.district_name)) = s.district_key
   AND n.state_key = s.state_key
)
SELECT
  (SELECT COUNT(*) FROM facilities_all) AS facilities_total,
  (SELECT COUNT(*) FROM facility_pincode_matched) AS facilities_matched_to_pincode,
  ROUND(100.0 * (SELECT COUNT(*) FROM facility_pincode_matched) / (SELECT COUNT(*) FROM facilities_all), 1) AS facilities_pincode_match_pct,
  (SELECT COUNT(*) FROM nfhs) AS nfhs_districts_total,
  (SELECT SUM(has_facilities) FROM nfhs_joined) AS nfhs_districts_with_facilities,
  ROUND(100.0 * (SELECT SUM(has_facilities) FROM nfhs_joined) / (SELECT COUNT(*) FROM nfhs), 1) AS nfhs_districts_with_facilities_pct,
  (SELECT COUNT(*) FROM nfhs_joined WHERE has_facilities = 0) AS nfhs_districts_unmatched
