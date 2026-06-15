-- Build dq_metrics (snapshot KPIs) and dq_gap (actionable issues) for dais_2026.hackathon.
-- Run after facility, health_indicator, and mapping tables are populated.
-- Replace ${TARGET} with e.g. dais_2026.hackathon when running manually.

CREATE TABLE IF NOT EXISTS ${TARGET}.dq_gap (
  gap_id STRING NOT NULL,
  gap_type STRING NOT NULL,
  severity STRING NOT NULL,
  entity_type STRING NOT NULL,
  entity_key STRING NOT NULL,
  entity_label STRING,
  field_name STRING,
  current_value STRING,
  suggested_fix STRING,
  fix_action STRING NOT NULL,
  fix_payload STRING,
  status STRING NOT NULL,
  resolution_notes STRING,
  updated_at TIMESTAMP
)
USING DELTA;

CREATE OR REPLACE TABLE ${TARGET}.dq_metrics AS
WITH facility_stats AS (
  SELECT
    COUNT(*) AS total_facilities,
    COUNT(DISTINCT facility_id) AS distinct_facility_ids,
    SUM(CASE WHEN district_id IS NULL THEN 1 ELSE 0 END) AS missing_district_id,
    SUM(CASE WHEN NOT coord_valid THEN 1 ELSE 0 END) AS invalid_coords,
    SUM(CASE WHEN doctors_count IS NULL THEN 1 ELSE 0 END) AS missing_doctors,
    SUM(CASE WHEN bed_count IS NULL THEN 1 ELSE 0 END) AS missing_beds,
    SUM(CASE WHEN join_confidence = 'high' THEN 1 ELSE 0 END) AS join_high,
    SUM(CASE WHEN join_confidence = 'low' THEN 1 ELSE 0 END) AS join_low,
    SUM(CASE WHEN join_confidence = 'unmatched' THEN 1 ELSE 0 END) AS join_unmatched
  FROM ${TARGET}.facility
),
health_stats AS (
  SELECT
    COUNT(*) AS total_rows,
    COUNT(DISTINCT district_id) AS distinct_districts,
    COUNT(DISTINCT indicator_key) AS distinct_indicators,
    SUM(CASE WHEN indicator_value IS NULL THEN 1 ELSE 0 END) AS null_or_suppressed
  FROM ${TARGET}.health_indicator
),
district_gap AS (
  SELECT
    COUNT(*) AS total_nfhs_districts,
    SUM(CASE WHEN COALESCE(fc.facility_count, 0) = 0 THEN 1 ELSE 0 END) AS districts_zero_facilities
  FROM (SELECT DISTINCT district_id FROM ${TARGET}.health_indicator) d
  LEFT JOIN (
    SELECT district_id, COUNT(*) AS facility_count
    FROM ${TARGET}.facility
    WHERE district_id IS NOT NULL
    GROUP BY district_id
  ) fc ON d.district_id = fc.district_id
),
mapping_stats AS (
  SELECT
    (SELECT COUNT(*) FROM ${TARGET}.facility_specialty) AS facility_specialty_rows,
    (SELECT COUNT(*) FROM ${TARGET}.health_indicator_specialty) AS health_indicator_specialty_rows,
    (SELECT COUNT(*) FROM ${TARGET}.specialty_category_mapping) AS specialty_category_rows,
    (SELECT COUNT(DISTINCT fs.specialty)
     FROM ${TARGET}.facility_specialty fs
     LEFT JOIN ${TARGET}.specialty_category_mapping m ON fs.specialty = m.specialties
     WHERE m.specialties IS NULL) AS unmapped_specialties,
    (SELECT COUNT(*)
     FROM ${TARGET}.health_indicator_specialty his
     LEFT JOIN (SELECT DISTINCT indicator_key FROM ${TARGET}.health_indicator) hi
       ON his.indicator_key = hi.indicator_key
     WHERE hi.indicator_key IS NULL) AS orphan_indicator_mappings,
    (SELECT COUNT(DISTINCT hi.indicator_key)
     FROM (SELECT DISTINCT indicator_key FROM ${TARGET}.health_indicator) hi
     LEFT JOIN ${TARGET}.health_indicator_specialty his ON hi.indicator_key = his.indicator_key
     WHERE his.indicator_key IS NULL) AS unmapped_indicators,
    (SELECT COUNT(*)
     FROM ${TARGET}.facility f
     LEFT JOIN (SELECT DISTINCT facility_id FROM ${TARGET}.facility_specialty) fs
       ON f.facility_id = fs.facility_id
     WHERE fs.facility_id IS NULL) AS facilities_without_specialty
)
SELECT
  metric_key,
  metric_group,
  metric_label,
  CAST(actual_value AS DOUBLE) AS actual_value,
  CAST(expected_value AS DOUBLE) AS expected_value,
  unit,
  severity,
  status,
  description,
  current_timestamp() AS measured_at
