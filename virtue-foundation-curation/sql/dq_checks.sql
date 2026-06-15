-- Data quality checks for the dais_2026.hackathon model.
-- Authoritative metrics live in dq_metrics; actionable issues in dq_gap.

SELECT metric_key, metric_group, metric_label, actual_value, expected_value, unit, severity, status
FROM dais_2026.hackathon.dq_metrics
ORDER BY metric_group, metric_key;

SELECT gap_type, severity, status, COUNT(*) AS gap_count
FROM dais_2026.hackathon.dq_gap
GROUP BY gap_type, severity, status
ORDER BY gap_type, status;
