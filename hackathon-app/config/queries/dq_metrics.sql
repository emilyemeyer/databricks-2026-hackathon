-- @param _refresh STRING
SELECT
  metric_key,
  metric_group,
  metric_label,
  actual_value,
  expected_value,
  unit,
  severity,
  status,
  description,
  measured_at
FROM dais_2026.hackathon.dq_metrics
WHERE COALESCE(:_refresh, '') = COALESCE(:_refresh, '')
ORDER BY
  CASE metric_group
    WHEN 'inventory' THEN 1
    WHEN 'facility' THEN 2
    WHEN 'health_indicator' THEN 3
    WHEN 'mapping' THEN 4
    WHEN 'geographic_gap' THEN 5
    ELSE 6
  END,
  metric_key
