SELECT
  CONCAT(TRIM(district_name), ' | ', TRIM(state_ut)) AS district_key,
  TRIM(district_name) AS district_name,
  TRIM(state_ut) AS state_ut
FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators
ORDER BY state_ut, district_name
