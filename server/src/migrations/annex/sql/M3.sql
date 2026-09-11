-- M3 adds nullable context relationships only. It does not enforce request
-- context, change endpoint behavior, or make any context column mandatory.
-- The exact source is checksum-pinned by manifest.js. Re-entry is supported by
-- conditional DDL and per-target, per-batch checkpoints.

CREATE TABLE IF NOT EXISTS annex_m3_backfill_targets (
  target_table VARCHAR(64) NOT NULL,
  target_column VARCHAR(64) NOT NULL,
  source_strategy VARCHAR(48) NOT NULL,
  source_reference VARCHAR(255) NOT NULL,
  expected_context_type VARCHAR(16) NOT NULL,
  missing_reason VARCHAR(80) NOT NULL,
  ambiguous_reason VARCHAR(80) NOT NULL,
  query_evidence VARCHAR(255) NOT NULL,
  artifact_revision VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_table, target_column),
  CONSTRAINT chk_m3_target_expected_type
    CHECK (expected_context_type IN ('FWD', 'CAR', 'DYNAMIC', 'OPTIONAL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS annex_m3_backfill_checkpoints (
  target_table VARCHAR(64) NOT NULL,
  target_column VARCHAR(64) NOT NULL,
  snapshot_max_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_scanned_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  scanned_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  resolved_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  missing_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ambiguous_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  not_applicable_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  artifact_revision VARCHAR(64) NOT NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (target_table, target_column),
  CONSTRAINT fk_m3_checkpoint_target
    FOREIGN KEY (target_table, target_column)
    REFERENCES annex_m3_backfill_targets (target_table, target_column)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_m3_checkpoint_status
    CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETE')),
  CONSTRAINT chk_m3_checkpoint_range
    CHECK (last_scanned_id <= snapshot_max_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS annex_m3_context_attributions (
  target_table VARCHAR(64) NOT NULL,
  target_column VARCHAR(64) NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  source_organization_id VARCHAR(128) NULL,
  candidate_count INT UNSIGNED NOT NULL,
  disposition VARCHAR(24) NOT NULL,
  reason_code VARCHAR(80) NOT NULL,
  existing_context_id VARCHAR(128) NULL,
  resolved_context_id VARCHAR(128) NULL,
  applied_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (target_table, target_column, target_id),
  KEY idx_m3_attribution_review
    (disposition, target_table, target_column, target_id),
  KEY idx_m3_attribution_context
    (tenant_id, resolved_context_id),
  CONSTRAINT fk_m3_attribution_target
    FOREIGN KEY (target_table, target_column)
    REFERENCES annex_m3_backfill_targets (target_table, target_column)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_m3_attribution_disposition
    CHECK (disposition IN ('RESOLVED', 'MISSING', 'AMBIGUOUS', 'NOT_APPLICABLE')),
  CONSTRAINT chk_m3_attribution_resolution
    CHECK (
      (disposition = 'RESOLVED' AND candidate_count = 1 AND resolved_context_id IS NOT NULL)
      OR
      (disposition <> 'RESOLVED' AND resolved_context_id IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO annex_m3_backfill_targets
  (target_table, target_column, source_strategy, source_reference,
   expected_context_type, missing_reason, ambiguous_reason, query_evidence,
   artifact_revision)
VALUES
  ('shipment_cases', 'forwarder_context_id', 'ROLE_ORG', 'shipment_cases.x_org_id', 'FWD', 'MISSING_X_OR_FWD_CONTEXT', 'MULTIPLE_FWD_CONTEXTS', 'platform.routes.js case and RFQ award reads', 'structural-annex-v1:M3:1'),
  ('shipment_cases', 'carrier_context_id', 'ROLE_ORG', 'shipment_cases.y_org_id', 'CAR', 'MISSING_Y_OR_CAR_CONTEXT', 'MULTIPLE_CAR_CONTEXTS', 'platform.routes.js case and trip reads', 'structural-annex-v1:M3:1'),
  ('platform_contracts', 'forwarder_context_id', 'ROLE_ORG', 'platform_contracts.x_org_id', 'FWD', 'MISSING_X_OR_FWD_CONTEXT', 'MULTIPLE_FWD_CONTEXTS', 'platform.routes.js customer_x contract writes', 'structural-annex-v1:M3:1'),
  ('rfq_books', 'publisher_context_id', 'RFQ_LEVEL', 'rfq_books.level + publisher_org_id', 'DYNAMIC', 'MISSING_RFQ_PUBLISHER_CONTEXT', 'UNSUPPORTED_OR_AMBIGUOUS_RFQ_LEVEL', 'platform.routes.js RFQ1/RFQ2 publication', 'structural-annex-v1:M3:1'),
  ('rfq_quotes', 'bidder_context_id', 'RFQ_PARENT_LEVEL', 'rfq_quotes.rfq_id -> rfq_books.level + bidder_org_id', 'DYNAMIC', 'MISSING_RFQ_PARENT_OR_BIDDER_CONTEXT', 'UNSUPPORTED_OR_AMBIGUOUS_RFQ_LEVEL', 'platform.routes.js quote role selection by RFQ level', 'structural-annex-v1:M3:1'),
  ('vehicles', 'carrier_context_id', 'ROLE_ORG', 'vehicles.owner_org_id when organization-owned', 'CAR', 'MISSING_OWNER_CAR_CONTEXT', 'MULTIPLE_CAR_CONTEXTS', 'platform.routes.js carrier network and vehicle writes', 'structural-annex-v1:M3:1'),
  ('carrier_driver_assignments', 'carrier_context_id', 'ROLE_ORG', 'carrier_driver_assignments.y_org_id', 'CAR', 'MISSING_Y_OR_CAR_CONTEXT', 'MULTIPLE_CAR_CONTEXTS', 'platform.routes.js carrier coverage queries', 'structural-annex-v1:M3:1'),
  ('driver_internal_bids', 'carrier_context_id', 'ROLE_ORG', 'driver_internal_bids.y_org_id', 'CAR', 'MISSING_Y_OR_CAR_CONTEXT', 'MULTIPLE_CAR_CONTEXTS', 'platform.routes.js driver internal bid queries', 'structural-annex-v1:M3:1'),
  ('trip_cases', 'forwarder_context_id', 'ROLE_ORG', 'trip_cases.x_org_id', 'FWD', 'MISSING_X_OR_FWD_CONTEXT', 'MULTIPLE_FWD_CONTEXTS', 'platform.routes.js trip party scope', 'structural-annex-v1:M3:1'),
  ('trip_cases', 'carrier_context_id', 'ROLE_ORG', 'trip_cases.y_org_id', 'CAR', 'MISSING_Y_OR_CAR_CONTEXT', 'MULTIPLE_CAR_CONTEXTS', 'platform.routes.js trip party scope', 'structural-annex-v1:M3:1'),
  ('driver_trip_acceptances', 'carrier_context_id', 'TRIP_CARRIER', 'driver_trip_acceptances.trip_id -> trip_cases.y_org_id', 'CAR', 'MISSING_TRIP_OR_CAR_CONTEXT', 'MULTIPLE_CAR_CONTEXTS', 'platform.routes.js driver trip acceptance', 'structural-annex-v1:M3:1'),
  ('driver_delivery_otps', 'carrier_context_id', 'TRIP_CARRIER', 'driver_delivery_otps.trip_id -> trip_cases.y_org_id', 'CAR', 'MISSING_TRIP_OR_CAR_CONTEXT', 'MULTIPLE_CAR_CONTEXTS', 'platform.routes.js driver delivery OTP', 'structural-annex-v1:M3:1'),
  ('platform_trip_events', 'actor_context_id', 'ACTOR_TRIP_PARTY', 'actor_user_id membership intersected with trip x/y', 'DYNAMIC', 'MISSING_ACTOR_TRIP_CONTEXT', 'MULTIPLE_ACTOR_TRIP_CONTEXTS', 'platform.routes.js trip event writes', 'structural-annex-v1:M3:1'),
  ('platform_documents', 'owner_context_id', 'UNIQUE_ORG_CONTEXT', 'platform_documents.owner_org_id', 'OPTIONAL', 'MISSING_OWNER_CONTEXT', 'MULTIPLE_OWNER_CONTEXTS', 'platform.routes.js document owner scope', 'structural-annex-v1:M3:1'),
  ('pod_cases', 'carrier_context_id', 'TRIP_CARRIER', 'pod_cases.trip_id -> trip_cases.y_org_id', 'CAR', 'MISSING_TRIP_OR_CAR_CONTEXT', 'MULTIPLE_CAR_CONTEXTS', 'platform.routes.js POD trip joins', 'structural-annex-v1:M3:1'),
  ('pod_evidence_versions', 'carrier_context_id', 'POD_TRIP_CARRIER', 'pod_id -> pod_cases.trip_id -> trip_cases.y_org_id', 'CAR', 'MISSING_POD_TRIP_OR_CAR_CONTEXT', 'MULTIPLE_CAR_CONTEXTS', 'platform.routes.js POD evidence history', 'structural-annex-v1:M3:1'),
  ('trip_loading_evidence', 'owner_context_id', 'OWNER_TRIP_PARTY', 'owner_org_id intersected with trip x/y', 'DYNAMIC', 'MISSING_OWNER_TRIP_CONTEXT', 'MULTIPLE_OWNER_TRIP_CONTEXTS', 'platform.routes.js loading evidence writes', 'structural-annex-v1:M3:1'),
  ('trip_loading_schedules', 'created_in_context_id', 'ACTOR_TRIP_PARTY', 'created_by_user_id membership intersected with trip x/y', 'DYNAMIC', 'MISSING_CREATOR_TRIP_CONTEXT', 'MULTIPLE_CREATOR_TRIP_CONTEXTS', 'platform.routes.js loading schedule writes', 'structural-annex-v1:M3:1'),
  ('relationship_ledgers', 'payer_context_id', 'RELATIONSHIP_PARTY', 'relationship_type + payer_org_id', 'DYNAMIC', 'MISSING_PAYER_CONTEXT', 'UNSUPPORTED_OR_AMBIGUOUS_RELATIONSHIP', 'platform.routes.js relationship settlement reads/writes', 'structural-annex-v1:M3:1'),
  ('relationship_ledgers', 'payee_context_id', 'RELATIONSHIP_PARTY', 'relationship_type + payee_org_id', 'DYNAMIC', 'MISSING_PAYEE_CONTEXT', 'UNSUPPORTED_OR_AMBIGUOUS_RELATIONSHIP', 'platform.routes.js relationship settlement reads/writes', 'structural-annex-v1:M3:1'),
  ('platform_claims', 'opened_in_context_id', 'ACTOR_ORG_MEMBERSHIP', 'opened_by_user_id + opened_by_org_id', 'OPTIONAL', 'MISSING_CLAIM_ACTOR_CONTEXT', 'MULTIPLE_CLAIM_ACTOR_CONTEXTS', 'platform.routes.js claim writes', 'structural-annex-v1:M3:1'),
  ('platform_exceptions', 'opened_in_context_id', 'ACTOR_ORG_MEMBERSHIP', 'opened_by_user_id + opened_by_org_id', 'OPTIONAL', 'MISSING_EXCEPTION_ACTOR_CONTEXT', 'MULTIPLE_EXCEPTION_ACTOR_CONTEXTS', 'platform.routes.js exception writes', 'structural-annex-v1:M3:1'),
  ('platform_domain_events', 'actor_context_id', 'ACTOR_MEMBERSHIP', 'platform_domain_events.actor_user_id', 'OPTIONAL', 'MISSING_EVENT_ACTOR_CONTEXT', 'MULTIPLE_EVENT_ACTOR_CONTEXTS', 'event helper and operating-context session repository', 'structural-annex-v1:M3:1'),
  ('platform_notifications', 'recipient_context_id', 'RECIPIENT_SCOPE', 'recipient_org_id and optional recipient_user_id', 'OPTIONAL', 'MISSING_RECIPIENT_CONTEXT', 'MULTIPLE_RECIPIENT_CONTEXTS', 'event helper and notification reads', 'structural-annex-v1:M3:1'),
  ('platform_contact_reveals', 'actor_context_id', 'ACTOR_ORG_MEMBERSHIP', 'actor_user_id + organization_id', 'OPTIONAL', 'MISSING_REVEAL_ACTOR_CONTEXT', 'MULTIPLE_REVEAL_ACTOR_CONTEXTS', 'platform.routes.js contact reveal writes', 'structural-annex-v1:M3:1'),
  ('platform_export_requests', 'requested_in_context_id', 'ACTOR_ORG_MEMBERSHIP', 'requested_by_user_id + organization_id', 'OPTIONAL', 'MISSING_EXPORT_ACTOR_CONTEXT', 'MULTIPLE_EXPORT_ACTOR_CONTEXTS', 'platform.routes.js export request writes', 'structural-annex-v1:M3:1'),
  ('platform_idempotency_keys', 'operating_context_id', 'ACTOR_MEMBERSHIP', 'platform_idempotency_keys.actor_user_id', 'OPTIONAL', 'MISSING_IDEMPOTENCY_ACTOR_CONTEXT', 'MULTIPLE_IDEMPOTENCY_ACTOR_CONTEXTS', 'platform/admin runWrite persistence', 'structural-annex-v1:M3:1'),
  ('agent_assignments', 'authorizing_context_id', 'AUTHORIZER_TRIP_PARTY', 'assigned_by_org_id intersected with trip x/y', 'DYNAMIC', 'MISSING_AUTHORIZER_TRIP_CONTEXT', 'MULTIPLE_AUTHORIZER_TRIP_CONTEXTS', 'platform.routes.js agent assignment writes', 'structural-annex-v1:M3:1');

DROP PROCEDURE IF EXISTS annex_m3_exec_ddl;
DELIMITER $$
CREATE PROCEDURE annex_m3_exec_ddl(
  IN p_object_kind VARCHAR(16),
  IN p_table_name VARCHAR(64),
  IN p_object_name VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  DECLARE v_exists INT DEFAULT 0;
  IF p_object_kind = 'COLUMN' THEN
    SELECT COUNT(*) INTO v_exists
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND column_name = p_object_name;
  ELSEIF p_object_kind = 'INDEX' THEN
    SELECT COUNT(DISTINCT index_name) INTO v_exists
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND index_name = p_object_name;
  ELSEIF p_object_kind = 'CONSTRAINT' THEN
    SELECT COUNT(*) INTO v_exists
    FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = p_table_name
      AND constraint_name = p_object_name;
  ELSE
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'M3 unsupported conditional DDL object kind';
  END IF;

  IF v_exists = 0 THEN
    SET @annex_m3_ddl = p_ddl;
    PREPARE annex_m3_ddl_statement FROM @annex_m3_ddl;
    EXECUTE annex_m3_ddl_statement;
    DEALLOCATE PREPARE annex_m3_ddl_statement;
  END IF;
END$$
DELIMITER ;

CALL annex_m3_exec_ddl('INDEX', 'operating_contexts', 'uq_operating_context_tenant_context',
  'ALTER TABLE operating_contexts ADD UNIQUE KEY uq_operating_context_tenant_context (tenant_id, context_id)');
CALL annex_m3_exec_ddl('CONSTRAINT', 'annex_m3_context_attributions', 'fk_m3_attribution_context',
  'ALTER TABLE annex_m3_context_attributions ADD CONSTRAINT fk_m3_attribution_context FOREIGN KEY (tenant_id, resolved_context_id) REFERENCES operating_contexts (tenant_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');

CALL annex_m3_exec_ddl('COLUMN', 'shipment_cases', 'forwarder_context_id', 'ALTER TABLE shipment_cases ADD COLUMN forwarder_context_id VARCHAR(128) NULL AFTER x_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'shipment_cases', 'carrier_context_id', 'ALTER TABLE shipment_cases ADD COLUMN carrier_context_id VARCHAR(128) NULL AFTER y_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'platform_contracts', 'forwarder_context_id', 'ALTER TABLE platform_contracts ADD COLUMN forwarder_context_id VARCHAR(128) NULL AFTER x_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'rfq_books', 'publisher_context_id', 'ALTER TABLE rfq_books ADD COLUMN publisher_context_id VARCHAR(128) NULL AFTER publisher_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'rfq_quotes', 'bidder_context_id', 'ALTER TABLE rfq_quotes ADD COLUMN bidder_context_id VARCHAR(128) NULL AFTER bidder_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'vehicles', 'carrier_context_id', 'ALTER TABLE vehicles ADD COLUMN carrier_context_id VARCHAR(128) NULL AFTER owner_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'carrier_driver_assignments', 'carrier_context_id', 'ALTER TABLE carrier_driver_assignments ADD COLUMN carrier_context_id VARCHAR(128) NULL AFTER y_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'driver_internal_bids', 'carrier_context_id', 'ALTER TABLE driver_internal_bids ADD COLUMN carrier_context_id VARCHAR(128) NULL AFTER y_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'trip_cases', 'forwarder_context_id', 'ALTER TABLE trip_cases ADD COLUMN forwarder_context_id VARCHAR(128) NULL AFTER x_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'trip_cases', 'carrier_context_id', 'ALTER TABLE trip_cases ADD COLUMN carrier_context_id VARCHAR(128) NULL AFTER y_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'driver_trip_acceptances', 'carrier_context_id', 'ALTER TABLE driver_trip_acceptances ADD COLUMN carrier_context_id VARCHAR(128) NULL AFTER trip_id');
CALL annex_m3_exec_ddl('COLUMN', 'driver_delivery_otps', 'carrier_context_id', 'ALTER TABLE driver_delivery_otps ADD COLUMN carrier_context_id VARCHAR(128) NULL AFTER trip_id');
CALL annex_m3_exec_ddl('COLUMN', 'platform_trip_events', 'actor_context_id', 'ALTER TABLE platform_trip_events ADD COLUMN actor_context_id VARCHAR(128) NULL AFTER actor_user_id');
CALL annex_m3_exec_ddl('COLUMN', 'platform_documents', 'owner_context_id', 'ALTER TABLE platform_documents ADD COLUMN owner_context_id VARCHAR(128) NULL AFTER owner_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'pod_cases', 'carrier_context_id', 'ALTER TABLE pod_cases ADD COLUMN carrier_context_id VARCHAR(128) NULL AFTER trip_id');
CALL annex_m3_exec_ddl('COLUMN', 'pod_evidence_versions', 'carrier_context_id', 'ALTER TABLE pod_evidence_versions ADD COLUMN carrier_context_id VARCHAR(128) NULL AFTER pod_id');
CALL annex_m3_exec_ddl('COLUMN', 'trip_loading_evidence', 'owner_context_id', 'ALTER TABLE trip_loading_evidence ADD COLUMN owner_context_id VARCHAR(128) NULL AFTER owner_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'trip_loading_schedules', 'created_in_context_id', 'ALTER TABLE trip_loading_schedules ADD COLUMN created_in_context_id VARCHAR(128) NULL AFTER created_by_user_id');
CALL annex_m3_exec_ddl('COLUMN', 'relationship_ledgers', 'payer_context_id', 'ALTER TABLE relationship_ledgers ADD COLUMN payer_context_id VARCHAR(128) NULL AFTER payer_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'relationship_ledgers', 'payee_context_id', 'ALTER TABLE relationship_ledgers ADD COLUMN payee_context_id VARCHAR(128) NULL AFTER payee_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'platform_claims', 'opened_in_context_id', 'ALTER TABLE platform_claims ADD COLUMN opened_in_context_id VARCHAR(128) NULL AFTER opened_by_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'platform_exceptions', 'opened_in_context_id', 'ALTER TABLE platform_exceptions ADD COLUMN opened_in_context_id VARCHAR(128) NULL AFTER opened_by_org_id');
CALL annex_m3_exec_ddl('COLUMN', 'platform_domain_events', 'actor_context_id', 'ALTER TABLE platform_domain_events ADD COLUMN actor_context_id VARCHAR(128) NULL AFTER actor_user_id');
CALL annex_m3_exec_ddl('COLUMN', 'platform_notifications', 'recipient_context_id', 'ALTER TABLE platform_notifications ADD COLUMN recipient_context_id VARCHAR(128) NULL AFTER recipient_user_id');
CALL annex_m3_exec_ddl('COLUMN', 'platform_contact_reveals', 'actor_context_id', 'ALTER TABLE platform_contact_reveals ADD COLUMN actor_context_id VARCHAR(128) NULL AFTER actor_user_id');
CALL annex_m3_exec_ddl('COLUMN', 'platform_export_requests', 'requested_in_context_id', 'ALTER TABLE platform_export_requests ADD COLUMN requested_in_context_id VARCHAR(128) NULL AFTER requested_by_user_id');
CALL annex_m3_exec_ddl('COLUMN', 'platform_idempotency_keys', 'operating_context_id', 'ALTER TABLE platform_idempotency_keys ADD COLUMN operating_context_id VARCHAR(128) NULL AFTER actor_user_id');
CALL annex_m3_exec_ddl('COLUMN', 'agent_assignments', 'authorizing_context_id', 'ALTER TABLE agent_assignments ADD COLUMN authorizing_context_id VARCHAR(128) NULL AFTER assigned_by_org_id');

CALL annex_m3_exec_ddl('INDEX', 'shipment_cases', 'idx_m3_shipment_fwd_ctx', 'ALTER TABLE shipment_cases ADD KEY idx_m3_shipment_fwd_ctx (tenant_id, forwarder_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'shipment_cases', 'idx_m3_shipment_car_ctx', 'ALTER TABLE shipment_cases ADD KEY idx_m3_shipment_car_ctx (tenant_id, carrier_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'platform_contracts', 'idx_m3_contract_fwd_ctx', 'ALTER TABLE platform_contracts ADD KEY idx_m3_contract_fwd_ctx (tenant_id, forwarder_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'rfq_books', 'idx_m3_rfq_publisher_ctx', 'ALTER TABLE rfq_books ADD KEY idx_m3_rfq_publisher_ctx (tenant_id, publisher_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'rfq_quotes', 'idx_m3_quote_bidder_ctx', 'ALTER TABLE rfq_quotes ADD KEY idx_m3_quote_bidder_ctx (tenant_id, bidder_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'vehicles', 'idx_m3_vehicle_car_ctx', 'ALTER TABLE vehicles ADD KEY idx_m3_vehicle_car_ctx (tenant_id, carrier_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'carrier_driver_assignments', 'idx_m3_coverage_car_ctx', 'ALTER TABLE carrier_driver_assignments ADD KEY idx_m3_coverage_car_ctx (tenant_id, carrier_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'driver_internal_bids', 'idx_m3_driver_bid_car_ctx', 'ALTER TABLE driver_internal_bids ADD KEY idx_m3_driver_bid_car_ctx (tenant_id, carrier_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'trip_cases', 'idx_m3_trip_fwd_ctx', 'ALTER TABLE trip_cases ADD KEY idx_m3_trip_fwd_ctx (tenant_id, forwarder_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'trip_cases', 'idx_m3_trip_car_ctx', 'ALTER TABLE trip_cases ADD KEY idx_m3_trip_car_ctx (tenant_id, carrier_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'driver_trip_acceptances', 'idx_m3_acceptance_car_ctx', 'ALTER TABLE driver_trip_acceptances ADD KEY idx_m3_acceptance_car_ctx (tenant_id, carrier_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'driver_delivery_otps', 'idx_m3_driver_otp_car_ctx', 'ALTER TABLE driver_delivery_otps ADD KEY idx_m3_driver_otp_car_ctx (tenant_id, carrier_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'platform_trip_events', 'idx_m3_trip_event_actor_ctx', 'ALTER TABLE platform_trip_events ADD KEY idx_m3_trip_event_actor_ctx (tenant_id, actor_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'platform_documents', 'idx_m3_document_owner_ctx', 'ALTER TABLE platform_documents ADD KEY idx_m3_document_owner_ctx (tenant_id, owner_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'pod_cases', 'idx_m3_pod_car_ctx', 'ALTER TABLE pod_cases ADD KEY idx_m3_pod_car_ctx (tenant_id, carrier_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'pod_evidence_versions', 'idx_m3_pod_evidence_car_ctx', 'ALTER TABLE pod_evidence_versions ADD KEY idx_m3_pod_evidence_car_ctx (tenant_id, carrier_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'trip_loading_evidence', 'idx_m3_loading_owner_ctx', 'ALTER TABLE trip_loading_evidence ADD KEY idx_m3_loading_owner_ctx (tenant_id, owner_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'trip_loading_schedules', 'idx_m3_schedule_creator_ctx', 'ALTER TABLE trip_loading_schedules ADD KEY idx_m3_schedule_creator_ctx (tenant_id, created_in_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'relationship_ledgers', 'idx_m3_ledger_payer_ctx', 'ALTER TABLE relationship_ledgers ADD KEY idx_m3_ledger_payer_ctx (tenant_id, payer_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'relationship_ledgers', 'idx_m3_ledger_payee_ctx', 'ALTER TABLE relationship_ledgers ADD KEY idx_m3_ledger_payee_ctx (tenant_id, payee_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'platform_claims', 'idx_m3_claim_opened_ctx', 'ALTER TABLE platform_claims ADD KEY idx_m3_claim_opened_ctx (tenant_id, opened_in_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'platform_exceptions', 'idx_m3_exception_opened_ctx', 'ALTER TABLE platform_exceptions ADD KEY idx_m3_exception_opened_ctx (tenant_id, opened_in_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'platform_domain_events', 'idx_m3_domain_event_actor_ctx', 'ALTER TABLE platform_domain_events ADD KEY idx_m3_domain_event_actor_ctx (tenant_id, actor_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'platform_notifications', 'idx_m3_notification_recipient_ctx', 'ALTER TABLE platform_notifications ADD KEY idx_m3_notification_recipient_ctx (tenant_id, recipient_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'platform_contact_reveals', 'idx_m3_reveal_actor_ctx', 'ALTER TABLE platform_contact_reveals ADD KEY idx_m3_reveal_actor_ctx (tenant_id, actor_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'platform_export_requests', 'idx_m3_export_request_ctx', 'ALTER TABLE platform_export_requests ADD KEY idx_m3_export_request_ctx (tenant_id, requested_in_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'platform_idempotency_keys', 'idx_m3_idempotency_ctx', 'ALTER TABLE platform_idempotency_keys ADD KEY idx_m3_idempotency_ctx (tenant_id, operating_context_id, id)');
CALL annex_m3_exec_ddl('INDEX', 'agent_assignments', 'idx_m3_agent_authorizer_ctx', 'ALTER TABLE agent_assignments ADD KEY idx_m3_agent_authorizer_ctx (tenant_id, authorizing_context_id, id)');

CALL annex_m3_exec_ddl('CONSTRAINT', 'shipment_cases', 'fk_m3_shipment_fwd_context', 'ALTER TABLE shipment_cases ADD CONSTRAINT fk_m3_shipment_fwd_context FOREIGN KEY (tenant_id, x_org_id, forwarder_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'shipment_cases', 'fk_m3_shipment_car_context', 'ALTER TABLE shipment_cases ADD CONSTRAINT fk_m3_shipment_car_context FOREIGN KEY (tenant_id, y_org_id, carrier_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'platform_contracts', 'fk_m3_contract_fwd_context', 'ALTER TABLE platform_contracts ADD CONSTRAINT fk_m3_contract_fwd_context FOREIGN KEY (tenant_id, x_org_id, forwarder_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'rfq_books', 'fk_m3_rfq_publisher_context', 'ALTER TABLE rfq_books ADD CONSTRAINT fk_m3_rfq_publisher_context FOREIGN KEY (tenant_id, publisher_org_id, publisher_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'rfq_quotes', 'fk_m3_quote_bidder_context', 'ALTER TABLE rfq_quotes ADD CONSTRAINT fk_m3_quote_bidder_context FOREIGN KEY (tenant_id, bidder_org_id, bidder_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'vehicles', 'fk_m3_vehicle_car_context', 'ALTER TABLE vehicles ADD CONSTRAINT fk_m3_vehicle_car_context FOREIGN KEY (tenant_id, owner_org_id, carrier_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'carrier_driver_assignments', 'fk_m3_coverage_car_context', 'ALTER TABLE carrier_driver_assignments ADD CONSTRAINT fk_m3_coverage_car_context FOREIGN KEY (tenant_id, y_org_id, carrier_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'driver_internal_bids', 'fk_m3_driver_bid_car_context', 'ALTER TABLE driver_internal_bids ADD CONSTRAINT fk_m3_driver_bid_car_context FOREIGN KEY (tenant_id, y_org_id, carrier_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'trip_cases', 'fk_m3_trip_fwd_context', 'ALTER TABLE trip_cases ADD CONSTRAINT fk_m3_trip_fwd_context FOREIGN KEY (tenant_id, x_org_id, forwarder_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'trip_cases', 'fk_m3_trip_car_context', 'ALTER TABLE trip_cases ADD CONSTRAINT fk_m3_trip_car_context FOREIGN KEY (tenant_id, y_org_id, carrier_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'driver_trip_acceptances', 'fk_m3_acceptance_car_context', 'ALTER TABLE driver_trip_acceptances ADD CONSTRAINT fk_m3_acceptance_car_context FOREIGN KEY (tenant_id, carrier_context_id) REFERENCES operating_contexts (tenant_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'driver_delivery_otps', 'fk_m3_driver_otp_car_context', 'ALTER TABLE driver_delivery_otps ADD CONSTRAINT fk_m3_driver_otp_car_context FOREIGN KEY (tenant_id, carrier_context_id) REFERENCES operating_contexts (tenant_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'platform_trip_events', 'fk_m3_trip_event_actor_context', 'ALTER TABLE platform_trip_events ADD CONSTRAINT fk_m3_trip_event_actor_context FOREIGN KEY (tenant_id, actor_context_id) REFERENCES operating_contexts (tenant_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'platform_documents', 'fk_m3_document_owner_context', 'ALTER TABLE platform_documents ADD CONSTRAINT fk_m3_document_owner_context FOREIGN KEY (tenant_id, owner_org_id, owner_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'pod_cases', 'fk_m3_pod_car_context', 'ALTER TABLE pod_cases ADD CONSTRAINT fk_m3_pod_car_context FOREIGN KEY (tenant_id, carrier_context_id) REFERENCES operating_contexts (tenant_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'pod_evidence_versions', 'fk_m3_pod_evidence_car_context', 'ALTER TABLE pod_evidence_versions ADD CONSTRAINT fk_m3_pod_evidence_car_context FOREIGN KEY (tenant_id, carrier_context_id) REFERENCES operating_contexts (tenant_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'trip_loading_evidence', 'fk_m3_loading_owner_context', 'ALTER TABLE trip_loading_evidence ADD CONSTRAINT fk_m3_loading_owner_context FOREIGN KEY (tenant_id, owner_org_id, owner_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'trip_loading_schedules', 'fk_m3_schedule_creator_context', 'ALTER TABLE trip_loading_schedules ADD CONSTRAINT fk_m3_schedule_creator_context FOREIGN KEY (tenant_id, created_in_context_id) REFERENCES operating_contexts (tenant_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'relationship_ledgers', 'fk_m3_ledger_payer_context', 'ALTER TABLE relationship_ledgers ADD CONSTRAINT fk_m3_ledger_payer_context FOREIGN KEY (tenant_id, payer_org_id, payer_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'relationship_ledgers', 'fk_m3_ledger_payee_context', 'ALTER TABLE relationship_ledgers ADD CONSTRAINT fk_m3_ledger_payee_context FOREIGN KEY (tenant_id, payee_org_id, payee_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'platform_claims', 'fk_m3_claim_opened_context', 'ALTER TABLE platform_claims ADD CONSTRAINT fk_m3_claim_opened_context FOREIGN KEY (tenant_id, opened_by_org_id, opened_in_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'platform_exceptions', 'fk_m3_exception_opened_context', 'ALTER TABLE platform_exceptions ADD CONSTRAINT fk_m3_exception_opened_context FOREIGN KEY (tenant_id, opened_by_org_id, opened_in_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'platform_domain_events', 'fk_m3_domain_event_actor_context', 'ALTER TABLE platform_domain_events ADD CONSTRAINT fk_m3_domain_event_actor_context FOREIGN KEY (tenant_id, actor_context_id) REFERENCES operating_contexts (tenant_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'platform_notifications', 'fk_m3_notification_recipient_context', 'ALTER TABLE platform_notifications ADD CONSTRAINT fk_m3_notification_recipient_context FOREIGN KEY (tenant_id, recipient_context_id) REFERENCES operating_contexts (tenant_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'platform_contact_reveals', 'fk_m3_reveal_actor_context', 'ALTER TABLE platform_contact_reveals ADD CONSTRAINT fk_m3_reveal_actor_context FOREIGN KEY (tenant_id, organization_id, actor_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'platform_export_requests', 'fk_m3_export_request_context', 'ALTER TABLE platform_export_requests ADD CONSTRAINT fk_m3_export_request_context FOREIGN KEY (tenant_id, organization_id, requested_in_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'platform_idempotency_keys', 'fk_m3_idempotency_context', 'ALTER TABLE platform_idempotency_keys ADD CONSTRAINT fk_m3_idempotency_context FOREIGN KEY (tenant_id, operating_context_id) REFERENCES operating_contexts (tenant_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');
CALL annex_m3_exec_ddl('CONSTRAINT', 'agent_assignments', 'fk_m3_agent_authorizer_context', 'ALTER TABLE agent_assignments ADD CONSTRAINT fk_m3_agent_authorizer_context FOREIGN KEY (tenant_id, assigned_by_org_id, authorizing_context_id) REFERENCES operating_contexts (tenant_id, organization_id, context_id) ON UPDATE RESTRICT ON DELETE RESTRICT');

DROP PROCEDURE annex_m3_exec_ddl;

-- The candidate view emits one row per source row and possible context. A NULL
-- candidate is retained so zero-candidate rows are reported instead of lost.
CREATE OR REPLACE VIEW annex_m3_context_candidates_v AS
SELECT 'shipment_cases' AS target_table, 'forwarder_context_id' AS target_column,
       s.id AS target_id, s.tenant_id, s.x_org_id AS source_organization_id,
       s.forwarder_context_id AS existing_context_id,
       CASE WHEN s.x_org_id IS NULL THEN 'MISSING' ELSE NULL END AS base_disposition,
       CASE WHEN s.x_org_id IS NULL THEN 'MISSING_SOURCE_ORGANIZATION' ELSE NULL END AS base_reason_code,
       c.context_id AS candidate_context_id
FROM shipment_cases s
LEFT JOIN operating_contexts c
  ON c.tenant_id = s.tenant_id
 AND c.organization_id = s.x_org_id
 AND c.context_type = 'FWD'

UNION ALL
SELECT 'shipment_cases', 'carrier_context_id', s.id, s.tenant_id, s.y_org_id,
       s.carrier_context_id,
       CASE WHEN s.y_org_id IS NULL THEN 'MISSING' ELSE NULL END,
       CASE WHEN s.y_org_id IS NULL THEN 'MISSING_SOURCE_ORGANIZATION' ELSE NULL END,
       c.context_id
FROM shipment_cases s
LEFT JOIN operating_contexts c
  ON c.tenant_id = s.tenant_id
 AND c.organization_id = s.y_org_id
 AND c.context_type = 'CAR'

UNION ALL
SELECT 'platform_contracts', 'forwarder_context_id', p.id, p.tenant_id, p.x_org_id,
       p.forwarder_context_id,
       CASE WHEN p.x_org_id IS NULL THEN 'MISSING' ELSE NULL END,
       CASE WHEN p.x_org_id IS NULL THEN 'MISSING_SOURCE_ORGANIZATION' ELSE NULL END,
       c.context_id
FROM platform_contracts p
LEFT JOIN operating_contexts c
  ON c.tenant_id = p.tenant_id
 AND c.organization_id = p.x_org_id
 AND c.context_type = 'FWD'

UNION ALL
SELECT 'rfq_books', 'publisher_context_id', r.id, r.tenant_id, r.publisher_org_id,
       r.publisher_context_id,
       CASE
         WHEN r.level = 'RFQ1' THEN 'NOT_APPLICABLE'
         WHEN r.level <> 'RFQ2' THEN 'AMBIGUOUS'
         WHEN r.publisher_org_id IS NULL THEN 'MISSING'
         ELSE NULL
       END,
       CASE
         WHEN r.level = 'RFQ1' THEN 'RFQ1_PUBLISHER_IS_CUSTOMER_CONTEXT'
         WHEN r.level <> 'RFQ2' THEN 'UNSUPPORTED_RFQ_LEVEL'
         WHEN r.publisher_org_id IS NULL THEN 'MISSING_SOURCE_ORGANIZATION'
         ELSE NULL
       END,
       c.context_id
FROM rfq_books r
LEFT JOIN operating_contexts c
  ON r.level = 'RFQ2'
 AND c.tenant_id = r.tenant_id
 AND c.organization_id = r.publisher_org_id
 AND c.context_type = 'FWD'

UNION ALL
SELECT 'rfq_quotes', 'bidder_context_id', q.id, q.tenant_id, q.bidder_org_id,
       q.bidder_context_id,
       CASE
         WHEN r.id IS NULL THEN 'MISSING'
         WHEN r.level NOT IN ('RFQ1', 'RFQ2') THEN 'AMBIGUOUS'
         WHEN q.bidder_org_id IS NULL THEN 'MISSING'
         ELSE NULL
       END,
       CASE
         WHEN r.id IS NULL THEN 'MISSING_PARENT_RFQ'
         WHEN r.level NOT IN ('RFQ1', 'RFQ2') THEN 'UNSUPPORTED_RFQ_LEVEL'
         WHEN q.bidder_org_id IS NULL THEN 'MISSING_SOURCE_ORGANIZATION'
         ELSE NULL
       END,
       c.context_id
FROM rfq_quotes q
LEFT JOIN rfq_books r
  ON r.id = q.rfq_id
 AND r.tenant_id = q.tenant_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = q.tenant_id
 AND c.organization_id = q.bidder_org_id
 AND c.context_type = CASE r.level WHEN 'RFQ1' THEN 'FWD' WHEN 'RFQ2' THEN 'CAR' END

UNION ALL
SELECT 'vehicles', 'carrier_context_id', v.id, v.tenant_id, v.owner_org_id,
       v.carrier_context_id,
       CASE WHEN v.owner_org_id LIKE 'driver:%' THEN 'NOT_APPLICABLE' ELSE NULL END,
       CASE WHEN v.owner_org_id LIKE 'driver:%' THEN 'DRIVER_OWNED_VEHICLE_HAS_NO_ORG_CONTEXT' ELSE NULL END,
       c.context_id
FROM vehicles v
LEFT JOIN operating_contexts c
  ON v.owner_org_id NOT LIKE 'driver:%'
 AND c.tenant_id = v.tenant_id
 AND c.organization_id = v.owner_org_id
 AND c.context_type = 'CAR'

UNION ALL
SELECT 'carrier_driver_assignments', 'carrier_context_id', a.id, a.tenant_id, a.y_org_id,
       a.carrier_context_id, NULL, NULL, c.context_id
FROM carrier_driver_assignments a
LEFT JOIN operating_contexts c
  ON c.tenant_id = a.tenant_id
 AND c.organization_id = a.y_org_id
 AND c.context_type = 'CAR'

UNION ALL
SELECT 'driver_internal_bids', 'carrier_context_id', b.id, b.tenant_id, b.y_org_id,
       b.carrier_context_id, NULL, NULL, c.context_id
FROM driver_internal_bids b
LEFT JOIN operating_contexts c
  ON c.tenant_id = b.tenant_id
 AND c.organization_id = b.y_org_id
 AND c.context_type = 'CAR'

UNION ALL
SELECT 'trip_cases', 'forwarder_context_id', t.id, t.tenant_id, t.x_org_id,
       t.forwarder_context_id, NULL, NULL, c.context_id
FROM trip_cases t
LEFT JOIN operating_contexts c
  ON c.tenant_id = t.tenant_id
 AND c.organization_id = t.x_org_id
 AND c.context_type = 'FWD'

UNION ALL
SELECT 'trip_cases', 'carrier_context_id', t.id, t.tenant_id, t.y_org_id,
       t.carrier_context_id, NULL, NULL, c.context_id
FROM trip_cases t
LEFT JOIN operating_contexts c
  ON c.tenant_id = t.tenant_id
 AND c.organization_id = t.y_org_id
 AND c.context_type = 'CAR'

UNION ALL
SELECT 'driver_trip_acceptances', 'carrier_context_id', a.id, a.tenant_id, t.y_org_id,
       a.carrier_context_id,
       CASE WHEN t.id IS NULL THEN 'MISSING' ELSE NULL END,
       CASE WHEN t.id IS NULL THEN 'MISSING_PARENT_TRIP' ELSE NULL END,
       c.context_id
FROM driver_trip_acceptances a
LEFT JOIN trip_cases t
  ON t.id = a.trip_id
 AND t.tenant_id = a.tenant_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = t.tenant_id
 AND c.organization_id = t.y_org_id
 AND c.context_type = 'CAR'

UNION ALL
SELECT 'driver_delivery_otps', 'carrier_context_id', o.id, o.tenant_id, t.y_org_id,
       o.carrier_context_id,
       CASE WHEN t.id IS NULL THEN 'MISSING' ELSE NULL END,
       CASE WHEN t.id IS NULL THEN 'MISSING_PARENT_TRIP' ELSE NULL END,
       c.context_id
FROM driver_delivery_otps o
LEFT JOIN trip_cases t
  ON t.id = o.trip_id
 AND t.tenant_id = o.tenant_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = t.tenant_id
 AND c.organization_id = t.y_org_id
 AND c.context_type = 'CAR'

UNION ALL
SELECT 'platform_trip_events', 'actor_context_id', e.id, e.tenant_id, c.organization_id,
       e.actor_context_id,
       CASE
         WHEN t.id IS NULL THEN 'MISSING'
         WHEN e.actor_user_id IS NULL THEN 'NOT_APPLICABLE'
         ELSE NULL
       END,
       CASE
         WHEN t.id IS NULL THEN 'MISSING_PARENT_TRIP'
         WHEN e.actor_user_id IS NULL THEN 'SYSTEM_EVENT_WITHOUT_ACTOR_CONTEXT'
         ELSE NULL
       END,
       c.context_id
FROM platform_trip_events e
LEFT JOIN trip_cases t
  ON t.id = e.trip_id
 AND t.tenant_id = e.tenant_id
LEFT JOIN membership_operating_contexts mc
  ON mc.tenant_id = e.tenant_id
 AND mc.user_id = e.actor_user_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = mc.tenant_id
 AND c.context_id = mc.context_id
 AND (
   (c.context_type = 'FWD' AND c.organization_id = t.x_org_id)
   OR (c.context_type = 'CAR' AND c.organization_id = t.y_org_id)
 )

UNION ALL
SELECT 'platform_documents', 'owner_context_id', d.id, d.tenant_id, d.owner_org_id,
       d.owner_context_id, NULL, NULL, c.context_id
FROM platform_documents d
LEFT JOIN operating_contexts c
  ON c.tenant_id = d.tenant_id
 AND c.organization_id = d.owner_org_id

UNION ALL
SELECT 'pod_cases', 'carrier_context_id', p.id, p.tenant_id, t.y_org_id,
       p.carrier_context_id,
       CASE WHEN t.id IS NULL THEN 'MISSING' ELSE NULL END,
       CASE WHEN t.id IS NULL THEN 'MISSING_PARENT_TRIP' ELSE NULL END,
       c.context_id
FROM pod_cases p
LEFT JOIN trip_cases t
  ON t.id = p.trip_id
 AND t.tenant_id = p.tenant_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = t.tenant_id
 AND c.organization_id = t.y_org_id
 AND c.context_type = 'CAR'

UNION ALL
SELECT 'pod_evidence_versions', 'carrier_context_id', v.id, v.tenant_id, t.y_org_id,
       v.carrier_context_id,
       CASE WHEN p.id IS NULL OR t.id IS NULL THEN 'MISSING' ELSE NULL END,
       CASE WHEN p.id IS NULL THEN 'MISSING_PARENT_POD' WHEN t.id IS NULL THEN 'MISSING_PARENT_TRIP' ELSE NULL END,
       c.context_id
FROM pod_evidence_versions v
LEFT JOIN pod_cases p
  ON p.id = v.pod_id
 AND p.tenant_id = v.tenant_id
LEFT JOIN trip_cases t
  ON t.id = p.trip_id
 AND t.tenant_id = p.tenant_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = t.tenant_id
 AND c.organization_id = t.y_org_id
 AND c.context_type = 'CAR'

UNION ALL
SELECT 'trip_loading_evidence', 'owner_context_id', e.id, e.tenant_id, e.owner_org_id,
       e.owner_context_id,
       CASE WHEN t.id IS NULL THEN 'MISSING' ELSE NULL END,
       CASE WHEN t.id IS NULL THEN 'MISSING_PARENT_TRIP' ELSE NULL END,
       c.context_id
FROM trip_loading_evidence e
LEFT JOIN trip_cases t
  ON t.id = e.trip_id
 AND t.tenant_id = e.tenant_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = e.tenant_id
 AND c.organization_id = e.owner_org_id
 AND (
   (c.context_type = 'FWD' AND c.organization_id = t.x_org_id)
   OR (c.context_type = 'CAR' AND c.organization_id = t.y_org_id)
 )

UNION ALL
SELECT 'trip_loading_schedules', 'created_in_context_id', s.id, s.tenant_id, c.organization_id,
       s.created_in_context_id,
       CASE
         WHEN t.id IS NULL THEN 'MISSING'
         WHEN s.created_by_user_id IS NULL THEN 'NOT_APPLICABLE'
         ELSE NULL
       END,
       CASE
         WHEN t.id IS NULL THEN 'MISSING_PARENT_TRIP'
         WHEN s.created_by_user_id IS NULL THEN 'SYSTEM_SCHEDULE_WITHOUT_ACTOR_CONTEXT'
         ELSE NULL
       END,
       c.context_id
FROM trip_loading_schedules s
LEFT JOIN trip_cases t
  ON t.id = s.trip_id
 AND t.tenant_id = s.tenant_id
LEFT JOIN membership_operating_contexts mc
  ON mc.tenant_id = s.tenant_id
 AND mc.user_id = s.created_by_user_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = mc.tenant_id
 AND c.context_id = mc.context_id
 AND (
   (c.context_type = 'FWD' AND c.organization_id = t.x_org_id)
   OR (c.context_type = 'CAR' AND c.organization_id = t.y_org_id)
 )

UNION ALL
SELECT 'relationship_ledgers', 'payer_context_id', l.id, l.tenant_id, l.payer_org_id,
       l.payer_context_id,
       CASE
         WHEN l.relationship_type = 'customer_x' THEN 'NOT_APPLICABLE'
         WHEN l.relationship_type NOT IN ('x_y', 'y_driver', 'x_agent') THEN 'AMBIGUOUS'
         ELSE NULL
       END,
       CASE
         WHEN l.relationship_type = 'customer_x' THEN 'CUSTOMER_PAYER_HAS_NO_OPERATING_CONTEXT'
         WHEN l.relationship_type NOT IN ('x_y', 'y_driver', 'x_agent') THEN 'UNSUPPORTED_RELATIONSHIP_TYPE'
         ELSE NULL
       END,
       c.context_id
FROM relationship_ledgers l
LEFT JOIN operating_contexts c
  ON c.tenant_id = l.tenant_id
 AND c.organization_id = l.payer_org_id
 AND c.context_type = CASE
   WHEN l.relationship_type IN ('x_y', 'x_agent') THEN 'FWD'
   WHEN l.relationship_type = 'y_driver' THEN 'CAR'
 END

UNION ALL
SELECT 'relationship_ledgers', 'payee_context_id', l.id, l.tenant_id, l.payee_org_id,
       l.payee_context_id,
       CASE
         WHEN l.relationship_type IN ('y_driver', 'x_agent') THEN 'NOT_APPLICABLE'
         WHEN l.relationship_type NOT IN ('customer_x', 'x_y') THEN 'AMBIGUOUS'
         ELSE NULL
       END,
       CASE
         WHEN l.relationship_type = 'y_driver' THEN 'DRIVER_PAYEE_HAS_NO_OPERATING_CONTEXT'
         WHEN l.relationship_type = 'x_agent' THEN 'AGENT_PAYEE_HAS_NO_OPERATING_CONTEXT'
         WHEN l.relationship_type NOT IN ('customer_x', 'x_y') THEN 'UNSUPPORTED_RELATIONSHIP_TYPE'
         ELSE NULL
       END,
       c.context_id
FROM relationship_ledgers l
LEFT JOIN operating_contexts c
  ON c.tenant_id = l.tenant_id
 AND c.organization_id = l.payee_org_id
 AND c.context_type = CASE
   WHEN l.relationship_type = 'customer_x' THEN 'FWD'
   WHEN l.relationship_type = 'x_y' THEN 'CAR'
 END

UNION ALL
SELECT 'platform_claims', 'opened_in_context_id', p.id, p.tenant_id, p.opened_by_org_id,
       p.opened_in_context_id, NULL, NULL, c.context_id
FROM platform_claims p
LEFT JOIN membership_operating_contexts mc
  ON mc.tenant_id = p.tenant_id
 AND mc.user_id = p.opened_by_user_id
 AND mc.organization_id = p.opened_by_org_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = mc.tenant_id
 AND c.organization_id = mc.organization_id
 AND c.context_id = mc.context_id

UNION ALL
SELECT 'platform_exceptions', 'opened_in_context_id', e.id, e.tenant_id, e.opened_by_org_id,
       e.opened_in_context_id, NULL, NULL, c.context_id
FROM platform_exceptions e
LEFT JOIN membership_operating_contexts mc
  ON mc.tenant_id = e.tenant_id
 AND mc.user_id = e.opened_by_user_id
 AND mc.organization_id = e.opened_by_org_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = mc.tenant_id
 AND c.organization_id = mc.organization_id
 AND c.context_id = mc.context_id

UNION ALL
SELECT 'platform_domain_events', 'actor_context_id', e.id, e.tenant_id, c.organization_id,
       e.actor_context_id,
       CASE WHEN e.actor_user_id IS NULL THEN 'NOT_APPLICABLE' ELSE 'AMBIGUOUS' END,
       CASE
         WHEN e.actor_user_id IS NULL THEN 'SYSTEM_EVENT_WITHOUT_ACTOR_CONTEXT'
         ELSE 'HISTORICAL_EVENT_CONTEXT_NOT_RECORDED'
       END,
       c.context_id
FROM platform_domain_events e
LEFT JOIN membership_operating_contexts mc
  ON mc.tenant_id = e.tenant_id
 AND mc.user_id = e.actor_user_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = mc.tenant_id
 AND c.context_id = mc.context_id

UNION ALL
SELECT 'platform_notifications', 'recipient_context_id', n.id, n.tenant_id,
       COALESCE(n.recipient_org_id, c.organization_id), n.recipient_context_id,
       CASE WHEN n.recipient_org_id IS NULL AND n.recipient_user_id IS NULL THEN 'NOT_APPLICABLE' ELSE NULL END,
       CASE WHEN n.recipient_org_id IS NULL AND n.recipient_user_id IS NULL THEN 'SYSTEM_NOTIFICATION_WITHOUT_RECIPIENT' ELSE NULL END,
       c.context_id
FROM platform_notifications n
LEFT JOIN operating_contexts c
  ON c.tenant_id = n.tenant_id
 AND (
   (n.recipient_user_id IS NULL AND n.recipient_org_id IS NOT NULL AND c.organization_id = n.recipient_org_id)
   OR
   (n.recipient_user_id IS NOT NULL AND EXISTS (
     SELECT 1
     FROM membership_operating_contexts mc
     WHERE mc.tenant_id = n.tenant_id
       AND mc.user_id = n.recipient_user_id
       AND mc.context_id = c.context_id
       AND (n.recipient_org_id IS NULL OR mc.organization_id = n.recipient_org_id)
   ))
 )

UNION ALL
SELECT 'platform_contact_reveals', 'actor_context_id', r.id, r.tenant_id, r.organization_id,
       r.actor_context_id, NULL, NULL, c.context_id
FROM platform_contact_reveals r
LEFT JOIN membership_operating_contexts mc
  ON mc.tenant_id = r.tenant_id
 AND mc.user_id = r.actor_user_id
 AND mc.organization_id = r.organization_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = mc.tenant_id
 AND c.organization_id = mc.organization_id
 AND c.context_id = mc.context_id

UNION ALL
SELECT 'platform_export_requests', 'requested_in_context_id', e.id, e.tenant_id, e.organization_id,
       e.requested_in_context_id, NULL, NULL, c.context_id
FROM platform_export_requests e
LEFT JOIN membership_operating_contexts mc
  ON mc.tenant_id = e.tenant_id
 AND mc.user_id = e.requested_by_user_id
 AND mc.organization_id = e.organization_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = mc.tenant_id
 AND c.organization_id = mc.organization_id
 AND c.context_id = mc.context_id

UNION ALL
SELECT 'platform_idempotency_keys', 'operating_context_id', i.id, i.tenant_id, c.organization_id,
       i.operating_context_id,
       'AMBIGUOUS',
       'HISTORICAL_REQUEST_CONTEXT_NOT_RECORDED',
       c.context_id
FROM platform_idempotency_keys i
LEFT JOIN membership_operating_contexts mc
  ON mc.tenant_id = i.tenant_id
 AND mc.user_id = i.actor_user_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = mc.tenant_id
 AND c.context_id = mc.context_id

UNION ALL
SELECT 'agent_assignments', 'authorizing_context_id', a.id, a.tenant_id, a.assigned_by_org_id,
       a.authorizing_context_id,
       CASE WHEN t.id IS NULL THEN 'MISSING' ELSE NULL END,
       CASE WHEN t.id IS NULL THEN 'MISSING_PARENT_TRIP' ELSE NULL END,
       c.context_id
FROM agent_assignments a
LEFT JOIN trip_cases t
  ON t.id = a.trip_id
 AND t.tenant_id = a.tenant_id
LEFT JOIN operating_contexts c
  ON c.tenant_id = a.tenant_id
 AND c.organization_id = a.assigned_by_org_id
 AND (
   (c.context_type = 'FWD' AND c.organization_id = t.x_org_id)
   OR (c.context_type = 'CAR' AND c.organization_id = t.y_org_id)
 );

DROP PROCEDURE IF EXISTS annex_m3_process_target;
DELIMITER $$
CREATE PROCEDURE annex_m3_process_target(
  IN p_target_table VARCHAR(64),
  IN p_target_column VARCHAR(64)
)
procedure_body: BEGIN
  DECLARE v_target_count INT DEFAULT 0;
  DECLARE v_batch_size INT DEFAULT 500;
  DECLARE v_current_max BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_snapshot_max BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_last_scanned BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_batch_max BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_batch_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_resolved_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_missing_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_ambiguous_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_not_applicable_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_message VARCHAR(255);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  IF p_target_table NOT REGEXP '^[a-z0-9_]+$'
     OR p_target_column NOT REGEXP '^[a-z0-9_]+$' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'M3 target identifier is invalid';
  END IF;

  SELECT COUNT(*) INTO v_target_count
  FROM annex_m3_backfill_targets
  WHERE target_table = p_target_table
    AND target_column = p_target_column
    AND artifact_revision = 'structural-annex-v1:M3:1';

  IF v_target_count <> 1 THEN
    SET v_message = CONCAT('M3 target contract mismatch: ', p_target_table, '.', p_target_column);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_message;
  END IF;

  SET v_batch_size = LEAST(GREATEST(COALESCE(@annex_m3_batch_size, 500), 1), 5000);

  SELECT COALESCE(MAX(target_id), 0) INTO v_current_max
  FROM annex_m3_context_candidates_v
  WHERE target_table = p_target_table
    AND target_column = p_target_column;

  INSERT IGNORE INTO annex_m3_backfill_checkpoints
    (target_table, target_column, snapshot_max_id, last_scanned_id,
     status, artifact_revision, started_at)
  VALUES
    (p_target_table, p_target_column, v_current_max, 0,
     'PENDING', 'structural-annex-v1:M3:1', CURRENT_TIMESTAMP);

  UPDATE annex_m3_backfill_checkpoints
  SET status = CASE WHEN v_current_max > snapshot_max_id THEN 'RUNNING' ELSE status END,
      completed_at = CASE WHEN v_current_max > snapshot_max_id THEN NULL ELSE completed_at END,
      snapshot_max_id = GREATEST(snapshot_max_id, v_current_max)
  WHERE target_table = p_target_table
    AND target_column = p_target_column
    AND artifact_revision = 'structural-annex-v1:M3:1';

  SELECT COUNT(*) INTO v_target_count
  FROM annex_m3_backfill_checkpoints
  WHERE target_table = p_target_table
    AND target_column = p_target_column
    AND artifact_revision = 'structural-annex-v1:M3:1';

  IF v_target_count <> 1 THEN
    SET v_message = CONCAT('M3 checkpoint contract mismatch: ', p_target_table, '.', p_target_column);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_message;
  END IF;

  SELECT snapshot_max_id, last_scanned_id
    INTO v_snapshot_max, v_last_scanned
  FROM annex_m3_backfill_checkpoints
  WHERE target_table = p_target_table
    AND target_column = p_target_column
    AND artifact_revision = 'structural-annex-v1:M3:1';

  WHILE v_last_scanned < v_snapshot_max DO
    SELECT COALESCE(MAX(batch.target_id), 0) INTO v_batch_max
    FROM (
      SELECT DISTINCT target_id
      FROM annex_m3_context_candidates_v
      WHERE target_table = p_target_table
        AND target_column = p_target_column
        AND target_id > v_last_scanned
        AND target_id <= v_snapshot_max
      ORDER BY target_id
      LIMIT v_batch_size
    ) AS batch;

    IF v_batch_max <= v_last_scanned THEN
      SET v_message = CONCAT('M3 candidate gap for ', p_target_table, '.', p_target_column);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_message;
    END IF;

    START TRANSACTION;

    DELETE FROM annex_m3_context_attributions
    WHERE target_table = p_target_table
      AND target_column = p_target_column
      AND target_id > v_last_scanned
      AND target_id <= v_batch_max;

    INSERT INTO annex_m3_context_attributions
      (target_table, target_column, target_id, tenant_id,
       source_organization_id, candidate_count, disposition, reason_code,
       existing_context_id, resolved_context_id)
    SELECT
      candidates.target_table,
      candidates.target_column,
      candidates.target_id,
      MAX(candidates.tenant_id),
      CASE
        WHEN COUNT(DISTINCT candidates.source_organization_id) = 1
        THEN MIN(candidates.source_organization_id)
        ELSE NULL
      END,
      COUNT(DISTINCT candidates.candidate_context_id),
      CASE
        WHEN MAX(candidates.base_disposition) IS NOT NULL THEN MAX(candidates.base_disposition)
        WHEN COUNT(DISTINCT candidates.candidate_context_id) = 1 THEN 'RESOLVED'
        WHEN COUNT(DISTINCT candidates.candidate_context_id) = 0 THEN 'MISSING'
        ELSE 'AMBIGUOUS'
      END,
      CASE
        WHEN MAX(candidates.base_reason_code) IS NOT NULL THEN MAX(candidates.base_reason_code)
        WHEN COUNT(DISTINCT candidates.candidate_context_id) = 1 THEN 'UNIQUE_CONTEXT_MATCH'
        WHEN COUNT(DISTINCT candidates.candidate_context_id) = 0 THEN 'NO_CONTEXT_CANDIDATE'
        ELSE 'MULTIPLE_CONTEXT_CANDIDATES'
      END,
      MAX(candidates.existing_context_id),
      CASE
        WHEN MAX(candidates.base_disposition) IS NULL
         AND COUNT(DISTINCT candidates.candidate_context_id) = 1
        THEN MIN(candidates.candidate_context_id)
        ELSE NULL
      END
    FROM annex_m3_context_candidates_v candidates
    WHERE candidates.target_table = p_target_table
      AND candidates.target_column = p_target_column
      AND candidates.target_id > v_last_scanned
      AND candidates.target_id <= v_batch_max
    GROUP BY candidates.target_table, candidates.target_column, candidates.target_id;

    SET @annex_m3_update_sql = CONCAT(
      'UPDATE `', p_target_table, '` target ',
      'JOIN annex_m3_context_attributions attribution ',
      'ON attribution.target_id = target.id AND attribution.tenant_id = target.tenant_id ',
      'SET target.`', p_target_column, '` = attribution.resolved_context_id ',
      'WHERE attribution.target_table = ', QUOTE(p_target_table),
      ' AND attribution.target_column = ', QUOTE(p_target_column),
      ' AND attribution.target_id > ', v_last_scanned,
      ' AND attribution.target_id <= ', v_batch_max,
      ' AND attribution.disposition = ''RESOLVED'' ',
      'AND target.`', p_target_column, '` IS NULL'
    );
    PREPARE annex_m3_update_statement FROM @annex_m3_update_sql;
    EXECUTE annex_m3_update_statement;
    DEALLOCATE PREPARE annex_m3_update_statement;

    SET @annex_m3_verify_sql = CONCAT(
      'UPDATE annex_m3_context_attributions attribution ',
      'JOIN `', p_target_table, '` target ',
      'ON attribution.target_id = target.id AND attribution.tenant_id = target.tenant_id ',
      'SET attribution.applied_at = CURRENT_TIMESTAMP ',
      'WHERE attribution.target_table = ', QUOTE(p_target_table),
      ' AND attribution.target_column = ', QUOTE(p_target_column),
      ' AND attribution.target_id > ', v_last_scanned,
      ' AND attribution.target_id <= ', v_batch_max,
      ' AND attribution.disposition = ''RESOLVED'' ',
      'AND target.`', p_target_column, '` = attribution.resolved_context_id'
    );
    PREPARE annex_m3_verify_statement FROM @annex_m3_verify_sql;
    EXECUTE annex_m3_verify_statement;
    DEALLOCATE PREPARE annex_m3_verify_statement;

    SELECT
      COUNT(*),
      COALESCE(SUM(disposition = 'RESOLVED'), 0),
      COALESCE(SUM(disposition = 'MISSING'), 0),
      COALESCE(SUM(disposition = 'AMBIGUOUS'), 0),
      COALESCE(SUM(disposition = 'NOT_APPLICABLE'), 0)
    INTO
      v_batch_count, v_resolved_count, v_missing_count,
      v_ambiguous_count, v_not_applicable_count
    FROM annex_m3_context_attributions
    WHERE target_table = p_target_table
      AND target_column = p_target_column
      AND target_id > v_last_scanned
      AND target_id <= v_batch_max;

    UPDATE annex_m3_backfill_checkpoints
    SET last_scanned_id = v_batch_max,
        scanned_count = scanned_count + v_batch_count,
        resolved_count = resolved_count + v_resolved_count,
        missing_count = missing_count + v_missing_count,
        ambiguous_count = ambiguous_count + v_ambiguous_count,
        not_applicable_count = not_applicable_count + v_not_applicable_count,
        status = CASE WHEN v_batch_max >= snapshot_max_id THEN 'COMPLETE' ELSE 'RUNNING' END,
        completed_at = CASE WHEN v_batch_max >= snapshot_max_id THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE target_table = p_target_table
      AND target_column = p_target_column
      AND artifact_revision = 'structural-annex-v1:M3:1';

    COMMIT;
    SET v_last_scanned = v_batch_max;
  END WHILE;

  UPDATE annex_m3_backfill_checkpoints
  SET status = 'COMPLETE',
      completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
  WHERE target_table = p_target_table
    AND target_column = p_target_column
    AND last_scanned_id >= snapshot_max_id
    AND artifact_revision = 'structural-annex-v1:M3:1';
END$$
DELIMITER ;

CALL annex_m3_process_target('shipment_cases', 'forwarder_context_id');
CALL annex_m3_process_target('shipment_cases', 'carrier_context_id');
CALL annex_m3_process_target('platform_contracts', 'forwarder_context_id');
CALL annex_m3_process_target('rfq_books', 'publisher_context_id');
CALL annex_m3_process_target('rfq_quotes', 'bidder_context_id');
CALL annex_m3_process_target('vehicles', 'carrier_context_id');
CALL annex_m3_process_target('carrier_driver_assignments', 'carrier_context_id');
CALL annex_m3_process_target('driver_internal_bids', 'carrier_context_id');
CALL annex_m3_process_target('trip_cases', 'forwarder_context_id');
CALL annex_m3_process_target('trip_cases', 'carrier_context_id');
CALL annex_m3_process_target('driver_trip_acceptances', 'carrier_context_id');
CALL annex_m3_process_target('driver_delivery_otps', 'carrier_context_id');
CALL annex_m3_process_target('platform_trip_events', 'actor_context_id');
CALL annex_m3_process_target('platform_documents', 'owner_context_id');
CALL annex_m3_process_target('pod_cases', 'carrier_context_id');
CALL annex_m3_process_target('pod_evidence_versions', 'carrier_context_id');
CALL annex_m3_process_target('trip_loading_evidence', 'owner_context_id');
CALL annex_m3_process_target('trip_loading_schedules', 'created_in_context_id');
CALL annex_m3_process_target('relationship_ledgers', 'payer_context_id');
CALL annex_m3_process_target('relationship_ledgers', 'payee_context_id');
CALL annex_m3_process_target('platform_claims', 'opened_in_context_id');
CALL annex_m3_process_target('platform_exceptions', 'opened_in_context_id');
CALL annex_m3_process_target('platform_domain_events', 'actor_context_id');
CALL annex_m3_process_target('platform_notifications', 'recipient_context_id');
CALL annex_m3_process_target('platform_contact_reveals', 'actor_context_id');
CALL annex_m3_process_target('platform_export_requests', 'requested_in_context_id');
CALL annex_m3_process_target('platform_idempotency_keys', 'operating_context_id');
CALL annex_m3_process_target('agent_assignments', 'authorizing_context_id');

DROP PROCEDURE annex_m3_process_target;
DROP VIEW annex_m3_context_candidates_v;
