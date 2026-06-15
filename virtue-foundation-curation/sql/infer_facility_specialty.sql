-- Infer specialties for facilities missing facility_specialty rows.
-- Uses Databricks ai_classify against known specialty_category_mapping labels.
-- Replace ${TARGET} with dais_2026.hackathon and ${RAW} with the raw facilities table.

CREATE OR REPLACE TABLE ${TARGET}.facility_specialty_inference AS
WITH specialty_labels AS (
  SELECT collect_list(specialty) AS labels
  FROM (
    SELECT DISTINCT TRIM(specialties) AS specialty
    FROM ${TARGET}.specialty_category_mapping
    WHERE specialties IS NOT NULL
      AND TRIM(specialties) != ''
      AND TRIM(specialties) NOT LIKE '{%'
      AND TRIM(specialties) NOT LIKE '[%'
    ORDER BY specialty
    LIMIT 400
  )
),
missing AS (
  SELECT
    f.facility_id,
    f.facility_name,
    f.facility_type,
    TRIM(raw.description) AS description,
    concat_ws(
      '\n',
      'Facility name:', COALESCE(NULLIF(NULLIF(TRIM(f.facility_name), ''), 'null'), 'Unknown'),
      'Facility type:', COALESCE(NULLIF(NULLIF(TRIM(f.facility_type), ''), 'null'), 'unknown'),
      'Description:', COALESCE(NULLIF(TRIM(raw.description), ''), 'none')
    ) AS context_text
  FROM ${TARGET}.facility f
  LEFT JOIN ${RAW}.facilities raw ON f.facility_id = TRIM(raw.unique_id)
  LEFT JOIN (SELECT DISTINCT facility_id FROM ${TARGET}.facility_specialty) fs
    ON f.facility_id = fs.facility_id
  WHERE fs.facility_id IS NULL
)
SELECT
  m.facility_id,
  m.facility_name,
  m.facility_type,
  m.description,
  m.context_text,
  ai_classify(m.context_text, sl.labels) AS inferred_specialty,
  current_timestamp() AS inferred_at
FROM missing m
CROSS JOIN specialty_labels sl;

-- Optional: apply high-confidence AI suggestions into facility_correction.
-- Review facility_specialty_inference before uncommenting.
--
-- MERGE INTO ${TARGET}.facility_correction AS target
-- USING (
--   SELECT
--     facility_id,
--     to_json(array(inferred_specialty)) AS specialties_raw
--   FROM ${TARGET}.facility_specialty_inference
--   WHERE inferred_specialty IS NOT NULL AND TRIM(inferred_specialty) != ''
-- ) AS source
-- ON target.facility_id = source.facility_id
-- WHEN MATCHED THEN UPDATE SET
--   specialties_raw = source.specialties_raw,
--   updated_at = current_timestamp()
-- WHEN NOT MATCHED THEN INSERT (facility_id, specialties_raw, updated_at)
-- VALUES (source.facility_id, source.specialties_raw, current_timestamp());
