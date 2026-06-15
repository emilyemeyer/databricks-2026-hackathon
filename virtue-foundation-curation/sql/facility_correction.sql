-- User-editable corrections applied on top of curated facility rows.
-- Replace ${TARGET} with e.g. dais_2026.hackathon when running manually.

CREATE TABLE IF NOT EXISTS ${TARGET}.facility_correction (
  facility_id STRING NOT NULL,
  facility_name STRING,
  pincode STRING,
  operator_type STRING,
  facility_type STRING,
  doctors_count INT,
  bed_count INT,
  specialties_raw STRING,
  state_ut STRING,
  district_name STRING,
  updated_at TIMESTAMP
)
USING DELTA;

MERGE INTO ${TARGET}.facility AS f
USING ${TARGET}.facility_correction AS c
ON f.facility_id = c.facility_id
WHEN MATCHED THEN UPDATE SET
  facility_name = COALESCE(c.facility_name, f.facility_name),
  pincode = COALESCE(c.pincode, f.pincode),
  operator_type = COALESCE(c.operator_type, f.operator_type),
  operator_type_raw = COALESCE(c.operator_type, f.operator_type_raw),
  facility_type = COALESCE(c.facility_type, f.facility_type),
  doctors_count = COALESCE(c.doctors_count, f.doctors_count),
  bed_count = COALESCE(c.bed_count, f.bed_count),
  specialties_raw = COALESCE(c.specialties_raw, f.specialties_raw),
  state_ut = COALESCE(c.state_ut, f.state_ut),
  district_name = COALESCE(c.district_name, f.district_name);
