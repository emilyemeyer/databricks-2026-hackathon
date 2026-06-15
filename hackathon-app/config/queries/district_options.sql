SELECT DISTINCT
  district_id AS district_key,
  district_name,
  state_ut
FROM dais_2026.hackathon.health_indicator
ORDER BY state_ut, district_name
