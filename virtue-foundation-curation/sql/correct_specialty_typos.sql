-- Correct specialty spelling mistakes (e.g. opthalmology -> ophthalmology,
-- ophthamology -> ophthalmology) then rebuild mapping tables.
-- Run before normalize_specialties.sql. Replace ${TARGET} with dais_2026.hackathon.

CREATE OR REPLACE TABLE ${TARGET}.specialty_typo_regex_staging AS
WITH base AS (
  SELECT DISTINCT TRIM(specialty) AS specialty
  FROM ${TARGET}.facility_specialty
  WHERE specialty IS NOT NULL AND TRIM(specialty) != '' AND TRIM(specialty) NOT LIKE '{%'
  UNION
  SELECT DISTINCT TRIM(specialties)
  FROM ${TARGET}.specialty_category_mapping
  WHERE specialties IS NOT NULL AND TRIM(specialties) != '' AND TRIM(specialties) NOT LIKE '{%'
),
step1 AS (
  SELECT specialty,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(specialty, '(?i)optham', 'ophthalm'),
              '(?i)ophtham', 'ophthalm'),
            '(?i)opthalm', 'ophthalm'),
          '(?i)gastroentrology', 'gastroenterology'),
        '(?i)pulmanology', 'pulmonology'),
      '(?i)peadiatric', 'pediatric') AS s1
  FROM base
),
step2 AS (
  SELECT specialty,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(s1, '(?i)neonatalogy', 'neonatology'),
              '(?i)physiotheraphy', 'physiotherapy'),
            '(?i)periondontics', 'periodontics'),
          '(?i)peridontics', 'periodontics'),
        '(?i)prosthodontoics', 'prosthodontics'),
      '(?i)podiary', 'podiatry') AS s2
  FROM step1
),
step3 AS (
  SELECT specialty,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(s2, '(?i)implantalogy', 'implantology'),
              '(?i)occuloplasty', 'oculoplasty'),
            '(?i)ooculoplastics', 'oculoplastics'),
          '(?i)laproscopic', 'laparoscopic'),
        '(?i)laproscopy', 'laparoscopy'),
      '(?i)dentistory', 'dentistry') AS s3
  FROM step2
)
SELECT
  specialty,
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(s3, '(?i)gynacology', 'gynaecology'),
            '(?i)hepatoBililary', 'hepatobiliary'),
          '(?i)andrologyAnMale', 'andrologyAndMale'),
        '(?i)geratrics', 'geriatrics'),
      '(?i)podiatricDermatology', 'pediatricDermatology'),
    '(?i)podiatricOncology', 'pediatricOncology') AS corrected_specialty
FROM step3;

