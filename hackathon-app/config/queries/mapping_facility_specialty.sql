SELECT
  fs.facility_id,
  f.facility_name,
  fs.specialty,
  CAST(m.category AS STRING) AS specialty_category
FROM dais_2026.hackathon.facility_specialty fs
LEFT JOIN dais_2026.hackathon.facility f ON fs.facility_id = f.facility_id
LEFT JOIN dais_2026.hackathon.specialty_category_mapping m ON fs.specialty = m.specialties
ORDER BY f.facility_name, fs.specialty
LIMIT 500
