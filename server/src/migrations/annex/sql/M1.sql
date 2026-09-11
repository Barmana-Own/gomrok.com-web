ALTER TABLE platform_organizations
  ADD UNIQUE KEY uq_platform_org_tenant_id (tenant_id, id);

CREATE TABLE operating_contexts (
  context_id VARCHAR(128) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(128) NOT NULL,
  role_grant_id BIGINT UNSIGNED NULL,
  context_type VARCHAR(8) NOT NULL,
  data_partition_key VARCHAR(160) NOT NULL,
  ledger_id VARCHAR(128) NULL,
  display_color VARCHAR(16) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (context_id),
  UNIQUE KEY uq_operating_context_org_type
    (tenant_id, organization_id, context_type),
  UNIQUE KEY uq_operating_context_partition
    (tenant_id, data_partition_key),
  UNIQUE KEY uq_operating_context_ledger
    (tenant_id, ledger_id),
  KEY idx_operating_context_org_status
    (tenant_id, organization_id, status),
  CONSTRAINT fk_operating_context_organization
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES platform_organizations (tenant_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_operating_context_type
    CHECK (context_type IN ('FWD', 'CAR')),
  CONSTRAINT chk_operating_context_status
    CHECK (status IN ('pending', 'active', 'suspended', 'archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- M1 creates only pending operational boundaries. It does not infer a legal
-- permit, activate a context, or create a ledger. The deterministic identifiers
-- make the initial backfill auditable. Retry/recovery remains a runner gate.
INSERT INTO operating_contexts
  (context_id, tenant_id, organization_id, role_grant_id, context_type,
   data_partition_key, ledger_id, display_color, status)
SELECT
  CONCAT('ctx:', LOWER(SHA2(CONCAT(candidate.tenant_id, CHAR(31), candidate.organization_id, CHAR(31), candidate.context_type), 256))),
  candidate.tenant_id,
  candidate.organization_id,
  NULL,
  candidate.context_type,
  CONCAT('partition:', LOWER(SHA2(CONCAT(candidate.tenant_id, CHAR(31), candidate.organization_id, CHAR(31), candidate.context_type), 256))),
  NULL,
  NULL,
  'pending'
FROM (
  SELECT tenant_id, id AS organization_id, 'FWD' AS context_type
  FROM platform_organizations
  WHERE organization_type = 'company_x'

  UNION

  SELECT tenant_id, id AS organization_id, 'CAR' AS context_type
  FROM platform_organizations
  WHERE organization_type = 'company_y'

  UNION

  SELECT m.tenant_id, m.organization_id, 'FWD' AS context_type
  FROM organization_memberships m
  WHERE LEFT(m.role, 10) = 'company_x_'

  UNION

  SELECT m.tenant_id, m.organization_id, 'CAR' AS context_type
  FROM organization_memberships m
  WHERE LEFT(m.role, 10) = 'company_y_'
) AS candidate;
