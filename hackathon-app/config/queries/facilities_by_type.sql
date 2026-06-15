SELECT
  facilityTypeId AS facility_type,
  COUNT(*) AS facility_count
FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
WHERE facilityTypeId IS NOT NULL
GROUP BY facilityTypeId
ORDER BY facility_count DESC
LIMIT 10
