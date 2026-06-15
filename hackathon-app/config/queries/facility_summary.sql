SELECT
  COUNT(*) AS total_facilities,
  COUNT(DISTINCT address_stateOrRegion) AS states_covered,
  COUNT(DISTINCT facilityTypeId) AS facility_types
FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
