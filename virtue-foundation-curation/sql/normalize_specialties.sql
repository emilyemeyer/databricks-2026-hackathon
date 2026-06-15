-- Normalize specialty strings: merge case variants (e.g. "Pathology Lab" / "Pathology lab")
-- and remove JSON garbage rows. Replace ${TARGET} with e.g. dais_2026.hackathon.

-- 1) Canonical map: per lowercase key, keep the most-used exact spelling.
CREATE OR REPLACE TABLE ${TARGET}.specialty_canonical_map AS
WITH usage AS (
  SELECT specialty, SUM(cnt) AS total_cnt
  FROM (
    SELECT TRIM(specialty) AS specialty, COUNT(*) AS cnt
    FROM ${TARGET}.facility_specialty
    WHERE specialty IS NOT NULL
      AND TRIM(specialty) != ''
      AND TRIM(specialty) NOT LIKE '{%'
      AND TRIM(specialty) NOT LIKE '[%'
    GROUP BY TRIM(specialty)
    UNION ALL
    SELECT TRIM(specialties) AS specialty, COUNT(*) AS cnt
    FROM ${TARGET}.specialty_category_mapping
    WHERE specialties IS NOT NULL
      AND TRIM(specialties) != ''
      AND TRIM(specialties) NOT LIKE '{%'
      AND TRIM(specialties) NOT LIKE '[%'
    GROUP BY TRIM(specialties)
  ) u
  GROUP BY specialty
),
ranked AS (
  SELECT
    specialty,
    LOWER(TRIM(specialty)) AS specialty_key,
    total_cnt,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(specialty))
      ORDER BY total_cnt DESC, specialty ASC
    ) AS rn
  FROM usage
),
winners AS (
  SELECT specialty_key, specialty AS canonical_specialty
  FROM ranked
  WHERE rn = 1
),
all_variants AS (
  SELECT TRIM(specialty) AS raw_specialty
  FROM ${TARGET}.facility_specialty
  WHERE specialty IS NOT NULL AND TRIM(specialty) != ''
  UNION
  SELECT TRIM(specialties)
  FROM ${TARGET}.specialty_category_mapping
  WHERE specialties IS NOT NULL AND TRIM(specialties) != ''
)
SELECT DISTINCT
  v.raw_specialty,
  w.canonical_specialty
FROM all_variants v
INNER JOIN winners w ON LOWER(TRIM(v.raw_specialty)) = w.specialty_key
WHERE TRIM(v.raw_specialty) NOT LIKE '{%'
  AND TRIM(v.raw_specialty) NOT LIKE '[%';

-- 2) facility_specialty: apply canonical names and dedupe.
CREATE OR REPLACE TABLE ${TARGET}.facility_specialty AS
SELECT DISTINCT
  fs.facility_id,
  COALESCE(m.canonical_specialty, TRIM(fs.specialty)) AS specialty
FROM ${TARGET}.facility_specialty fs
LEFT JOIN ${TARGET}.specialty_canonical_map m ON TRIM(fs.specialty) = m.raw_specialty
WHERE TRIM(fs.specialty) NOT LIKE '{%'
  AND TRIM(fs.specialty) NOT LIKE '[%'
  AND TRIM(COALESCE(m.canonical_specialty, fs.specialty)) != '';

-- 3) specialty_category_mapping: canonical names, one category per specialty (majority vote).
CREATE OR REPLACE TABLE ${TARGET}.specialty_category_mapping AS
WITH normalized AS (
  SELECT
    COALESCE(m.canonical_specialty, TRIM(s.specialties)) AS specialties,
    s.category
  FROM ${TARGET}.specialty_category_mapping s
  LEFT JOIN ${TARGET}.specialty_canonical_map m ON TRIM(s.specialties) = m.raw_specialty
  WHERE TRIM(s.specialties) NOT LIKE '{%'
    AND TRIM(s.specialties) NOT LIKE '[%'
    AND TRIM(COALESCE(m.canonical_specialty, s.specialties)) != ''
),
category_votes AS (
  SELECT
    specialties,
    category,
    COUNT(*) AS votes,
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

-- 4) facility.specialties_raw: sync from normalized facility_specialty rows.
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
