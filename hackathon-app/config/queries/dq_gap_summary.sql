SELECT
  gap_type,
  severity,
  COUNT(*) AS open_gap_count
FROM dais_2026.hackathon.dq_gap
WHERE status = 'open'
GROUP BY gap_type, severity
ORDER BY
  CASE severity WHEN 'critical' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END,
  gap_type
