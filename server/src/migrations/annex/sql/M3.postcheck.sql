-- M3 postcheck is read-only. The first result set must be empty.
-- MISSING and AMBIGUOUS attribution rows are reported separately and remain
-- NULL by design; M4 must not proceed until its stricter preconditions are met.
WITH
expected_columns AS (
  SELECT 'shipment_cases' AS table_name, 'forwarder_context_id' AS column_name
  UNION ALL SELECT 'shipment_cases', 'carrier_context_id'
  UNION ALL SELECT 'platform_contracts', 'forwarder_context_id'
  UNION ALL SELECT 'rfq_books', 'publisher_context_id'
  UNION ALL SELECT 'rfq_quotes', 'bidder_context_id'
  UNION ALL SELECT 'vehicles', 'carrier_context_id'
  UNION ALL SELECT 'carrier_driver_assignments', 'carrier_context_id'
  UNION ALL SELECT 'driver_internal_bids', 'carrier_context_id'
  UNION ALL SELECT 'trip_cases', 'forwarder_context_id'
  UNION ALL SELECT 'trip_cases', 'carrier_context_id'
  UNION ALL SELECT 'driver_trip_acceptances', 'carrier_context_id'
  UNION ALL SELECT 'driver_delivery_otps', 'carrier_context_id'
  UNION ALL SELECT 'platform_trip_events', 'actor_context_id'
  UNION ALL SELECT 'platform_documents', 'owner_context_id'
  UNION ALL SELECT 'pod_cases', 'carrier_context_id'
  UNION ALL SELECT 'pod_evidence_versions', 'carrier_context_id'
  UNION ALL SELECT 'trip_loading_evidence', 'owner_context_id'
  UNION ALL SELECT 'trip_loading_schedules', 'created_in_context_id'
  UNION ALL SELECT 'relationship_ledgers', 'payer_context_id'
  UNION ALL SELECT 'relationship_ledgers', 'payee_context_id'
  UNION ALL SELECT 'platform_claims', 'opened_in_context_id'
  UNION ALL SELECT 'platform_exceptions', 'opened_in_context_id'
  UNION ALL SELECT 'platform_domain_events', 'actor_context_id'
  UNION ALL SELECT 'platform_notifications', 'recipient_context_id'
  UNION ALL SELECT 'platform_contact_reveals', 'actor_context_id'
  UNION ALL SELECT 'platform_export_requests', 'requested_in_context_id'
  UNION ALL SELECT 'platform_idempotency_keys', 'operating_context_id'
  UNION ALL SELECT 'agent_assignments', 'authorizing_context_id'
),
expected_indexes AS (
  SELECT 'operating_contexts' AS table_name, 'uq_operating_context_tenant_context' AS index_name
  UNION ALL SELECT 'shipment_cases', 'idx_m3_shipment_fwd_ctx'
  UNION ALL SELECT 'shipment_cases', 'idx_m3_shipment_car_ctx'
  UNION ALL SELECT 'platform_contracts', 'idx_m3_contract_fwd_ctx'
  UNION ALL SELECT 'rfq_books', 'idx_m3_rfq_publisher_ctx'
  UNION ALL SELECT 'rfq_quotes', 'idx_m3_quote_bidder_ctx'
  UNION ALL SELECT 'vehicles', 'idx_m3_vehicle_car_ctx'
  UNION ALL SELECT 'carrier_driver_assignments', 'idx_m3_coverage_car_ctx'
  UNION ALL SELECT 'driver_internal_bids', 'idx_m3_driver_bid_car_ctx'
  UNION ALL SELECT 'trip_cases', 'idx_m3_trip_fwd_ctx'
  UNION ALL SELECT 'trip_cases', 'idx_m3_trip_car_ctx'
  UNION ALL SELECT 'driver_trip_acceptances', 'idx_m3_acceptance_car_ctx'
  UNION ALL SELECT 'driver_delivery_otps', 'idx_m3_driver_otp_car_ctx'
  UNION ALL SELECT 'platform_trip_events', 'idx_m3_trip_event_actor_ctx'
  UNION ALL SELECT 'platform_documents', 'idx_m3_document_owner_ctx'
  UNION ALL SELECT 'pod_cases', 'idx_m3_pod_car_ctx'
  UNION ALL SELECT 'pod_evidence_versions', 'idx_m3_pod_evidence_car_ctx'
  UNION ALL SELECT 'trip_loading_evidence', 'idx_m3_loading_owner_ctx'
  UNION ALL SELECT 'trip_loading_schedules', 'idx_m3_schedule_creator_ctx'
  UNION ALL SELECT 'relationship_ledgers', 'idx_m3_ledger_payer_ctx'
  UNION ALL SELECT 'relationship_ledgers', 'idx_m3_ledger_payee_ctx'
  UNION ALL SELECT 'platform_claims', 'idx_m3_claim_opened_ctx'
  UNION ALL SELECT 'platform_exceptions', 'idx_m3_exception_opened_ctx'
  UNION ALL SELECT 'platform_domain_events', 'idx_m3_domain_event_actor_ctx'
  UNION ALL SELECT 'platform_notifications', 'idx_m3_notification_recipient_ctx'
  UNION ALL SELECT 'platform_contact_reveals', 'idx_m3_reveal_actor_ctx'
  UNION ALL SELECT 'platform_export_requests', 'idx_m3_export_request_ctx'
  UNION ALL SELECT 'platform_idempotency_keys', 'idx_m3_idempotency_ctx'
  UNION ALL SELECT 'agent_assignments', 'idx_m3_agent_authorizer_ctx'
),
expected_constraints AS (
  SELECT 'annex_m3_context_attributions' AS table_name, 'fk_m3_attribution_context' AS constraint_name
  UNION ALL SELECT 'shipment_cases', 'fk_m3_shipment_fwd_context'
  UNION ALL SELECT 'shipment_cases', 'fk_m3_shipment_car_context'
  UNION ALL SELECT 'platform_contracts', 'fk_m3_contract_fwd_context'
  UNION ALL SELECT 'rfq_books', 'fk_m3_rfq_publisher_context'
  UNION ALL SELECT 'rfq_quotes', 'fk_m3_quote_bidder_context'
  UNION ALL SELECT 'vehicles', 'fk_m3_vehicle_car_context'
  UNION ALL SELECT 'carrier_driver_assignments', 'fk_m3_coverage_car_context'
  UNION ALL SELECT 'driver_internal_bids', 'fk_m3_driver_bid_car_context'
  UNION ALL SELECT 'trip_cases', 'fk_m3_trip_fwd_context'
  UNION ALL SELECT 'trip_cases', 'fk_m3_trip_car_context'
  UNION ALL SELECT 'driver_trip_acceptances', 'fk_m3_acceptance_car_context'
  UNION ALL SELECT 'driver_delivery_otps', 'fk_m3_driver_otp_car_context'
  UNION ALL SELECT 'platform_trip_events', 'fk_m3_trip_event_actor_context'
  UNION ALL SELECT 'platform_documents', 'fk_m3_document_owner_context'
  UNION ALL SELECT 'pod_cases', 'fk_m3_pod_car_context'
  UNION ALL SELECT 'pod_evidence_versions', 'fk_m3_pod_evidence_car_context'
  UNION ALL SELECT 'trip_loading_evidence', 'fk_m3_loading_owner_context'
  UNION ALL SELECT 'trip_loading_schedules', 'fk_m3_schedule_creator_context'
  UNION ALL SELECT 'relationship_ledgers', 'fk_m3_ledger_payer_context'
  UNION ALL SELECT 'relationship_ledgers', 'fk_m3_ledger_payee_context'
  UNION ALL SELECT 'platform_claims', 'fk_m3_claim_opened_context'
  UNION ALL SELECT 'platform_exceptions', 'fk_m3_exception_opened_context'
  UNION ALL SELECT 'platform_domain_events', 'fk_m3_domain_event_actor_context'
  UNION ALL SELECT 'platform_notifications', 'fk_m3_notification_recipient_context'
  UNION ALL SELECT 'platform_contact_reveals', 'fk_m3_reveal_actor_context'
  UNION ALL SELECT 'platform_export_requests', 'fk_m3_export_request_context'
  UNION ALL SELECT 'platform_idempotency_keys', 'fk_m3_idempotency_context'
  UNION ALL SELECT 'agent_assignments', 'fk_m3_agent_authorizer_context'
),
source_counts AS (
  SELECT 'shipment_cases' AS target_table, 'forwarder_context_id' AS target_column, COUNT(*) AS source_count, COALESCE(MAX(id), 0) AS current_max_id FROM shipment_cases
  UNION ALL SELECT 'shipment_cases', 'carrier_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM shipment_cases
  UNION ALL SELECT 'platform_contracts', 'forwarder_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM platform_contracts
  UNION ALL SELECT 'rfq_books', 'publisher_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM rfq_books
  UNION ALL SELECT 'rfq_quotes', 'bidder_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM rfq_quotes
  UNION ALL SELECT 'vehicles', 'carrier_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM vehicles
  UNION ALL SELECT 'carrier_driver_assignments', 'carrier_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM carrier_driver_assignments
  UNION ALL SELECT 'driver_internal_bids', 'carrier_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM driver_internal_bids
  UNION ALL SELECT 'trip_cases', 'forwarder_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM trip_cases
  UNION ALL SELECT 'trip_cases', 'carrier_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM trip_cases
  UNION ALL SELECT 'driver_trip_acceptances', 'carrier_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM driver_trip_acceptances
  UNION ALL SELECT 'driver_delivery_otps', 'carrier_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM driver_delivery_otps
  UNION ALL SELECT 'platform_trip_events', 'actor_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM platform_trip_events
  UNION ALL SELECT 'platform_documents', 'owner_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM platform_documents
  UNION ALL SELECT 'pod_cases', 'carrier_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM pod_cases
  UNION ALL SELECT 'pod_evidence_versions', 'carrier_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM pod_evidence_versions
  UNION ALL SELECT 'trip_loading_evidence', 'owner_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM trip_loading_evidence
  UNION ALL SELECT 'trip_loading_schedules', 'created_in_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM trip_loading_schedules
  UNION ALL SELECT 'relationship_ledgers', 'payer_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM relationship_ledgers
  UNION ALL SELECT 'relationship_ledgers', 'payee_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM relationship_ledgers
  UNION ALL SELECT 'platform_claims', 'opened_in_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM platform_claims
  UNION ALL SELECT 'platform_exceptions', 'opened_in_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM platform_exceptions
  UNION ALL SELECT 'platform_domain_events', 'actor_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM platform_domain_events
  UNION ALL SELECT 'platform_notifications', 'recipient_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM platform_notifications
  UNION ALL SELECT 'platform_contact_reveals', 'actor_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM platform_contact_reveals
  UNION ALL SELECT 'platform_export_requests', 'requested_in_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM platform_export_requests
  UNION ALL SELECT 'platform_idempotency_keys', 'operating_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM platform_idempotency_keys
  UNION ALL SELECT 'agent_assignments', 'authorizing_context_id', COUNT(*), COALESCE(MAX(id), 0) FROM agent_assignments
),
attribution_counts AS (
  SELECT target_table, target_column,
         COUNT(*) AS attribution_count,
         COALESCE(SUM(disposition = 'RESOLVED'), 0) AS resolved_count,
         COALESCE(SUM(disposition = 'MISSING'), 0) AS missing_count,
         COALESCE(SUM(disposition = 'AMBIGUOUS'), 0) AS ambiguous_count,
         COALESCE(SUM(disposition = 'NOT_APPLICABLE'), 0) AS not_applicable_count
  FROM annex_m3_context_attributions
  GROUP BY target_table, target_column
)
SELECT severity, issue_code, resource_type, resource_id, issue_count
FROM (
  SELECT
    'BLOCKER' AS severity,
    'M3_CONTEXT_COLUMN_MISSING' AS issue_code,
    'column' AS resource_type,
    CONCAT(expected.table_name, '.', expected.column_name) AS resource_id,
    1 AS issue_count
  FROM expected_columns expected
  LEFT JOIN information_schema.columns c
    ON c.table_schema = DATABASE()
   AND c.table_name = expected.table_name
   AND c.column_name = expected.column_name
  WHERE c.column_name IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_CONTEXT_COLUMN_NOT_NULLABLE',
    'column',
    CONCAT(c.table_name, '.', c.column_name, ':', c.column_type, ':', c.is_nullable),
    1
  FROM information_schema.columns c
  JOIN expected_columns expected
    ON expected.table_name = c.table_name
   AND expected.column_name = c.column_name
  WHERE c.table_schema = DATABASE()
    AND (LOWER(c.column_type) <> 'varchar(128)' OR c.is_nullable <> 'YES')

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_INDEX_MISSING',
    'index',
    CONCAT(expected.table_name, '.', expected.index_name),
    1
  FROM expected_indexes expected
  LEFT JOIN information_schema.statistics s
    ON s.table_schema = DATABASE()
   AND s.table_name = expected.table_name
   AND s.index_name = expected.index_name
  WHERE s.index_name IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_FOREIGN_KEY_MISSING',
    'constraint',
    CONCAT(expected.table_name, '.', expected.constraint_name),
    1
  FROM expected_constraints expected
  LEFT JOIN information_schema.table_constraints tc
    ON tc.constraint_schema = DATABASE()
   AND tc.table_name = expected.table_name
   AND tc.constraint_name = expected.constraint_name
   AND tc.constraint_type = 'FOREIGN KEY'
  WHERE tc.constraint_name IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_TARGET_CATALOG_INVALID',
    'migration',
    'M3',
    ABS(28 - COUNT(*)) + COALESCE(SUM(artifact_revision <> 'structural-annex-v1:M3:1'), 0)
  FROM annex_m3_backfill_targets
  HAVING COUNT(*) <> 28
      OR COALESCE(SUM(artifact_revision <> 'structural-annex-v1:M3:1'), 0) <> 0

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_CHECKPOINT_MISSING',
    'target',
    CONCAT(t.target_table, '.', t.target_column),
    1
  FROM annex_m3_backfill_targets t
  LEFT JOIN annex_m3_backfill_checkpoints cp
    ON cp.target_table = t.target_table
   AND cp.target_column = t.target_column
  WHERE cp.target_table IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_BACKFILL_INCOMPLETE',
    'target',
    CONCAT(cp.target_table, '.', cp.target_column),
    1
  FROM annex_m3_backfill_checkpoints cp
  WHERE cp.status <> 'COMPLETE'
     OR cp.last_scanned_id < cp.snapshot_max_id
     OR cp.artifact_revision <> 'structural-annex-v1:M3:1'

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_SOURCE_ROWS_UNACCOUNTED',
    'target',
    CONCAT(sc.target_table, '.', sc.target_column),
    ABS(sc.source_count - COALESCE(ac.attribution_count, 0))
  FROM source_counts sc
  LEFT JOIN attribution_counts ac
    ON ac.target_table = sc.target_table
   AND ac.target_column = sc.target_column
  LEFT JOIN annex_m3_backfill_checkpoints cp
    ON cp.target_table = sc.target_table
   AND cp.target_column = sc.target_column
  WHERE sc.source_count <> COALESCE(ac.attribution_count, 0)
     OR sc.source_count <> COALESCE(cp.scanned_count, 0)
     OR sc.current_max_id <> COALESCE(cp.snapshot_max_id, 0)

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_CHECKPOINT_COUNTER_MISMATCH',
    'target',
    CONCAT(cp.target_table, '.', cp.target_column),
    1
  FROM annex_m3_backfill_checkpoints cp
  LEFT JOIN attribution_counts ac
    ON ac.target_table = cp.target_table
   AND ac.target_column = cp.target_column
  WHERE cp.scanned_count <> COALESCE(ac.attribution_count, 0)
     OR cp.resolved_count <> COALESCE(ac.resolved_count, 0)
     OR cp.missing_count <> COALESCE(ac.missing_count, 0)
     OR cp.ambiguous_count <> COALESCE(ac.ambiguous_count, 0)
     OR cp.not_applicable_count <> COALESCE(ac.not_applicable_count, 0)

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_RESOLVED_CONTEXT_NOT_APPLIED',
    'row',
    CONCAT(a.target_table, '.', a.target_column, ':', a.target_id),
    1
  FROM annex_m3_context_attributions a
  WHERE a.disposition = 'RESOLVED'
    AND (a.resolved_context_id IS NULL OR a.applied_at IS NULL)

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_UNRESOLVED_CONTEXT_PREEXISTED',
    'row',
    CONCAT(a.target_table, '.', a.target_column, ':', a.target_id),
    1
  FROM annex_m3_context_attributions a
  WHERE a.disposition IN ('MISSING', 'AMBIGUOUS', 'NOT_APPLICABLE')
    AND a.existing_context_id IS NOT NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_RESOLVED_CONTEXT_INVALID',
    'row',
    CONCAT(a.target_table, '.', a.target_column, ':', a.target_id),
    1
  FROM annex_m3_context_attributions a
  LEFT JOIN operating_contexts c
    ON c.tenant_id = a.tenant_id
   AND c.context_id = a.resolved_context_id
  WHERE a.disposition = 'RESOLVED'
    AND c.context_id IS NULL
) AS issues
ORDER BY issue_code, resource_type, resource_id;

