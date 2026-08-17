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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_drivers_national_id (national_id),
  UNIQUE KEY uq_drivers_phone (phone),
  KEY idx_drivers_tenant_status (tenant_id, status)
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
  event_type VARCHAR(80) NOT NULL,
  subject_type VARCHAR(80) NOT NULL,
  subject_id BIGINT UNSIGNED NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_subject (subject_type, subject_id),
  KEY idx_audit_actor_time (actor_id, created_at)
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
