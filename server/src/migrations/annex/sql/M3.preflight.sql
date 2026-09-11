-- M3 preflight is read-only. The first result set must be empty before apply.
-- Missing or ambiguous historical attribution is not a preflight blocker: M3
-- preserves it as NULL and records it for review instead of guessing a context.
SELECT severity, issue_code, resource_type, resource_id, issue_count
FROM (
  SELECT
    'BLOCKER' AS severity,
    'M3_DATABASE_NOT_SELECTED' AS issue_code,
    'database' AS resource_type,
    NULL AS resource_id,
    1 AS issue_count
  WHERE DATABASE() IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_MYSQL_VERSION_UNSUPPORTED',
    'database',
    VERSION(),
    1
  WHERE LOWER(VERSION()) LIKE '%mariadb%'
     OR CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED) < 8
     OR (
       CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED) = 8
       AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 2), '.', -1) AS UNSIGNED) = 0
       AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 3), '.', -1) AS UNSIGNED) < 16
     )

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_BASE_TABLE_MISSING',
    'table',
    required.table_name,
    1
  FROM (
    SELECT 'operating_contexts' AS table_name
    UNION ALL SELECT 'membership_operating_contexts'
    UNION ALL SELECT 'shipment_cases'
    UNION ALL SELECT 'platform_contracts'
    UNION ALL SELECT 'rfq_books'
    UNION ALL SELECT 'rfq_quotes'
    UNION ALL SELECT 'vehicles'
    UNION ALL SELECT 'carrier_driver_assignments'
    UNION ALL SELECT 'driver_internal_bids'
    UNION ALL SELECT 'trip_cases'
    UNION ALL SELECT 'driver_trip_acceptances'
    UNION ALL SELECT 'driver_delivery_otps'
    UNION ALL SELECT 'platform_trip_events'
    UNION ALL SELECT 'platform_documents'
    UNION ALL SELECT 'pod_cases'
    UNION ALL SELECT 'pod_evidence_versions'
    UNION ALL SELECT 'trip_loading_evidence'
    UNION ALL SELECT 'trip_loading_schedules'
    UNION ALL SELECT 'relationship_ledgers'
    UNION ALL SELECT 'platform_claims'
    UNION ALL SELECT 'platform_exceptions'
    UNION ALL SELECT 'platform_domain_events'
    UNION ALL SELECT 'platform_notifications'
    UNION ALL SELECT 'platform_contact_reveals'
    UNION ALL SELECT 'platform_export_requests'
    UNION ALL SELECT 'platform_idempotency_keys'
    UNION ALL SELECT 'agent_assignments'
  ) AS required
  LEFT JOIN information_schema.tables t
    ON t.table_schema = DATABASE()
   AND t.table_name = required.table_name
  WHERE t.table_name IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_BASE_TABLE_ENGINE_UNSUPPORTED',
    'table',
    CONCAT(t.table_name, ':', COALESCE(t.engine, 'NULL')),
    1
  FROM information_schema.tables t
  WHERE t.table_schema = DATABASE()
    AND t.table_name IN (
      'operating_contexts', 'membership_operating_contexts',
      'shipment_cases', 'platform_contracts', 'rfq_books', 'rfq_quotes',
      'vehicles', 'carrier_driver_assignments', 'driver_internal_bids',
      'trip_cases', 'driver_trip_acceptances', 'driver_delivery_otps',
      'platform_trip_events', 'platform_documents', 'pod_cases',
      'pod_evidence_versions', 'trip_loading_evidence',
      'trip_loading_schedules', 'relationship_ledgers', 'platform_claims',
      'platform_exceptions', 'platform_domain_events',
      'platform_notifications', 'platform_contact_reveals',
      'platform_export_requests', 'platform_idempotency_keys',
      'agent_assignments'
    )
    AND COALESCE(t.engine, '') <> 'InnoDB'

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_BASE_COLUMN_MISSING',
    'column',
    CONCAT(required.table_name, '.', required.column_name),
    1
  FROM (
    SELECT 'operating_contexts' AS table_name, 'context_id' AS column_name
    UNION ALL SELECT 'operating_contexts', 'tenant_id'
    UNION ALL SELECT 'operating_contexts', 'organization_id'
    UNION ALL SELECT 'operating_contexts', 'context_type'
    UNION ALL SELECT 'membership_operating_contexts', 'tenant_id'
    UNION ALL SELECT 'membership_operating_contexts', 'user_id'
    UNION ALL SELECT 'membership_operating_contexts', 'organization_id'
    UNION ALL SELECT 'membership_operating_contexts', 'context_id'
    UNION ALL SELECT 'shipment_cases', 'id'
    UNION ALL SELECT 'shipment_cases', 'tenant_id'
    UNION ALL SELECT 'shipment_cases', 'x_org_id'
    UNION ALL SELECT 'shipment_cases', 'y_org_id'
    UNION ALL SELECT 'platform_contracts', 'id'
    UNION ALL SELECT 'platform_contracts', 'tenant_id'
    UNION ALL SELECT 'platform_contracts', 'x_org_id'
    UNION ALL SELECT 'rfq_books', 'id'
    UNION ALL SELECT 'rfq_books', 'tenant_id'
    UNION ALL SELECT 'rfq_books', 'level'
    UNION ALL SELECT 'rfq_books', 'publisher_org_id'
    UNION ALL SELECT 'rfq_quotes', 'id'
    UNION ALL SELECT 'rfq_quotes', 'tenant_id'
    UNION ALL SELECT 'rfq_quotes', 'rfq_id'
    UNION ALL SELECT 'rfq_quotes', 'bidder_org_id'
    UNION ALL SELECT 'vehicles', 'id'
    UNION ALL SELECT 'vehicles', 'tenant_id'
    UNION ALL SELECT 'vehicles', 'owner_org_id'
    UNION ALL SELECT 'carrier_driver_assignments', 'id'
    UNION ALL SELECT 'carrier_driver_assignments', 'tenant_id'
    UNION ALL SELECT 'carrier_driver_assignments', 'y_org_id'
    UNION ALL SELECT 'driver_internal_bids', 'id'
    UNION ALL SELECT 'driver_internal_bids', 'tenant_id'
    UNION ALL SELECT 'driver_internal_bids', 'y_org_id'
    UNION ALL SELECT 'trip_cases', 'id'
    UNION ALL SELECT 'trip_cases', 'tenant_id'
    UNION ALL SELECT 'trip_cases', 'x_org_id'
    UNION ALL SELECT 'trip_cases', 'y_org_id'
    UNION ALL SELECT 'driver_trip_acceptances', 'id'
    UNION ALL SELECT 'driver_trip_acceptances', 'tenant_id'
    UNION ALL SELECT 'driver_trip_acceptances', 'trip_id'
    UNION ALL SELECT 'driver_delivery_otps', 'id'
    UNION ALL SELECT 'driver_delivery_otps', 'tenant_id'
    UNION ALL SELECT 'driver_delivery_otps', 'trip_id'
    UNION ALL SELECT 'platform_trip_events', 'id'
    UNION ALL SELECT 'platform_trip_events', 'tenant_id'
    UNION ALL SELECT 'platform_trip_events', 'trip_id'
    UNION ALL SELECT 'platform_trip_events', 'actor_user_id'
    UNION ALL SELECT 'platform_documents', 'id'
    UNION ALL SELECT 'platform_documents', 'tenant_id'
    UNION ALL SELECT 'platform_documents', 'owner_org_id'
    UNION ALL SELECT 'pod_cases', 'id'
    UNION ALL SELECT 'pod_cases', 'tenant_id'
    UNION ALL SELECT 'pod_cases', 'trip_id'
    UNION ALL SELECT 'pod_evidence_versions', 'id'
    UNION ALL SELECT 'pod_evidence_versions', 'tenant_id'
    UNION ALL SELECT 'pod_evidence_versions', 'pod_id'
    UNION ALL SELECT 'trip_loading_evidence', 'id'
    UNION ALL SELECT 'trip_loading_evidence', 'tenant_id'
    UNION ALL SELECT 'trip_loading_evidence', 'trip_id'
    UNION ALL SELECT 'trip_loading_evidence', 'owner_org_id'
    UNION ALL SELECT 'trip_loading_schedules', 'id'
    UNION ALL SELECT 'trip_loading_schedules', 'tenant_id'
    UNION ALL SELECT 'trip_loading_schedules', 'trip_id'
    UNION ALL SELECT 'trip_loading_schedules', 'created_by_user_id'
    UNION ALL SELECT 'relationship_ledgers', 'id'
    UNION ALL SELECT 'relationship_ledgers', 'tenant_id'
    UNION ALL SELECT 'relationship_ledgers', 'relationship_type'
    UNION ALL SELECT 'relationship_ledgers', 'payer_org_id'
    UNION ALL SELECT 'relationship_ledgers', 'payee_org_id'
    UNION ALL SELECT 'platform_claims', 'id'
    UNION ALL SELECT 'platform_claims', 'tenant_id'
    UNION ALL SELECT 'platform_claims', 'opened_by_user_id'
    UNION ALL SELECT 'platform_claims', 'opened_by_org_id'
    UNION ALL SELECT 'platform_exceptions', 'id'
    UNION ALL SELECT 'platform_exceptions', 'tenant_id'
    UNION ALL SELECT 'platform_exceptions', 'opened_by_user_id'
    UNION ALL SELECT 'platform_exceptions', 'opened_by_org_id'
    UNION ALL SELECT 'platform_domain_events', 'id'
    UNION ALL SELECT 'platform_domain_events', 'tenant_id'
    UNION ALL SELECT 'platform_domain_events', 'actor_user_id'
    UNION ALL SELECT 'platform_notifications', 'id'
    UNION ALL SELECT 'platform_notifications', 'tenant_id'
    UNION ALL SELECT 'platform_notifications', 'recipient_org_id'
    UNION ALL SELECT 'platform_notifications', 'recipient_user_id'
    UNION ALL SELECT 'platform_contact_reveals', 'id'
    UNION ALL SELECT 'platform_contact_reveals', 'tenant_id'
    UNION ALL SELECT 'platform_contact_reveals', 'actor_user_id'
    UNION ALL SELECT 'platform_contact_reveals', 'organization_id'
    UNION ALL SELECT 'platform_export_requests', 'id'
    UNION ALL SELECT 'platform_export_requests', 'tenant_id'
    UNION ALL SELECT 'platform_export_requests', 'requested_by_user_id'
    UNION ALL SELECT 'platform_export_requests', 'organization_id'
    UNION ALL SELECT 'platform_idempotency_keys', 'id'
    UNION ALL SELECT 'platform_idempotency_keys', 'tenant_id'
    UNION ALL SELECT 'platform_idempotency_keys', 'actor_user_id'
    UNION ALL SELECT 'agent_assignments', 'id'
    UNION ALL SELECT 'agent_assignments', 'tenant_id'
    UNION ALL SELECT 'agent_assignments', 'trip_id'
    UNION ALL SELECT 'agent_assignments', 'assigned_by_org_id'
  ) AS required
  LEFT JOIN information_schema.columns c
    ON c.table_schema = DATABASE()
   AND c.table_name = required.table_name
   AND c.column_name = required.column_name
  WHERE c.column_name IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_DEPENDENCY_INDEX_MISSING',
    'index',
    CONCAT(required.table_name, '.', required.index_name),
    1
  FROM (
    SELECT 'operating_contexts' AS table_name, 'uq_operating_context_org_type' AS index_name
    UNION ALL SELECT 'operating_contexts', 'uq_operating_context_scope'
    UNION ALL SELECT 'membership_operating_contexts', 'PRIMARY'
  ) AS required
  LEFT JOIN information_schema.statistics s
    ON s.table_schema = DATABASE()
   AND s.table_name = required.table_name
   AND s.index_name = required.index_name
  WHERE s.index_name IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_EXISTING_CONTEXT_COLUMN_INCOMPATIBLE',
    'column',
    CONCAT(c.table_name, '.', c.column_name, ':', c.column_type, ':', c.is_nullable),
    1
  FROM information_schema.columns c
  JOIN (
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
  ) AS expected
    ON expected.table_name = c.table_name
   AND expected.column_name = c.column_name
  WHERE c.table_schema = DATABASE()
    AND (LOWER(c.column_type) <> 'varchar(128)' OR c.is_nullable <> 'YES')

  UNION ALL

  SELECT
    'BLOCKER',
    'M3_CONTROL_TABLE_COLUMN_INCOMPATIBLE',
    'column',
    CONCAT(c.table_name, '.', c.column_name, ':', c.column_type, ':', c.is_nullable),
    1
  FROM information_schema.columns c
  JOIN (
    SELECT 'annex_m3_backfill_targets' AS table_name, 'target_table' AS column_name, 'varchar(64)' AS column_type, 'NO' AS is_nullable
    UNION ALL SELECT 'annex_m3_backfill_targets', 'target_column', 'varchar(64)', 'NO'
    UNION ALL SELECT 'annex_m3_backfill_targets', 'artifact_revision', 'varchar(64)', 'NO'
    UNION ALL SELECT 'annex_m3_backfill_checkpoints', 'target_table', 'varchar(64)', 'NO'
    UNION ALL SELECT 'annex_m3_backfill_checkpoints', 'target_column', 'varchar(64)', 'NO'
    UNION ALL SELECT 'annex_m3_backfill_checkpoints', 'snapshot_max_id', 'bigint unsigned', 'NO'
    UNION ALL SELECT 'annex_m3_backfill_checkpoints', 'last_scanned_id', 'bigint unsigned', 'NO'
    UNION ALL SELECT 'annex_m3_backfill_checkpoints', 'status', 'varchar(16)', 'NO'
    UNION ALL SELECT 'annex_m3_context_attributions', 'target_table', 'varchar(64)', 'NO'
    UNION ALL SELECT 'annex_m3_context_attributions', 'target_column', 'varchar(64)', 'NO'
    UNION ALL SELECT 'annex_m3_context_attributions', 'target_id', 'bigint unsigned', 'NO'
    UNION ALL SELECT 'annex_m3_context_attributions', 'disposition', 'varchar(24)', 'NO'
    UNION ALL SELECT 'annex_m3_context_attributions', 'resolved_context_id', 'varchar(128)', 'YES'
  ) AS expected
    ON expected.table_name = c.table_name
   AND expected.column_name = c.column_name
  WHERE c.table_schema = DATABASE()
    AND (LOWER(c.column_type) <> expected.column_type OR c.is_nullable <> expected.is_nullable)
) AS issues
ORDER BY issue_code, resource_type, resource_id;

-- Read-only sizing output. Counts are intentionally per target field because a
-- row may carry separate FWD and CAR contexts. Attribution is computed by M3.
SELECT target_table, target_column, source_rows, snapshot_max_id
FROM (
  SELECT 'shipment_cases' AS target_table, 'forwarder_context_id' AS target_column, COUNT(*) AS source_rows, COALESCE(MAX(id), 0) AS snapshot_max_id FROM shipment_cases
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
) AS inventory
ORDER BY target_table, target_column;
