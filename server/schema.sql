CREATE DATABASE IF NOT EXISTS gomrok CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gomrok;

CREATE TABLE IF NOT EXISTS drivers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'platform',
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(120) NOT NULL,
  national_id CHAR(10) NOT NULL,
  phone VARCHAR(16) NOT NULL,
  province VARCHAR(80) NOT NULL,
  city VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  kyc_state VARCHAR(24) NOT NULL DEFAULT 'pending',
  passport_state VARCHAR(24) NOT NULL DEFAULT 'pending',
  license_state VARCHAR(24) NOT NULL DEFAULT 'pending',
  driver_card_state VARCHAR(24) NOT NULL DEFAULT 'pending',
  availability_state VARCHAR(24) NOT NULL DEFAULT 'available',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_drivers_national_id (national_id),
  UNIQUE KEY uq_drivers_phone (phone),
  KEY idx_drivers_tenant_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  driver_id BIGINT UNSIGNED NOT NULL,
  device_id VARCHAR(180) NOT NULL,
  platform VARCHAR(24) NOT NULL DEFAULT 'web-mobile',
  app_version VARCHAR(40) NULL,
  integrity_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  last_seen_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_driver_device (tenant_id, driver_id, device_id),
  KEY idx_driver_devices_active (tenant_id, driver_id, status, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  driver_id BIGINT UNSIGNED NOT NULL,
  doc_type VARCHAR(64) NOT NULL,
  version_no INT NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'SUBMITTED',
  sensitivity VARCHAR(8) NOT NULL DEFAULT 'P2',
  expires_at DATETIME NULL,
  file_ref VARCHAR(500) NOT NULL,
  file_hash CHAR(64) NOT NULL,
  metadata_json JSON NULL,
  locked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_driver_document_version (tenant_id, driver_id, doc_type, version_no),
  KEY idx_driver_document_state (tenant_id, driver_id, doc_type, state, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carriers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'platform',
  carrier_type VARCHAR(64) NOT NULL DEFAULT 'باربری',
  business_name VARCHAR(180) NOT NULL,
  registration_number VARCHAR(32) NULL,
  manager_first_name VARCHAR(80) NOT NULL,
  manager_last_name VARCHAR(120) NOT NULL,
  identity_number VARCHAR(16) NOT NULL,
  phone VARCHAR(16) NOT NULL,
  email VARCHAR(180) NULL,
  province VARCHAR(80) NOT NULL,
  city VARCHAR(100) NOT NULL,
  address VARCHAR(500) NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_carriers_identity_number (identity_number),
  UNIQUE KEY uq_carriers_phone (phone),
  KEY idx_carriers_tenant_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS registration_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'platform',
  role VARCHAR(20) NOT NULL,
  first_name VARCHAR(80) NULL,
  last_name VARCHAR(120) NULL,
  national_id CHAR(10) NULL,
  phone VARCHAR(16) NOT NULL,
  province VARCHAR(80) NOT NULL,
  business_name VARCHAR(180) NULL,
  registration_number VARCHAR(32) NULL,
  national_identifier VARCHAR(16) NULL,
  manager_name VARCHAR(180) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  account_id BIGINT UNSIGNED NULL,
  account_created_at DATETIME NULL,
  approved_at DATETIME NULL,
  approved_by VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_registration_role_status (role, status, created_at),
  KEY idx_registration_phone (phone),
  KEY idx_registration_account (role, account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id BIGINT UNSIGNED NULL,
  tenant_id VARCHAR(64) NULL,
  organization_id VARCHAR(128) NULL,
  event_type VARCHAR(80) NOT NULL,
  subject_type VARCHAR(80) NOT NULL,
  subject_id BIGINT UNSIGNED NULL,
  payload_json JSON NULL,
  correlation_id VARCHAR(128) NULL,
  event_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_subject (subject_type, subject_id),
  KEY idx_audit_actor_time (actor_id, created_at),
  KEY idx_audit_tenant_time (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  crm_scope ENUM('L1', 'L2') NOT NULL,
  name VARCHAR(180) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'Lead',
  owner_user_id BIGINT UNSIGNED NULL,
  last_interaction_at DATETIME NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_crm_accounts_tenant_owner_status (tenant_id, owner_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_activities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  account_id BIGINT UNSIGNED NULL,
  actor_id BIGINT UNSIGNED NULL,
  channel VARCHAR(32) NOT NULL,
  body TEXT NOT NULL,
  occurred_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_crm_activities_tenant_time (tenant_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  account_id BIGINT UNSIGNED NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'medium',
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  subject VARCHAR(220) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_crm_tickets_tenant_status (tenant_id, status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_organizations (
  id VARCHAR(128) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  organization_type VARCHAR(40) NOT NULL,
  display_name VARCHAR(180) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  qualification_state VARCHAR(40) NOT NULL DEFAULT 'pending',
  country_scope JSON NULL,
  cargo_scope JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_platform_org_tenant_type (tenant_id, organization_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  external_type VARCHAR(32) NOT NULL,
  external_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(180) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_platform_user_external (tenant_id, external_type, external_id),
  KEY idx_platform_users_tenant_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS organization_memberships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(128) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(64) NOT NULL,
  transaction_role VARCHAR(64) NULL,
  route_scope JSON NULL,
  country_scope JSON NULL,
  cargo_scope JSON NULL,
  delegation_json JSON NULL,
  qualification_state VARCHAR(40) NOT NULL DEFAULT 'pending',
  kyc_level VARCHAR(24) NOT NULL DEFAULT 'basic',
  contract_state VARCHAR(32) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_membership_org_user_role (organization_id, user_id, role),
  KEY idx_membership_tenant_user (tenant_id, user_id, status),
  KEY idx_membership_org_role (organization_id, role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipment_cases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_number VARCHAR(48) NOT NULL,
  owner_org_id VARCHAR(128) NOT NULL,
  x_org_id VARCHAR(128) NULL,
  y_org_id VARCHAR(128) NULL,
  x_award_accepted_at DATETIME NULL,
  x_award_accepted_by BIGINT UNSIGNED NULL,
  direction VARCHAR(16) NOT NULL DEFAULT 'EXPORT',
  state VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  commercial_state VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  import_state VARCHAR(40) NULL,
  capacity_state VARCHAR(40) NULL,
  loading_state VARCHAR(40) NULL,
  customs_state VARCHAR(40) NULL,
  tir_state VARCHAR(40) NOT NULL DEFAULT 'NOT_APPLICABLE',
  tir_metadata_json JSON NULL,
  trip_state VARCHAR(40) NULL,
  delivery_state VARCHAR(40) NULL,
  financial_state VARCHAR(40) NULL,
  origin_country VARCHAR(80) NULL,
  destination_country VARCHAR(80) NULL,
  origin_location VARCHAR(180) NULL,
  destination_location VARCHAR(180) NULL,
  cargo_type VARCHAR(80) NULL,
  cargo_description VARCHAR(500) NULL,
  cargo_weight DECIMAL(18,3) NULL,
  cargo_weight_unit VARCHAR(12) NULL,
  deadline_at DATETIME NULL,
  risk_flags JSON NULL,
  payload_json JSON NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shipment_case_number (case_number),
  KEY idx_shipment_tenant_owner_state (tenant_id, owner_org_id, commercial_state),
  KEY idx_shipment_tenant_parties (tenant_id, x_org_id, y_org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_contracts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  version_no INT NOT NULL,
  contract_type VARCHAR(40) NOT NULL DEFAULT 'customer_x',
  state VARCHAR(32) NOT NULL DEFAULT 'AWAITING_SIGNATURE',
  customer_org_id VARCHAR(128) NOT NULL,
  x_org_id VARCHAR(128) NOT NULL,
  role_lock VARCHAR(64) NOT NULL DEFAULT 'company_x',
  snapshot_json JSON NOT NULL,
  document_hash CHAR(64) NULL,
  signed_by_customer_user_id BIGINT UNSIGNED NULL,
  signed_at DATETIME NULL,
  signed_by_x_user_id BIGINT UNSIGNED NULL,
  x_signed_at DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contract_version (tenant_id, case_id, contract_type, version_no),
  KEY idx_contract_case_state (tenant_id, case_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rfq_books (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  level VARCHAR(8) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  publisher_org_id VARCHAR(128) NOT NULL,
  deadline_at DATETIME NOT NULL,
  awarded_org_id VARCHAR(128) NULL,
  awarded_by_user_id BIGINT UNSIGNED NULL,
  award_reason VARCHAR(500) NULL,
  awarded_at DATETIME NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rfq_case_level (case_id, level),
  KEY idx_rfq_tenant_level_state (tenant_id, level, state, deadline_at),
  KEY idx_rfq_publisher (publisher_org_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rfq_quotes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  rfq_id BIGINT UNSIGNED NOT NULL,
  bidder_org_id VARCHAR(128) NOT NULL,
  bidder_user_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  terms_json JSON NULL,
  internal_pricing_json JSON NULL,
  qualification_state VARCHAR(40) NOT NULL DEFAULT 'qualified',
  state VARCHAR(24) NOT NULL DEFAULT 'SUBMITTED',
  is_ai_assisted TINYINT(1) NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rfq_bidder (rfq_id, bidder_org_id),
  KEY idx_quote_tenant_bidder (tenant_id, bidder_org_id, submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  owner_org_id VARCHAR(128) NOT NULL,
  plate_number VARCHAR(32) NOT NULL,
  cargo_scope JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  vehicle_type VARCHAR(80) NULL,
  capacity DECIMAL(18,3) NULL,
  reefer_capable TINYINT(1) NOT NULL DEFAULT 0,
  special_capability VARCHAR(180) NULL,
  owner_relation VARCHAR(80) NULL,
  insurance_json JSON NULL,
  technical_docs_json JSON NULL,
  route_permits_json JSON NULL,
  availability_state VARCHAR(24) NOT NULL DEFAULT 'available',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicle_tenant_plate (tenant_id, plate_number),
  KEY idx_vehicle_owner_status (owner_org_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carrier_driver_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  y_org_id VARCHAR(128) NOT NULL,
  driver_id BIGINT UNSIGNED NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'active',
  valid_from DATETIME NULL,
  valid_to DATETIME NULL,
  route_scope JSON NULL,
  supporting_docs_json JSON NULL,
  vehicle_id BIGINT UNSIGNED NULL,
  introduced_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_carrier_driver_assignment (tenant_id, y_org_id, driver_id),
  KEY idx_driver_assignment_driver (tenant_id, driver_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_internal_bids (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  rfq_id BIGINT UNSIGNED NOT NULL,
  driver_id BIGINT UNSIGNED NOT NULL,
  y_org_id VARCHAR(128) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  terms_json JSON NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'SUBMITTED',
  undertaking_version VARCHAR(64) NULL,
  submitted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_driver_internal_bid (tenant_id, rfq_id, driver_id, y_org_id),
  KEY idx_driver_internal_bid_driver (tenant_id, driver_id, state, updated_at),
  KEY idx_driver_internal_bid_rfq (tenant_id, rfq_id, y_org_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trip_cases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  x_org_id VARCHAR(128) NOT NULL,
  y_org_id VARCHAR(128) NOT NULL,
  y_award_accepted_at DATETIME NULL,
  y_award_accepted_by BIGINT UNSIGNED NULL,
  driver_id BIGINT UNSIGNED NULL,
  vehicle_id BIGINT UNSIGNED NULL,
  authorized_agent_org_id VARCHAR(128) NULL,
  state VARCHAR(40) NOT NULL DEFAULT 'DISPATCHED',
  tracking_state VARCHAR(24) NOT NULL DEFAULT 'INACTIVE',
  readiness_json JSON NULL,
  last_location_json JSON NULL,
  last_location_at DATETIME NULL,
  eta_at DATETIME NULL,
  last_milestone VARCHAR(120) NULL,
  delay_flags JSON NULL,
  loading_schedule_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trip_case (case_id),
  KEY idx_trip_tenant_parties (tenant_id, x_org_id, y_org_id),
  KEY idx_trip_driver_state (driver_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_trip_acceptances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  trip_id BIGINT UNSIGNED NOT NULL,
  driver_id BIGINT UNSIGNED NOT NULL,
  coverage_id BIGINT UNSIGNED NULL,
  undertaking_version VARCHAR(64) NOT NULL,
  device_id VARCHAR(180) NOT NULL,
  accepted_by_user_id BIGINT UNSIGNED NOT NULL,
  accepted_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_driver_trip_acceptance (tenant_id, trip_id, driver_id),
  KEY idx_driver_acceptance_driver (tenant_id, driver_id, accepted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_delivery_otps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  trip_id BIGINT UNSIGNED NOT NULL,
  driver_id BIGINT UNSIGNED NOT NULL,
  challenge_hash CHAR(64) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'SENT',
  attempts INT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  verified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_driver_otp_challenge (tenant_id, challenge_hash),
  KEY idx_driver_otp_trip (tenant_id, trip_id, driver_id, state, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  agent_org_id VARCHAR(128) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  device_id VARCHAR(180) NOT NULL,
  platform VARCHAR(24) NOT NULL DEFAULT 'web',
  app_version VARCHAR(40) NULL,
  integrity_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  last_seen_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_device (tenant_id, agent_org_id, device_id),
  KEY idx_agent_device_user (tenant_id, agent_org_id, user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  trip_id BIGINT UNSIGNED NOT NULL,
  agent_org_id VARCHAR(128) NOT NULL,
  assigned_by_org_id VARCHAR(128) NOT NULL,
  authority_ref VARCHAR(160) NOT NULL,
  authority_document_id BIGINT UNSIGNED NULL,
  valid_from DATETIME NOT NULL,
  valid_to DATETIME NULL,
  scope_json JSON NULL,
  permitted_actions_json JSON NULL,
  reporting_org_id VARCHAR(128) NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  verified_by_user_id BIGINT UNSIGNED NULL,
  verified_at DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_assignment_scope (tenant_id, agent_org_id, state, valid_to),
  KEY idx_agent_assignment_trip (tenant_id, trip_id, agent_org_id, created_at),
  KEY idx_agent_assignment_case (tenant_id, case_id, agent_org_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_delivery_verifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  trip_id BIGINT UNSIGNED NOT NULL,
  assignment_id BIGINT UNSIGNED NOT NULL,
  version_no INT NOT NULL,
  outcome VARCHAR(24) NOT NULL,
  verification_json JSON NOT NULL,
  device_ref VARCHAR(180) NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  actor_org_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_verification_version (tenant_id, trip_id, version_no),
  KEY idx_agent_verification_trip (tenant_id, trip_id, outcome, created_at),
  KEY idx_agent_verification_assignment (tenant_id, assignment_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_delivery_otps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  trip_id BIGINT UNSIGNED NOT NULL,
  assignment_id BIGINT UNSIGNED NOT NULL,
  challenge_hash CHAR(64) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  recipient_ref VARCHAR(180) NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'SENT',
  attempts INT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  verified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_otp_challenge (tenant_id, challenge_hash),
  KEY idx_agent_otp_trip (tenant_id, trip_id, assignment_id, state, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_trip_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  trip_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  location_json JSON NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trip_events_trip_time (trip_id, created_at),
  KEY idx_trip_events_tenant_type (tenant_id, event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NULL,
  trip_id BIGINT UNSIGNED NULL,
  doc_type VARCHAR(64) NOT NULL,
  owner_org_id VARCHAR(128) NOT NULL,
  uploader_user_id BIGINT UNSIGNED NULL,
  approver_user_id BIGINT UNSIGNED NULL,
  version_no INT NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  sensitivity VARCHAR(8) NOT NULL DEFAULT 'P1',
  deadline_at DATETIME NULL,
  file_ref VARCHAR(500) NOT NULL,
  file_hash CHAR(64) NOT NULL,
  metadata_json JSON NULL,
  locked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_document_version (tenant_id, case_id, trip_id, doc_type, version_no),
  KEY idx_document_scope (tenant_id, case_id, trip_id, doc_type, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pod_cases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  trip_id BIGINT UNSIGNED NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'SUBMITTED',
  submitted_by_user_id BIGINT UNSIGNED NOT NULL,
  recipient_org_id VARCHAR(128) NOT NULL,
  authority_ref VARCHAR(160) NOT NULL,
  otp_verified TINYINT(1) NOT NULL DEFAULT 0,
  evidence_json JSON NOT NULL,
  evidence_version_no INT NOT NULL DEFAULT 1,
  risk_flags_json JSON NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pod_trip (trip_id),
  KEY idx_pod_tenant_state (tenant_id, state, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pod_evidence_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  pod_id BIGINT UNSIGNED NOT NULL,
  version_no INT NOT NULL,
  evidence_json JSON NOT NULL,
  submitted_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pod_evidence_version (tenant_id, pod_id, version_no),
  KEY idx_pod_evidence_history (tenant_id, pod_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS relationship_ledgers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  trip_id BIGINT UNSIGNED NULL,
  relationship_type VARCHAR(40) NOT NULL,
  payer_org_id VARCHAR(128) NOT NULL,
  payee_org_id VARCHAR(128) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  state VARCHAR(32) NOT NULL DEFAULT 'SETTLEMENT_PENDING',
  evidence_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ledger_relationship (tenant_id, relationship_type, payer_org_id, payee_org_id),
  KEY idx_ledger_case_state (case_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  trip_id BIGINT UNSIGNED NULL,
  case_type VARCHAR(24) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  reason VARCHAR(1000) NOT NULL,
  evidence_json JSON NULL,
  opened_by_user_id BIGINT UNSIGNED NOT NULL,
  opened_by_org_id VARCHAR(128) NOT NULL,
  timing_warning TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_claim_tenant_case (tenant_id, case_id, case_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trip_loading_evidence (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  trip_id BIGINT UNSIGNED NOT NULL,
  evidence_type VARCHAR(48) NOT NULL,
  owner_org_id VARCHAR(128) NOT NULL,
  uploader_user_id BIGINT UNSIGNED NULL,
  device_ref VARCHAR(160) NULL,
  occurred_at DATETIME NULL,
  geo_json JSON NULL,
  file_ref VARCHAR(500) NULL,
  file_hash CHAR(64) NULL,
  metadata_json JSON NULL,
  mismatch_flag TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_loading_evidence_trip_time (tenant_id, trip_id, created_at),
  KEY idx_loading_evidence_type (tenant_id, trip_id, evidence_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trip_loading_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  trip_id BIGINT UNSIGNED NOT NULL,
  version_no INT NOT NULL,
  schedule_json JSON NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_loading_schedule_version (tenant_id, trip_id, version_no),
  KEY idx_loading_schedule_trip (tenant_id, trip_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_exceptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  trip_id BIGINT UNSIGNED NULL,
  exception_type VARCHAR(64) NOT NULL,
  severity VARCHAR(24) NOT NULL DEFAULT 'medium',
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  reason VARCHAR(1000) NOT NULL,
  evidence_json JSON NULL,
  opened_by_user_id BIGINT UNSIGNED NOT NULL,
  opened_by_org_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_exception_case_status (tenant_id, case_id, status, created_at),
  KEY idx_exception_trip_status (tenant_id, trip_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_domain_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  event_name VARCHAR(80) NOT NULL,
  event_version INT NOT NULL DEFAULT 1,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  correlation_id VARCHAR(128) NULL,
  payload_json JSON NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_domain_events_tenant_time (tenant_id, occurred_at),
  KEY idx_domain_events_entity (entity_type, entity_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  event_id BIGINT UNSIGNED NULL,
  recipient_org_id VARCHAR(128) NULL,
  recipient_user_id BIGINT UNSIGNED NULL,
  channel VARCHAR(24) NOT NULL DEFAULT 'in_app',
  state VARCHAR(24) NOT NULL DEFAULT 'pending',
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_notification_recipient (tenant_id, recipient_org_id, state, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_contact_reveals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  organization_id VARCHAR(128) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contact_reveal_actor_time (tenant_id, actor_user_id, created_at),
  KEY idx_contact_reveal_case_active (case_id, organization_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_export_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  organization_id VARCHAR(128) NOT NULL,
  crm_scope VARCHAR(8) NOT NULL,
  purpose VARCHAR(500) NOT NULL,
  scope_json JSON NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  executed_by_user_id BIGINT UNSIGNED NULL,
  executed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_export_tenant_state (tenant_id, organization_id, state, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_idempotency_keys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  route VARCHAR(180) NOT NULL,
  status_code SMALLINT NULL,
  response_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_idempotency_actor_key (tenant_id, actor_user_id, idempotency_key),
  KEY idx_idempotency_created (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_refresh_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  membership_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  rotated_to_hash CHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_token_hash (token_hash),
  KEY idx_refresh_user_active (tenant_id, user_id, revoked_at, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_governance_cases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  case_type VARCHAR(32) NOT NULL,
  subject_tenant_id VARCHAR(64) NULL,
  subject_org_id VARCHAR(128) NULL,
  subject_type VARCHAR(64) NULL,
  subject_id VARCHAR(128) NULL,
  signal VARCHAR(120) NOT NULL,
  severity VARCHAR(24) NOT NULL DEFAULT 'medium',
  score DECIMAL(8,3) NULL,
  source VARCHAR(120) NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  reason VARCHAR(1000) NOT NULL,
  evidence_json JSON NULL,
  reviewer_user_id BIGINT UNSIGNED NULL,
  outcome VARCHAR(500) NULL,
  remediation VARCHAR(1000) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_case_queue (tenant_id, case_type, state, severity, created_at),
  KEY idx_admin_case_subject (tenant_id, subject_org_id, subject_type, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_break_glass_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  requester_user_id BIGINT UNSIGNED NOT NULL,
  requester_org_id VARCHAR(128) NOT NULL,
  target_tenant_id VARCHAR(64) NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(128) NULL,
  scope_json JSON NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  incident_ref VARCHAR(160) NOT NULL,
  duration_minutes INT NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  expires_at DATETIME NULL,
  revoked_by_user_id BIGINT UNSIGNED NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_break_glass_queue (tenant_id, state, created_at),
  KEY idx_break_glass_actor (tenant_id, requester_user_id, state, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_rulepacks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  rule_key VARCHAR(120) NOT NULL,
  version_no INT NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  level VARCHAR(8) NOT NULL,
  source_type VARCHAR(8) NOT NULL,
  source_ref VARCHAR(500) NOT NULL,
  valid_from DATETIME NULL,
  valid_to DATETIME NULL,
  route_scope JSON NULL,
  cargo_scope JSON NULL,
  rules_json JSON NOT NULL,
  hard_gate TINYINT(1) NOT NULL DEFAULT 0,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  activated_at DATETIME NULL,
  superseded_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_rulepack_version (tenant_id, rule_key, version_no),
  KEY idx_admin_rulepack_state (tenant_id, state, level, valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_pricing_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  policy_key VARCHAR(120) NOT NULL,
  version_no INT NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  allowed_components_json JSON NOT NULL,
  platform_fee_json JSON NULL,
  rate_range_json JSON NULL,
  fx_source_json JSON NULL,
  valid_until_rules_json JSON NULL,
  outlier_policy_json JSON NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  activated_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_pricing_policy_version (tenant_id, policy_key, version_no),
  KEY idx_admin_pricing_policy_state (tenant_id, state, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_notification_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  policy_key VARCHAR(100) NOT NULL,
  label VARCHAR(180) NOT NULL,
  severity VARCHAR(24) NOT NULL DEFAULT 'medium',
  critical TINYINT(1) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  channels_json JSON NULL,
  rate_limit_json JSON NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_notification_policy (tenant_id, policy_key),
  KEY idx_admin_notification_policy_state (tenant_id, critical, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_integration_endpoints (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  endpoint_name VARCHAR(160) NOT NULL,
  endpoint_url VARCHAR(500) NOT NULL,
  events_json JSON NULL,
  hmac_state VARCHAR(24) NOT NULL DEFAULT 'configured',
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  retry_count INT NOT NULL DEFAULT 0,
  last_delivery_at DATETIME NULL,
  last_failure_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_integration_endpoint (tenant_id, endpoint_name),
  KEY idx_admin_integration_state (tenant_id, status, hmac_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_ai_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  use_case VARCHAR(120) NOT NULL,
  model_version VARCHAR(120) NOT NULL,
  prompt_version VARCHAR(120) NULL,
  latency_ms INT NULL,
  cost_minor_units DECIMAL(18,6) NULL,
  error_rate DECIMAL(8,5) NULL,
  quality_score DECIMAL(8,5) NULL,
  source_status VARCHAR(32) NULL,
  human_override TINYINT(1) NOT NULL DEFAULT 0,
  budget_state VARCHAR(24) NOT NULL DEFAULT 'OK',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_ai_runs_case_time (tenant_id, use_case, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_notification_policies (tenant_id, policy_key, label, severity, critical, enabled, channels_json)
VALUES
  ('platform', 'COMPLIANCE_BLOCK', 'Compliance Block', 'critical', 1, 1, JSON_ARRAY('in_app', 'email')),
  ('platform', 'SECURITY_INCIDENT', 'Security Incident', 'critical', 1, 1, JSON_ARRAY('in_app', 'email')),
  ('platform', 'GPS_CRITICAL', 'Critical GPS Exception', 'high', 1, 1, JSON_ARRAY('in_app')),
  ('platform', 'POD_INCOMPLETE', 'POD Evidence Incomplete', 'high', 0, 1, JSON_ARRAY('in_app'))
ON DUPLICATE KEY UPDATE policy_key = VALUES(policy_key);
