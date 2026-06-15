SELECT
  COALESCE(state_ut, state_ut_raw) AS state,
  COUNT(*) AS facility_count
FROM dais_2026.hackathon.facility
WHERE COALESCE(state_ut, state_ut_raw) IS NOT NULL
GROUP BY COALESCE(state_ut, state_ut_raw)
ORDER BY facility_count DESC
LIMIT 15
