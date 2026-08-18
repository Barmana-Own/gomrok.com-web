import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import 'dotenv/config';

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true
});

try {
  const schema = await fs.readFile(path.resolve('schema.sql'), 'utf8');
  await connection.query(schema);

  try {
    await connection.query('ALTER TABLE gomrok.carriers ADD COLUMN registration_number VARCHAR(32) NULL AFTER business_name');
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  }

  for (const statement of [
    'ALTER TABLE gomrok.audit_events ADD COLUMN tenant_id VARCHAR(64) NULL AFTER actor_id',
    'ALTER TABLE gomrok.audit_events ADD COLUMN organization_id VARCHAR(128) NULL AFTER tenant_id',
    'ALTER TABLE gomrok.audit_events ADD COLUMN correlation_id VARCHAR(128) NULL AFTER payload_json',
    'ALTER TABLE gomrok.audit_events ADD COLUMN event_version INT NOT NULL DEFAULT 1 AFTER correlation_id',
    'ALTER TABLE gomrok.organization_memberships ADD COLUMN delegation_json JSON NULL AFTER cargo_scope',
    'ALTER TABLE gomrok.shipment_cases ADD COLUMN x_award_accepted_at DATETIME NULL AFTER y_org_id',
    'ALTER TABLE gomrok.shipment_cases ADD COLUMN x_award_accepted_by BIGINT UNSIGNED NULL AFTER x_award_accepted_at',
    'ALTER TABLE gomrok.shipment_cases ADD COLUMN tir_metadata_json JSON NULL AFTER tir_state',
    'ALTER TABLE gomrok.trip_cases ADD COLUMN eta_at DATETIME NULL AFTER last_location_at',
    'ALTER TABLE gomrok.trip_cases ADD COLUMN last_milestone VARCHAR(120) NULL AFTER eta_at',
    'ALTER TABLE gomrok.trip_cases ADD COLUMN delay_flags JSON NULL AFTER last_milestone',
    'ALTER TABLE gomrok.trip_cases ADD COLUMN loading_schedule_json JSON NULL AFTER delay_flags',
    'ALTER TABLE gomrok.trip_cases ADD COLUMN y_award_accepted_at DATETIME NULL AFTER y_org_id',
    'ALTER TABLE gomrok.trip_cases ADD COLUMN y_award_accepted_by BIGINT UNSIGNED NULL AFTER y_award_accepted_at',
    'ALTER TABLE gomrok.platform_documents ADD COLUMN deadline_at DATETIME NULL AFTER sensitivity',
    'ALTER TABLE gomrok.platform_contracts ADD COLUMN signed_by_x_user_id BIGINT UNSIGNED NULL AFTER signed_at',
    'ALTER TABLE gomrok.platform_contracts ADD COLUMN x_signed_at DATETIME NULL AFTER signed_by_x_user_id',
    'ALTER TABLE gomrok.rfq_books ADD COLUMN metadata_json JSON NULL AFTER awarded_at',
    'ALTER TABLE gomrok.rfq_quotes ADD COLUMN internal_pricing_json JSON NULL AFTER terms_json',
    'ALTER TABLE gomrok.pod_cases ADD COLUMN evidence_version_no INT NOT NULL DEFAULT 1 AFTER evidence_json',
    'ALTER TABLE gomrok.pod_cases ADD COLUMN risk_flags_json JSON NULL AFTER evidence_version_no',
    'ALTER TABLE gomrok.drivers ADD COLUMN kyc_state VARCHAR(24) NOT NULL DEFAULT \'pending\' AFTER status',
    'ALTER TABLE gomrok.drivers ADD COLUMN passport_state VARCHAR(24) NOT NULL DEFAULT \'pending\' AFTER kyc_state',
    'ALTER TABLE gomrok.drivers ADD COLUMN license_state VARCHAR(24) NOT NULL DEFAULT \'pending\' AFTER passport_state',
    'ALTER TABLE gomrok.drivers ADD COLUMN driver_card_state VARCHAR(24) NOT NULL DEFAULT \'pending\' AFTER license_state',
    'ALTER TABLE gomrok.drivers ADD COLUMN availability_state VARCHAR(24) NOT NULL DEFAULT \'available\' AFTER driver_card_state',
    'ALTER TABLE gomrok.vehicles ADD COLUMN vehicle_type VARCHAR(80) NULL AFTER status',
    'ALTER TABLE gomrok.vehicles ADD COLUMN capacity DECIMAL(18,3) NULL AFTER vehicle_type',
    'ALTER TABLE gomrok.vehicles ADD COLUMN reefer_capable TINYINT(1) NOT NULL DEFAULT 0 AFTER capacity',
    'ALTER TABLE gomrok.vehicles ADD COLUMN special_capability VARCHAR(180) NULL AFTER reefer_capable',
    'ALTER TABLE gomrok.vehicles ADD COLUMN owner_relation VARCHAR(80) NULL AFTER special_capability',
    'ALTER TABLE gomrok.vehicles ADD COLUMN insurance_json JSON NULL AFTER owner_relation',
    'ALTER TABLE gomrok.vehicles ADD COLUMN technical_docs_json JSON NULL AFTER insurance_json',
    'ALTER TABLE gomrok.vehicles ADD COLUMN route_permits_json JSON NULL AFTER technical_docs_json',
    'ALTER TABLE gomrok.vehicles ADD COLUMN availability_state VARCHAR(24) NOT NULL DEFAULT \'available\' AFTER route_permits_json',
    'ALTER TABLE gomrok.carrier_driver_assignments ADD COLUMN valid_from DATETIME NULL AFTER state',
    'ALTER TABLE gomrok.carrier_driver_assignments ADD COLUMN valid_to DATETIME NULL AFTER valid_from',
    'ALTER TABLE gomrok.carrier_driver_assignments ADD COLUMN route_scope JSON NULL AFTER valid_to',
    'ALTER TABLE gomrok.carrier_driver_assignments ADD COLUMN supporting_docs_json JSON NULL AFTER route_scope',
    'ALTER TABLE gomrok.carrier_driver_assignments ADD COLUMN vehicle_id BIGINT UNSIGNED NULL AFTER supporting_docs_json'
  ]) {
    try {
      await connection.query(statement);
    } catch (error) {
      if (!['ER_DUP_FIELDNAME', 'ER_BAD_FIELD_ERROR'].includes(error.code)) throw error;
    }
  }

  await connection.query(`
    INSERT INTO gomrok.platform_organizations
      (id, tenant_id, organization_type, display_name, qualification_state)
    VALUES ('platform', 'platform', 'platform', 'Gomrok Platform', 'qualified')
    ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), qualification_state = VALUES(qualification_state)
  `);

  try {
    await connection.query(`
      CREATE TRIGGER audit_events_append_only
      BEFORE DELETE ON gomrok.audit_events
      FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only'
    `);
  } catch (error) {
    if (error.code !== 'ER_TRG_ALREADY_EXISTS') throw error;
  }

  // Bring accounts created by the first version of the app into the new
  // registration workspace without duplicating them on later migrations.
  await connection.query(`
    INSERT INTO registration_requests
      (tenant_id, role, first_name, last_name, national_id, phone, province,
       status, account_id, account_created_at, approved_at, approved_by, created_at, updated_at)
    SELECT d.tenant_id, 'driver', d.first_name, d.last_name, d.national_id, d.phone, d.province,
           d.status, d.id, d.created_at, d.created_at, 'legacy-migration', d.created_at, d.updated_at
    FROM drivers d
    WHERE NOT EXISTS (
      SELECT 1 FROM registration_requests r WHERE r.role = 'driver' AND r.account_id = d.id
    )
  `);

  await connection.query(`
    INSERT INTO registration_requests
      (tenant_id, role, business_name, registration_number, national_identifier,
       manager_name, phone, province, status, account_id, account_created_at,
       approved_at, approved_by, created_at, updated_at)
    SELECT c.tenant_id, 'carrier', c.business_name, NULL, c.identity_number,
           TRIM(CONCAT_WS(' ', c.manager_first_name, c.manager_last_name)), c.phone, c.province,
           c.status, c.id, c.created_at, c.created_at, 'legacy-migration', c.created_at, c.updated_at
    FROM carriers c
    WHERE NOT EXISTS (
      SELECT 1 FROM registration_requests r WHERE r.role = 'carrier' AND r.account_id = c.id
    )
  `);
  console.log('Gomrok MySQL schema is ready.');
} finally {
  await connection.end();
}
