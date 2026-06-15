SELECT DISTINCT
  category_name AS specialty_category
FROM dais_2026.hackathon.specialty_category_mapping
LATERAL VIEW explode(from_json(CAST(category AS STRING), 'ARRAY<STRING>')) t AS category_name
WHERE category_name IS NOT NULL AND TRIM(category_name) != ''
ORDER BY specialty_category
