-- Backfill facility_specialty from facility.specialties_raw when a facility has
-- parseable specialty values but no rows in facility_specialty yet.
-- Replace ${TARGET} with e.g. dais_2026.hackathon.

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
WHERE existing.facility_id IS NULL
  AND specialty IS NOT NULL
  AND TRIM(
    regexp_replace(
      regexp_replace(TRIM(specialty), '^[*_]+', ''),
      '[*_]+$', '')
  ) != ''
  AND TRIM(specialty) NOT LIKE '{%'
  AND TRIM(specialty) NOT LIKE '[%';
