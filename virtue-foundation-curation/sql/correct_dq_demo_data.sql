-- Correct curated data for the Data Quality demo: real facilities get specialties backfilled;
-- only the demo clinic intentionally lacks facility_specialty rows.
-- Replace ${TARGET} with e.g. dais_2026.hackathon.

DELETE FROM ${TARGET}.facility_specialty
WHERE TRIM(specialty) LIKE '{%'
   OR TRIM(specialty) LIKE '[%'
   OR TRIM(specialty) = '';

DELETE FROM ${TARGET}.facility_specialty
WHERE facility_id = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

INSERT INTO ${TARGET}.facility_specialty (facility_id, specialty)
SELECT DISTINCT
  f.facility_id,
  TRIM(
    regexp_replace(
      regexp_replace(TRIM(specialty), '^[*_]+', ''),
      '[*_]+$', '')
  ) AS specialty
FROM ${TARGET}.facility f
LEFT JOIN (SELECT DISTINCT facility_id FROM ${TARGET}.facility_specialty) existing
  ON f.facility_id = existing.facility_id
LATERAL VIEW explode(
  CASE
    WHEN f.specialties_raw IS NOT NULL AND TRIM(f.specialties_raw) LIKE '[%'
    THEN from_json(f.specialties_raw, 'ARRAY<STRING>')
    ELSE array()
  END
) t AS specialty
WHERE f.facility_id != 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'
  AND existing.facility_id IS NULL
  AND specialty IS NOT NULL
  AND TRIM(
    regexp_replace(
      regexp_replace(TRIM(specialty), '^[*_]+', ''),
      '[*_]+$', '')
  ) != ''
  AND TRIM(specialty) NOT LIKE '{%'
  AND TRIM(specialty) NOT LIKE '[%';

UPDATE ${TARGET}.facility
SET specialties_raw = '[]'
WHERE facility_id = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
