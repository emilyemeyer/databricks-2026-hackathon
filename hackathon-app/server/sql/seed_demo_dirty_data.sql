-- Idempotent demo dirty rows for the Data Quality "Actionable gaps" UI.
-- Demo facility id aaaaaaaa-bbbb-4ccc-8ddd-000000000001 is the only facility that
-- intentionally lacks facility_specialty rows (see correct_dq_demo_data.sql).

MERGE INTO dais_2026.hackathon.facility AS target
USING (
  SELECT
    'aaaaaaaa-bbbb-4ccc-8ddd-000000000001' AS facility_id,
    'Hackathon DQ Demo Clinic' AS facility_name,
    anchor.state_ut AS state_ut_raw,
    anchor.state_ut,
    anchor.district_id,
    anchor.district_name,
    COALESCE(
      (
        SELECT MIN(f.pincode)
        FROM dais_2026.hackathon.facility f
        WHERE f.district_id = anchor.district_id
          AND f.pincode IS NOT NULL
      ),
      '737101'
    ) AS pincode,
    'private' AS operator_type_raw,
    'private' AS operator_type,
    CAST(0 AS INT) AS doctors_count,
    CAST(5 AS INT) AS bed_count,
    CAST(27.33 AS DOUBLE) AS lat,
    CAST(88.61 AS DOUBLE) AS lon,
    true AS coord_valid,
    'clinic' AS facility_type,
    '[]' AS specialties_raw,
    'high' AS join_confidence
  FROM (
    SELECT district_id, district_name, state_ut
    FROM dais_2026.hackathon.health_indicator
    WHERE district_name IS NOT NULL
      AND state_ut IS NOT NULL
    ORDER BY state_ut, district_name
    LIMIT 1
  ) anchor
) AS source
ON target.facility_id = source.facility_id
WHEN NOT MATCHED THEN INSERT (
  facility_id,
  facility_name,
  state_ut_raw,
  state_ut,
  district_id,
  district_name,
  pincode,
  operator_type_raw,
  operator_type,
  doctors_count,
  bed_count,
  lat,
  lon,
  coord_valid,
  facility_type,
  specialties_raw,
  join_confidence
)
VALUES (
  source.facility_id,
  source.facility_name,
  source.state_ut_raw,
  source.state_ut,
  source.district_id,
  source.district_name,
  source.pincode,
  source.operator_type_raw,
  source.operator_type,
  source.doctors_count,
  source.bed_count,
  source.lat,
  source.lon,
  source.coord_valid,
  source.facility_type,
  source.specialties_raw,
  source.join_confidence
);