CREATE OR REPLACE TABLE ${TARGET}.specialty_typo_map AS
WITH usage AS (
  SELECT TRIM(specialty) AS specialty, COUNT(*) AS cnt
  FROM ${TARGET}.facility_specialty
  GROUP BY TRIM(specialty)
),
step1 AS (
  SELECT
    specialty AS raw_specialty,
    corrected_specialty AS step1_specialty
  FROM ${TARGET}.specialty_typo_regex_staging
),
pairs AS (
  SELECT
    a.step1_specialty AS raw,
    b.step1_specialty AS canonical,
    COALESCE(ua.cnt, 0) AS a_cnt,
    COALESCE(ub.cnt, 0) AS b_cnt
  FROM step1 a
  JOIN step1 b ON a.step1_specialty < b.step1_specialty
  LEFT JOIN usage ua ON a.raw_specialty = ua.specialty
  LEFT JOIN usage ub ON b.raw_specialty = ub.specialty
  WHERE levenshtein(
      regexp_replace(regexp_replace(LOWER(a.step1_specialty), ' ', ''), '-', ''),
      regexp_replace(regexp_replace(LOWER(b.step1_specialty), ' ', ''), '-', '')
    ) = 1
),
auto_map AS (
  SELECT
    CASE WHEN a_cnt < b_cnt THEN raw ELSE canonical END AS step1_specialty,
    CASE WHEN a_cnt < b_cnt THEN canonical ELSE raw END AS corrected_specialty
  FROM pairs
  WHERE LEAST(a_cnt, b_cnt) <= 20
    AND GREATEST(a_cnt, b_cnt) >= LEAST(a_cnt, b_cnt) * 5
    AND NOT (
      (LOWER(raw) RLIKE 'paed' AND LOWER(canonical) RLIKE 'ped') OR
      (LOWER(raw) RLIKE 'ped' AND LOWER(canonical) RLIKE 'paed') OR
      (LOWER(raw) RLIKE 'gyna' AND LOWER(canonical) RLIKE 'gynec') OR
      (LOWER(raw) RLIKE 'gynec' AND LOWER(canonical) RLIKE 'gyna') OR
      (LOWER(raw) RLIKE 'haem' AND LOWER(canonical) RLIKE 'hem') OR
      (LOWER(raw) RLIKE 'hem' AND LOWER(canonical) RLIKE 'haem') OR
      (LOWER(raw) RLIKE 'anaesth' AND LOWER(canonical) RLIKE 'anesth') OR
      (LOWER(raw) RLIKE 'anesth' AND LOWER(canonical) RLIKE 'anaesth') OR
      (LOWER(raw) RLIKE 'orthopa' AND LOWER(canonical) RLIKE 'orthope') OR
      (LOWER(raw) RLIKE 'orthope' AND LOWER(canonical) RLIKE 'orthopa') OR
      (LOWER(raw) RLIKE 'esthetic' AND LOWER(canonical) RLIKE 'aesthetic') OR
      (LOWER(raw) RLIKE 'aesthetic' AND LOWER(canonical) RLIKE 'esthetic') OR
      (LOWER(raw) RLIKE 'hematology' AND LOWER(canonical) RLIKE 'hepatology') OR
      (LOWER(raw) RLIKE 'hepatology' AND LOWER(canonical) RLIKE 'hematology')
    )
)
SELECT DISTINCT
  s.raw_specialty,
  COALESCE(am.corrected_specialty, s.step1_specialty) AS corrected_specialty
FROM step1 s
LEFT JOIN auto_map am ON s.step1_specialty = am.step1_specialty
WHERE COALESCE(am.corrected_specialty, s.step1_specialty) != s.raw_specialty;

CREATE OR REPLACE TABLE ${TARGET}.facility_specialty AS
SELECT DISTINCT
  fs.facility_id,
  COALESCE(m.corrected_specialty, TRIM(fs.specialty)) AS specialty
FROM ${TARGET}.facility_specialty fs
LEFT JOIN ${TARGET}.specialty_typo_map m ON TRIM(fs.specialty) = m.raw_specialty
WHERE TRIM(fs.specialty) NOT LIKE '{%'
  AND TRIM(fs.specialty) NOT LIKE '[%'
  AND TRIM(COALESCE(m.corrected_specialty, fs.specialty)) != '';

CREATE OR REPLACE TABLE ${TARGET}.specialty_category_mapping AS
WITH corrected AS (
  SELECT
    COALESCE(m.corrected_specialty, TRIM(s.specialties)) AS specialties,
    s.category
  FROM ${TARGET}.specialty_category_mapping s
  LEFT JOIN ${TARGET}.specialty_typo_map m ON TRIM(s.specialties) = m.raw_specialty
  WHERE TRIM(s.specialties) NOT LIKE '{%'
    AND TRIM(s.specialties) NOT LIKE '[%'
    AND TRIM(COALESCE(m.corrected_specialty, s.specialties)) != ''
),
category_votes AS (
  SELECT
    specialties,
    category,
    ROW_NUMBER() OVER (
      PARTITION BY specialties
      ORDER BY COUNT(*) DESC, category ASC
    ) AS rn
  FROM corrected
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
