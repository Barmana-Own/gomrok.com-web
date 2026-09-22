CREATE TABLE organization_role_grants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL,
  permit_no VARCHAR(120) NULL,
  permit_type VARCHAR(80) NULL,
  issuing_authority VARCHAR(180) NULL,
  valid_from DATETIME NULL,
  valid_to DATETIME NULL,
  evidence_level VARCHAR(2) NOT NULL DEFAULT 'E0',
  route_scope JSON NULL,
  cargo_scope JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  legacy_source_ref VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_org_role_grant_identity
    (tenant_id, organization_id, role, permit_type, permit_no, valid_from),
  UNIQUE KEY uq_org_role_grant_legacy_source
    (tenant_id, organization_id, role, legacy_source_ref),
  UNIQUE KEY uq_org_role_grant_scope (id, tenant_id, organization_id),
  KEY idx_org_role_grant_effective
    (tenant_id, organization_id, role, status, valid_from, valid_to),
  CONSTRAINT fk_org_role_grant_organization
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES platform_organizations (tenant_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_org_role_grant_role
    CHECK (role IN ('FORWARDER', 'CARRIER')),
  CONSTRAINT chk_org_role_grant_evidence
    CHECK (evidence_level IN ('E0', 'E1', 'E2', 'E3')),
  CONSTRAINT chk_org_role_grant_status
    CHECK (status IN ('pending', 'active', 'suspended', 'expired', 'revoked')),
  CONSTRAINT chk_org_role_grant_validity
    CHECK (
      (valid_from IS NULL AND valid_to IS NULL)
      OR (valid_from IS NOT NULL AND (valid_to IS NULL OR valid_to > valid_from))
    ),
  CONSTRAINT chk_org_role_grant_active_evidence
    CHECK (
      status <> 'active'
      OR (
        permit_no IS NOT NULL AND CHAR_LENGTH(TRIM(permit_no)) > 0
        AND permit_type IS NOT NULL AND CHAR_LENGTH(TRIM(permit_type)) > 0
        AND issuing_authority IS NOT NULL AND CHAR_LENGTH(TRIM(issuing_authority)) > 0
        AND valid_from IS NOT NULL
      )
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing organization/application-role evidence is not a legal permit.
-- M2 preserves that observation as E0/pending and leaves all permit fields null.
INSERT INTO organization_role_grants
  (tenant_id, organization_id, role, permit_no, permit_type, issuing_authority,
   valid_from, valid_to, evidence_level, route_scope, cargo_scope, status,
   legacy_source_ref)
SELECT
  c.tenant_id,
  c.organization_id,
  CASE c.context_type WHEN 'FWD' THEN 'FORWARDER' ELSE 'CARRIER' END,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'E0',
  NULL,
  NULL,
  'pending',
  CONCAT('M1:', c.context_id)
FROM operating_contexts c
WHERE c.role_grant_id IS NULL;

UPDATE operating_contexts c
JOIN organization_role_grants g
  ON g.tenant_id = c.tenant_id
 AND g.organization_id = c.organization_id
 AND g.role = CASE c.context_type WHEN 'FWD' THEN 'FORWARDER' ELSE 'CARRIER' END
 AND g.legacy_source_ref = CONCAT('M1:', c.context_id)
SET c.role_grant_id = g.id
WHERE c.role_grant_id IS NULL;

ALTER TABLE operating_contexts
  MODIFY COLUMN role_grant_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_operating_context_role_grant (role_grant_id),
  ADD UNIQUE KEY uq_operating_context_scope
    (tenant_id, organization_id, context_id),
  ADD CONSTRAINT fk_operating_context_role_grant
    FOREIGN KEY (role_grant_id, tenant_id, organization_id)
    REFERENCES organization_role_grants (id, tenant_id, organization_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE platform_users
  ADD UNIQUE KEY uq_platform_user_tenant_id (tenant_id, id);

ALTER TABLE organization_memberships
  ADD UNIQUE KEY uq_membership_tenant_user_id (tenant_id, user_id, id),
  ADD UNIQUE KEY uq_membership_context_scope
    (tenant_id, user_id, organization_id, id);

CREATE TABLE membership_operating_contexts (
  tenant_id VARCHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  organization_id VARCHAR(128) NOT NULL,
  membership_id BIGINT UNSIGNED NOT NULL,
  context_id VARCHAR(128) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, user_id, context_id),
  UNIQUE KEY uq_membership_context_binding
    (tenant_id, user_id, organization_id, membership_id, context_id),
  KEY idx_membership_context_membership
    (tenant_id, membership_id, status),
  KEY idx_membership_context_context
    (tenant_id, organization_id, context_id, status),
  CONSTRAINT fk_member_context_membership
    FOREIGN KEY (tenant_id, user_id, organization_id, membership_id)
    REFERENCES organization_memberships (tenant_id, user_id, organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_member_context_context
    FOREIGN KEY (tenant_id, organization_id, context_id)
    REFERENCES operating_contexts (tenant_id, organization_id, context_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_membership_context_status
    CHECK (status IN ('pending', 'active', 'suspended', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Membership mappings are staged as pending. Qualification review must activate
-- the grant, context, and mapping explicitly; this migration grants no access.
INSERT INTO membership_operating_contexts
  (tenant_id, user_id, organization_id, membership_id, context_id, status)
SELECT
  m.tenant_id,
  m.user_id,
  m.organization_id,
  m.id,
  c.context_id,
  'pending'
FROM organization_memberships m
JOIN operating_contexts c
  ON c.tenant_id = m.tenant_id
 AND c.organization_id = m.organization_id
 AND c.context_type = CASE
   WHEN LEFT(m.role, 10) = 'company_x_' THEN 'FWD'
   WHEN LEFT(m.role, 10) = 'company_y_' THEN 'CAR'
 END
WHERE LEFT(m.role, 10) IN ('company_x_', 'company_y_');

CREATE TABLE platform_sessions (
  session_id CHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  origin_membership_id BIGINT UNSIGNED NOT NULL,
  active_membership_id BIGINT UNSIGNED NULL,
  active_organization_id VARCHAR(128) NULL,
  active_context_id VARCHAR(128) NULL,
  generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  session_mode VARCHAR(16) NOT NULL DEFAULT 'bootstrap',
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  expires_at DATETIME NOT NULL,
  last_switched_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id),
  UNIQUE KEY uq_platform_session_scope (session_id, tenant_id, user_id),
  KEY idx_platform_session_user
    (tenant_id, user_id, status, expires_at),
  KEY idx_platform_session_context
    (tenant_id, active_organization_id, active_context_id, status),
  CONSTRAINT fk_platform_session_user
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES platform_users (tenant_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_platform_session_origin_membership
    FOREIGN KEY (tenant_id, user_id, origin_membership_id)
    REFERENCES organization_memberships (tenant_id, user_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_platform_session_active_context
    FOREIGN KEY (
      tenant_id, user_id, active_organization_id, active_membership_id, active_context_id
    ) REFERENCES membership_operating_contexts (
      tenant_id, user_id, organization_id, membership_id, context_id
    ) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_platform_session_mode
    CHECK (session_mode IN ('bootstrap', 'context')),
  CONSTRAINT chk_platform_session_status
    CHECK (status IN ('active', 'revoked', 'expired')),
  CONSTRAINT chk_platform_session_generation
    CHECK (generation >= 0),
  CONSTRAINT chk_platform_session_binding
    CHECK (
      (session_mode = 'bootstrap'
        AND active_membership_id IS NULL
        AND active_organization_id IS NULL
        AND active_context_id IS NULL)
      OR
      (session_mode = 'context'
        AND active_membership_id IS NOT NULL
        AND active_organization_id IS NOT NULL
        AND active_context_id IS NOT NULL
        AND generation > 0)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE platform_refresh_tokens
  ADD COLUMN session_id CHAR(64) NULL AFTER rotated_to_hash,
  ADD COLUMN session_generation BIGINT UNSIGNED NULL AFTER session_id,
  ADD KEY idx_refresh_session_generation
    (session_id, session_generation, revoked_at, expires_at),
  ADD CONSTRAINT fk_refresh_platform_session
    FOREIGN KEY (session_id)
    REFERENCES platform_sessions (session_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT chk_refresh_session_binding
    CHECK (
      (session_id IS NULL AND session_generation IS NULL)
      OR (session_id IS NOT NULL AND session_generation IS NOT NULL)
    );