-- Reconciliation summary: every source row appears exactly once per target.
SELECT
  t.target_table,
  t.target_column,
  t.source_strategy,
  t.source_reference,
  t.expected_context_type,
  cp.snapshot_max_id,
  cp.last_scanned_id,
  cp.scanned_count,
  cp.resolved_count,
  cp.missing_count,
  cp.ambiguous_count,
  cp.not_applicable_count,
  cp.status
FROM annex_m3_backfill_targets t
JOIN annex_m3_backfill_checkpoints cp
  ON cp.target_table = t.target_table
 AND cp.target_column = t.target_column
ORDER BY t.target_table, t.target_column;

-- Full review queue. It intentionally contains identifiers and reason codes,
-- never document payloads, quote amounts, secrets, or raw evidence.
SELECT
  'REVIEW_REQUIRED' AS severity,
  a.target_table,
  a.target_column,
  a.target_id,
  a.tenant_id,
  a.source_organization_id,
  a.candidate_count,
  a.disposition,
  a.reason_code
FROM annex_m3_context_attributions a
WHERE a.disposition IN ('MISSING', 'AMBIGUOUS')
ORDER BY a.target_table, a.target_column, a.target_id;

-- Explicit non-applicable rows are separate from unresolved rows so M4 can
-- define which resource types genuinely require an operating context.
SELECT
  a.target_table,
  a.target_column,
  a.reason_code,
  COUNT(*) AS row_count
FROM annex_m3_context_attributions a
WHERE a.disposition = 'NOT_APPLICABLE'
GROUP BY a.target_table, a.target_column, a.reason_code
ORDER BY a.target_table, a.target_column, a.reason_code;
