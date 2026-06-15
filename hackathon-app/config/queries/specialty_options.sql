SELECT DISTINCT specialty
FROM (
  SELECT TRIM(specialties) AS specialty
  FROM dais_2026.hackathon.specialty_category_mapping
  WHERE specialties IS NOT NULL AND TRIM(specialties) != ''
  UNION
  SELECT TRIM(specialty) AS specialty
  FROM dais_2026.hackathon.facility_specialty
  WHERE specialty IS NOT NULL AND TRIM(specialty) != ''
)
WHERE specialty IS NOT NULL
  AND TRIM(specialty) != ''
  AND specialty NOT LIKE '{%'
  AND specialty NOT LIKE '[%'
ORDER BY specialty
