-- Merge staged dq gaps into dq_gap, auto-resolve stale rows, and drop staging.
-- Used after dq_gap_staging is populated (full refresh or recovery from interrupted run).
-- Replace ${TARGET} with e.g. dais_2026.hackathon when running manually.

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
