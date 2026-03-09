-- Endpoint latency percentiles from performance_metrics
SELECT
  endpoint,
  count(*) AS sample_count,
  round(avg(response_time_ms)::numeric, 2) AS avg_ms,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)::numeric, 2) AS p95_ms,
  round(percentile_cont(0.99) WITHIN GROUP (ORDER BY response_time_ms)::numeric, 2) AS p99_ms,
  max(response_time_ms) AS max_ms
FROM performance_metrics
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY endpoint
ORDER BY p95_ms DESC, sample_count DESC;

-- Example query-plan checks (run in staging with realistic data)
EXPLAIN (ANALYZE, BUFFERS)
SELECT 1
FROM payments
WHERE status = 'rejected_fraud'
  AND uploaded_sha256 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS)
SELECT
  pf.payment_id,
  bit_count((pf.image_phash_bits # CAST('0000000000000000000000000000000000000000000000000000000000000000' AS bit(64)))) AS hamming_distance
FROM payment_files pf
WHERE pf.image_phash_bits IS NOT NULL
ORDER BY hamming_distance ASC
LIMIT 64;
