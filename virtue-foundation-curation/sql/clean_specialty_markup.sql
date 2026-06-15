-- Strip markdown-style wrappers from specialty strings, e.g.
--   *__ophthalmology__*  -> ophthalmology
--   **cardiology**       -> cardiology
--   __generalSurgery__   -> generalSurgery
-- Run before correct_specialty_typos.sql. Replace ${TARGET} with dais_2026.hackathon.

CREATE OR REPLACE TABLE ${TARGET}.specialty_markup_map AS
WITH base AS (
  SELECT DISTINCT TRIM(specialty) AS specialty
  FROM ${TARGET}.facility_specialty
  WHERE specialty IS NOT NULL AND TRIM(specialty) != ''
  UNION
  SELECT DISTINCT TRIM(specialties)
  FROM ${TARGET}.specialty_category_mapping
  WHERE specialties IS NOT NULL AND TRIM(specialties) != ''
),
cleaned AS (
  SELECT
    specialty AS raw_specialty,
    TRIM(
      regexp_replace(
        regexp_replace(TRIM(specialty), '^[*_]+', ''),
        '[*_]+$', '')
    ) AS cleaned_specialty
  FROM base
)
SELECT raw_specialty, cleaned_specialty
FROM cleaned
WHERE cleaned_specialty != raw_specialty
  AND cleaned_specialty != '';

CREATE OR REPLACE TABLE ${TARGET}.facility_specialty AS
SELECT DISTINCT
  fs.facility_id,
  COALESCE(m.cleaned_specialty, TRIM(fs.specialty)) AS specialty
FROM ${TARGET}.facility_specialty fs
LEFT JOIN ${TARGET}.specialty_markup_map m ON TRIM(fs.specialty) = m.raw_specialty
WHERE TRIM(fs.specialty) NOT LIKE '{%'
  AND TRIM(fs.specialty) NOT LIKE '[%'
  AND TRIM(COALESCE(m.cleaned_specialty, fs.specialty)) != '';

CREATE OR REPLACE TABLE ${TARGET}.specialty_category_mapping AS
WITH normalized AS (
  SELECT
    COALESCE(m.cleaned_specialty, TRIM(s.specialties)) AS specialties,
    s.category
  FROM ${TARGET}.specialty_category_mapping s
  LEFT JOIN ${TARGET}.specialty_markup_map m ON TRIM(s.specialties) = m.raw_specialty
  WHERE TRIM(s.specialties) NOT LIKE '{%'
    AND TRIM(s.specialties) NOT LIKE '[%'
    AND TRIM(COALESCE(m.cleaned_specialty, s.specialties)) != ''
),
category_votes AS (
  SELECT
    specialties,
    category,
    ROW_NUMBER() OVER (
      PARTITION BY specialties
      ORDER BY COUNT(*) DESC, category ASC
    ) AS rn
  FROM normalized
  GROUP BY specialties, category
)
SELECT specialties, category
FROM category_votes
WHERE rn = 1;

MERGE INTO ${TARGET}.facility AS target
USING (
  SELECT
    facility_id,
    to_json(sort_array(collect_set(specialty))) AS specialties_raw
  FROM ${TARGET}.facility_specialty
  GROUP BY facility_id
) AS source
ON target.facility_id = source.facility_id
WHEN MATCHED THEN UPDATE SET specialties_raw = source.specialties_raw;
