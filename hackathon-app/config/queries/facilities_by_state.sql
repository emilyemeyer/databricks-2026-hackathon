SELECT
  address_stateOrRegion AS state,
  COUNT(*) AS facility_count
FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
WHERE address_stateOrRegion IS NOT NULL
GROUP BY address_stateOrRegion
ORDER BY facility_count DESC
LIMIT 15