FROM (
  SELECT 'facility_rows' AS metric_key, 'inventory' AS metric_group, 'Facility rows' AS metric_label,
    fs.total_facilities AS actual_value, 10000 AS expected_value, 'count' AS unit,
    CASE WHEN fs.total_facilities BETWEEN 9500 AND 10500 THEN 'good' ELSE 'warn' END AS severity,
    CASE WHEN fs.total_facilities BETWEEN 9500 AND 10500 THEN 'pass' ELSE 'warn' END AS status,
    'Cleaned facility count after deduplication' AS description
  FROM facility_stats fs
  UNION ALL
  SELECT 'facility_duplicate_ids', 'facility', 'Duplicate facility IDs',
    fs.total_facilities - fs.distinct_facility_ids, 0, 'count',
    CASE WHEN fs.total_facilities = fs.distinct_facility_ids THEN 'good' ELSE 'critical' END,
    CASE WHEN fs.total_facilities = fs.distinct_facility_ids THEN 'pass' ELSE 'fail' END,
    'Primary key uniqueness on facility_id'
  FROM facility_stats fs
  UNION ALL
  SELECT 'facility_district_match_pct', 'facility', 'District match rate',
    ROUND(100.0 * (fs.total_facilities - fs.missing_district_id) / fs.total_facilities, 1), 90, 'percent',
    CASE WHEN 100.0 * (fs.total_facilities - fs.missing_district_id) / fs.total_facilities >= 75 THEN 'good' ELSE 'warn' END,
    CASE WHEN 100.0 * (fs.total_facilities - fs.missing_district_id) / fs.total_facilities >= 75 THEN 'pass' ELSE 'warn' END,
    'Share of facilities with a resolved district_id'
  FROM facility_stats fs
  UNION ALL
  SELECT 'facility_doctors_populated_pct', 'facility', 'Doctors field populated',
    ROUND(100.0 * (fs.total_facilities - fs.missing_doctors) / fs.total_facilities, 1), NULL, 'percent',
    'warn', 'warn', 'Parsed doctors_count availability'
  FROM facility_stats fs
  UNION ALL
  SELECT 'facility_beds_populated_pct', 'facility', 'Beds field populated',
    ROUND(100.0 * (fs.total_facilities - fs.missing_beds) / fs.total_facilities, 1), NULL, 'percent',
    'warn', 'warn', 'Parsed bed_count availability'
  FROM facility_stats fs
  UNION ALL
  SELECT 'facility_join_high_pct', 'facility', 'High-confidence geography join',
    ROUND(100.0 * fs.join_high / fs.total_facilities, 1), NULL, 'percent',
    CASE WHEN 100.0 * fs.join_high / fs.total_facilities >= 70 THEN 'good' ELSE 'warn' END,
    CASE WHEN 100.0 * fs.join_high / fs.total_facilities >= 70 THEN 'pass' ELSE 'warn' END,
    'Pincode + district match quality'
  FROM facility_stats fs
  UNION ALL
  SELECT 'health_indicator_districts', 'health_indicator', 'NFHS districts',
    hs.distinct_districts, 706, 'count', 'good', 'pass', 'Distinct districts in health_indicator'
  FROM health_stats hs
  UNION ALL
  SELECT 'health_indicator_populated_pct', 'health_indicator', 'Indicator values populated',
    ROUND(100.0 * (hs.total_rows - hs.null_or_suppressed) / hs.total_rows, 1), NULL, 'percent',
    'good', 'pass', 'Non-null, non-suppressed indicator values'
  FROM health_stats hs
  UNION ALL
  SELECT 'districts_zero_facilities', 'geographic_gap', 'Districts with zero facilities',
    dg.districts_zero_facilities, NULL, 'count', 'warn', 'warn',
    'NFHS districts with no matched supply — may be scrape bias'
  FROM district_gap dg
  UNION ALL
  SELECT 'districts_zero_facilities_pct', 'geographic_gap', 'Zero-facility district share',
    ROUND(100.0 * dg.districts_zero_facilities / dg.total_nfhs_districts, 1), NULL, 'percent',
    'warn', 'warn', 'Percentage of NFHS districts without matched facilities'
  FROM district_gap dg
  UNION ALL
  SELECT 'unmapped_specialties', 'mapping', 'Unmapped facility specialties',
    ms.unmapped_specialties, 0, 'count',
    CASE WHEN ms.unmapped_specialties = 0 THEN 'good' ELSE 'warn' END,
    CASE WHEN ms.unmapped_specialties = 0 THEN 'pass' ELSE 'warn' END,
    'Specialties in facility_specialty missing from specialty_category_mapping'
  FROM mapping_stats ms
  UNION ALL
  SELECT 'orphan_indicator_mappings', 'mapping', 'Orphan indicator mappings',
    ms.orphan_indicator_mappings, 0, 'count',
    CASE WHEN ms.orphan_indicator_mappings = 0 THEN 'good' ELSE 'critical' END,
    CASE WHEN ms.orphan_indicator_mappings = 0 THEN 'pass' ELSE 'fail' END,
    'health_indicator_specialty keys not present in health_indicator'
  FROM mapping_stats ms
  UNION ALL
  SELECT 'unmapped_indicators', 'mapping', 'Unmapped NFHS indicators',
    ms.unmapped_indicators, 0, 'count', 'warn', 'warn',
    'Indicators without a specialty category mapping for gap analysis'
  FROM mapping_stats ms
  UNION ALL
  SELECT 'facilities_without_specialty', 'mapping', 'Facilities without specialties',
    ms.facilities_without_specialty, 0, 'count',
    CASE WHEN ms.facilities_without_specialty = 0 THEN 'good' ELSE 'warn' END,
    CASE WHEN ms.facilities_without_specialty = 0 THEN 'pass' ELSE 'warn' END,
    'Facilities missing rows in facility_specialty'
  FROM mapping_stats ms
);

