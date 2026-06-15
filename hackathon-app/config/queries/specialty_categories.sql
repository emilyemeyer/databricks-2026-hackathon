SELECT DISTINCT
  category AS specialty_category
FROM dais_2026.hackathon.specialty_category_mapping
WHERE category IS NOT NULL AND TRIM(category) != ''
ORDER BY specialty_category
