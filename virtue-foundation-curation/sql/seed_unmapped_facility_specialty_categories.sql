-- Map facility specialties missing from specialty_category_mapping (keyword rules + case-insensitive reuse).
-- Replace ${TARGET} with e.g. dais_2026.hackathon.

INSERT INTO ${TARGET}.specialty_category_mapping (specialties, category)
WITH unmapped AS (
  SELECT DISTINCT TRIM(fs.specialty) AS specialty
  FROM ${TARGET}.facility_specialty fs
  LEFT JOIN ${TARGET}.specialty_category_mapping m ON fs.specialty = m.specialties
  WHERE m.specialties IS NULL
    AND fs.specialty IS NOT NULL
    AND TRIM(fs.specialty) != ''
    AND TRIM(fs.specialty) NOT LIKE '{%'
    AND TRIM(fs.specialty) NOT LIKE '[%'
),
exact_match AS (
  SELECT
    u.specialty,
    m.category
  FROM unmapped u
  INNER JOIN ${TARGET}.specialty_category_mapping m
    ON LOWER(TRIM(u.specialty)) = LOWER(TRIM(m.specialties))
),
classified AS (
  SELECT
    u.specialty,
    COALESCE(
      e.category,
      CASE
        WHEN LOWER(u.specialty) RLIKE '(oncolog|hemato|haemato|hemato-onc|tumor|tumour|cancer|histopath|cytolog|radiotherapy|chemotherapy|hipec|psma)' THEN 'Cancer Care (Oncology)'
        WHEN LOWER(u.specialty) RLIKE '(cardio|heart|vascular|hypertension|coronary)' THEN 'Cardiovascular Care'
        WHEN LOWER(u.specialty) RLIKE '(dental|dentist|odont|orthod|endod|pedod|periodont|prosthod|oral|maxillo|implant)' THEN 'Dental & Oral Health'
        WHEN LOWER(u.specialty) RLIKE '(dermat|skin|cosmet|tricholog)' THEN 'Dermatology & Skin Care'
        WHEN LOWER(u.specialty) RLIKE '(emergency|critical care|icu|anesthesia|anaesthesia|trauma|pain management)' THEN 'Emergency, Critical Care & Anesthesia'
        WHEN LOWER(u.specialty) RLIKE '(endocrin|diabet|metabolic|bariatric|obesity|thyroid)' THEN 'Endocrine & Metabolic Care'
        WHEN LOWER(u.specialty) RLIKE '(ophthalm|ocul|optom|strabismus|retina|cornea|glaucoma|vitro)' THEN 'Eye Care (Ophthalmology)'
        WHEN LOWER(u.specialty) RLIKE '(psychiat|psycholog|mental|behavior|behaviour|deaddict|addiction)' THEN 'Mental Health & Behavioral Health'
        WHEN LOWER(u.specialty) RLIKE '(neuro|epilep|stroke)' THEN 'Neurology & Neurosciences'
        WHEN LOWER(u.specialty) RLIKE '(orthop|ortho|musculo|rheumat|physio|physical therap|sports medicine|spine|joint|bone)' THEN 'Orthopedics & Musculoskeletal Care'
        WHEN LOWER(u.specialty) RLIKE '(pediat|paediat|neonat|child health|infant)' THEN 'Pediatrics & Child Health'
        WHEN LOWER(u.specialty) RLIKE '(pulmon|respir|chest|lung|tuberc|tb )' THEN 'Respiratory & Pulmonary Care'
        WHEN LOWER(u.specialty) RLIKE '(gynaec|gynec|obstet|fertil|maternal|women|reproductive|ivf|ob-gyn|obgyn|breast)' THEN 'Women''s Health'
        WHEN LOWER(u.specialty) RLIKE '(surgery|surgical|urolog|nephrol|gastroenter|ent|otolaryng|laparo|hepatobiliary|transplant|andrology|audiolog)' THEN 'Surgery & Specialty Procedures'
        WHEN LOWER(u.specialty) RLIKE '(general|internal medicine|geriatr|family medicine|primary|patholog|laboratory|radiolog|nuclear medicine|medicine|physician|lab )' THEN 'Primary Care & General Medicine'
        ELSE 'Primary Care & General Medicine'
      END
    ) AS category
  FROM unmapped u
  LEFT JOIN exact_match e ON u.specialty = e.specialty
)
SELECT specialty, category
FROM classified;