CREATE OR REPLACE TABLE ${TARGET}.dq_gap_staging AS
SELECT
  md5(concat_ws('|', gap_type, entity_type, entity_key, COALESCE(field_name, ''))) AS gap_id,
  gap_type,
  severity,
  entity_type,
  entity_key,
  entity_label,
  field_name,
  current_value,
  suggested_fix,
  fix_action,
  fix_payload
FROM (
  SELECT
    'unmapped_specialty' AS gap_type,
    'warn' AS severity,
    'specialty' AS entity_type,
    fs.specialty AS entity_key,
    fs.specialty AS entity_label,
    'category' AS field_name,
    CAST(NULL AS STRING) AS current_value,
    'Assign a specialty category' AS suggested_fix,
    'add_specialty_category_mapping' AS fix_action,
    to_json(named_struct('specialty', fs.specialty)) AS fix_payload
  FROM (
    SELECT DISTINCT specialty FROM ${TARGET}.facility_specialty
  ) fs
  LEFT JOIN ${TARGET}.specialty_category_mapping m ON fs.specialty = m.specialties
  WHERE m.specialties IS NULL

  UNION ALL

  SELECT
    'orphan_indicator_mapping',
    'critical',
    'indicator',
    his.indicator_key,
    his.indicator_key,
    'indicator_key',
    his.indicator_key,
    'Remove or correct the indicator key',
    'delete_health_indicator_specialty',
    to_json(named_struct(
      'indicator_key', his.indicator_key,
      'specialty_category', his.specialty_category
    ))
  FROM ${TARGET}.health_indicator_specialty his
  LEFT JOIN (SELECT DISTINCT indicator_key FROM ${TARGET}.health_indicator) hi
    ON his.indicator_key = hi.indicator_key
  WHERE hi.indicator_key IS NULL

  UNION ALL

  SELECT
    'unmapped_indicator',
    'warn',
    'indicator',
    hi.indicator_key,
    hi.indicator_key,
    'specialty_category',
    CAST(NULL AS STRING),
    'Map indicator to a supply specialty category',
    'add_health_indicator_specialty',
    to_json(named_struct('indicator_key', hi.indicator_key))
  FROM (SELECT DISTINCT indicator_key FROM ${TARGET}.health_indicator) hi
  LEFT JOIN ${TARGET}.health_indicator_specialty his ON hi.indicator_key = his.indicator_key
  WHERE his.indicator_key IS NULL

  UNION ALL

  SELECT
    'facility_without_specialty',
    'warn',
    'facility',
    f.facility_id,
    COALESCE(
      NULLIF(NULLIF(TRIM(f.facility_name), ''), 'null'),
      NULLIF(LEFT(TRIM(raw.description), 120), ''),
      f.facility_id
    ),
    'specialties_raw',
    COALESCE(f.specialties_raw, ''),
    'Use AI to infer specialty from facility name and description, or pick manually',
    'update_facility_field',
    to_json(named_struct(
      'facility_id', f.facility_id,
      'field_name', 'specialties_raw',
      'current_value', COALESCE(f.specialties_raw, ''),
      'facility_name', f.facility_name,
      'facility_type', f.facility_type,
      'description', raw.description
    ))
  FROM ${TARGET}.facility f
  LEFT JOIN databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities raw
    ON f.facility_id = TRIM(raw.unique_id)
  LEFT JOIN (SELECT DISTINCT facility_id FROM ${TARGET}.facility_specialty) fs
    ON f.facility_id = fs.facility_id
  WHERE fs.facility_id IS NULL

  UNION ALL

  SELECT
    'missing_pincode',
    'warn',
    'facility',
    f.facility_id,
    COALESCE(f.facility_name, f.facility_id),
    'pincode',
    COALESCE(CAST(f.pincode AS STRING), ''),
    'Add a valid 6-digit pincode on the facility source row',
    'update_facility_field',
    to_json(named_struct(
      'facility_id', f.facility_id,
      'field_name', 'pincode',
      'current_value', COALESCE(CAST(f.pincode AS STRING), ''),
      'facility_name', f.facility_name
    ))
  FROM ${TARGET}.facility f
  WHERE f.pincode IS NULL

  UNION ALL

  SELECT
    'invalid_facility_type',
    'warn',
    'facility',
    f.facility_id,
    COALESCE(f.facility_name, f.facility_id),
    'facility_type',
    COALESCE(f.facility_type, ''),
    'Set a valid facility type on the facility source row',
    'update_facility_field',
    to_json(named_struct(
      'facility_id', f.facility_id,
      'field_name', 'facility_type',
      'current_value', COALESCE(f.facility_type, ''),
      'facility_name', f.facility_name
    ))
  FROM ${TARGET}.facility f
  WHERE f.facility_type IS NULL
    OR TRIM(f.facility_type) IN ('', 'null')
    OR f.facility_type RLIKE '^[0-9.]+$'
);

