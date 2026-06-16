-- Specialty demand categories ranked per district (NFHS-derived scores).
SELECT
  TRIM(district_name) AS district_name,
  TRIM(state_ut) AS state_ut,
  category,
  ROUND(demand_score, 1) AS demand_score,
  category_rank_in_district
FROM dais_2026.hackathon.demand_ranked
ORDER BY state_ut, district_name, category_rank_in_district
