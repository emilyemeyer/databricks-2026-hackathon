SELECT
  COUNT(*) AS total_facilities,
  COUNT(DISTINCT state_ut) AS states_covered,
  COUNT(DISTINCT facility_type) AS facility_types
FROM dais_2026.hackathon.facility
