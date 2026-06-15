SELECT
  facility_type,
  COUNT(*) AS facility_count
FROM dais_2026.hackathon.facility
WHERE facility_type IS NOT NULL
GROUP BY facility_type
ORDER BY facility_count DESC
LIMIT 10