MERGE INTO ${TARGET}.dq_gap AS target
USING ${TARGET}.dq_gap_staging AS source
ON target.gap_id = source.gap_id
WHEN MATCHED AND target.status = 'dismissed' THEN UPDATE SET
  gap_type = source.gap_type,
  severity = source.severity,
  entity_type = source.entity_type,
  entity_key = source.entity_key,
  entity_label = source.entity_label,
  field_name = source.field_name,
  current_value = source.current_value,
  suggested_fix = source.suggested_fix,
  fix_action = source.fix_action,
  fix_payload = source.fix_payload,
  updated_at = current_timestamp()
WHEN MATCHED THEN UPDATE SET
  gap_type = source.gap_type,
  severity = source.severity,
  entity_type = source.entity_type,
  entity_key = source.entity_key,
  entity_label = source.entity_label,
  field_name = source.field_name,
  current_value = source.current_value,
  suggested_fix = source.suggested_fix,
  fix_action = source.fix_action,
  fix_payload = source.fix_payload,
  status = CASE WHEN target.status = 'resolved' THEN 'open' ELSE target.status END,
  updated_at = current_timestamp()
WHEN NOT MATCHED THEN INSERT (
  gap_id, gap_type, severity, entity_type, entity_key, entity_label,
  field_name, current_value, suggested_fix, fix_action, fix_payload,
  status, resolution_notes, updated_at
) VALUES (
  source.gap_id, source.gap_type, source.severity, source.entity_type, source.entity_key,
  source.entity_label, source.field_name, source.current_value, source.suggested_fix,
  source.fix_action, source.fix_payload, 'open', NULL, current_timestamp()
);

UPDATE ${TARGET}.dq_gap AS target
SET
  status = 'auto_resolved',
  resolution_notes = 'Gap no longer detected during curation refresh',
  updated_at = current_timestamp()
WHERE target.status IN ('open', 'resolved')
  AND NOT EXISTS (
    SELECT 1 FROM ${TARGET}.dq_gap_staging source WHERE source.gap_id = target.gap_id
  );

DROP TABLE IF EXISTS ${TARGET}.dq_gap_staging;
