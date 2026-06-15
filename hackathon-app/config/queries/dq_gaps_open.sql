-- @param _refresh STRING
SELECT
  gap_id,
  gap_type,
  severity,
  entity_type,
  CAST(entity_key AS STRING) AS entity_key,
  CAST(entity_label AS STRING) AS entity_label,
  field_name,
  current_value,
  suggested_fix,
  fix_action,
  fix_payload,
  status,
  resolution_notes,
  updated_at
FROM dais_2026.hackathon.dq_gap
WHERE status = 'open'
  AND COALESCE(:_refresh, '') = COALESCE(:_refresh, '')
ORDER BY
  CASE severity WHEN 'critical' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END,
  gap_type,
  entity_label
