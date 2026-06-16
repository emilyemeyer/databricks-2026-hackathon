-- Specialty demand categories ranked per district via health_indicator_specialty.
WITH category_demand AS (
  SELECT
    TRIM(hi.district_name) AS district_name,
    TRIM(hi.state_ut) AS state_ut,
    his.specialty_category AS specialty_category,
    AVG(hi.indicator_value) AS demand_score
  FROM dais_2026.hackathon.health_indicator hi
  INNER JOIN dais_2026.hackathon.health_indicator_specialty his
    ON hi.indicator_key = his.indicator_key
  WHERE NOT COALESCE(hi.is_suppressed, false)
    AND hi.indicator_key NOT IN (
      'households_surveyed',
      'women_15_49_interviewed',
      'men_15_54_interviewed'
    )
    AND hi.indicator_value IS NOT NULL
  GROUP BY 1, 2, 3
),
ranked AS (
  SELECT
    district_name,
    state_ut,
    specialty_category,
    demand_score,
    ROW_NUMBER() OVER (
      PARTITION BY district_name, state_ut
      ORDER BY demand_score DESC NULLS LAST, specialty_category
    ) AS category_rank_in_district
  FROM category_demand
)
SELECT
  district_name,
  state_ut,
  specialty_category AS category,
  ROUND(demand_score, 1) AS demand_score,
  category_rank_in_district
FROM ranked
ORDER BY state_ut, district_name, category_rank_in_district
