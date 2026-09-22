-- M2 postcheck is read-only. The first result set must be empty.
SELECT severity, issue_code, resource_type, resource_id, issue_count
FROM (
  SELECT
    'BLOCKER' AS severity,
    'M2_CONTEXT_ROLE_GRANT_MISSING' AS issue_code,
    'operating_context' AS resource_type,
    c.context_id AS resource_id,
    1 AS issue_count
  FROM operating_contexts c
  LEFT JOIN organization_role_grants g
    ON g.id = c.role_grant_id
   AND g.tenant_id = c.tenant_id
   AND g.organization_id = c.organization_id
  WHERE g.id IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_CONTEXT_ROLE_GRANT_MISMATCH',
    'operating_context',
    c.context_id,
    1
  FROM operating_contexts c
  JOIN organization_role_grants g
    ON g.id = c.role_grant_id
   AND g.tenant_id = c.tenant_id
   AND g.organization_id = c.organization_id
  WHERE (c.context_type = 'FWD' AND g.role <> 'FORWARDER')
     OR (c.context_type = 'CAR' AND g.role <> 'CARRIER')

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_LEGACY_GRANT_ESCALATED',
    'organization_role_grant',
    CAST(g.id AS CHAR),
    1
  FROM organization_role_grants g
  WHERE g.legacy_source_ref LIKE 'M1:%'
    AND (
      g.evidence_level <> 'E0'
      OR g.status <> 'pending'
      OR g.permit_no IS NOT NULL
      OR g.permit_type IS NOT NULL
      OR g.issuing_authority IS NOT NULL
      OR g.valid_from IS NOT NULL
      OR g.valid_to IS NOT NULL
    )

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_MEMBERSHIP_CONTEXT_BACKFILL_MISSING',
    'membership',
    CAST(m.id AS CHAR),
    1
  FROM organization_memberships m
  LEFT JOIN membership_operating_contexts mc
    ON mc.tenant_id = m.tenant_id
   AND mc.user_id = m.user_id
   AND mc.organization_id = m.organization_id
   AND mc.membership_id = m.id
  WHERE LEFT(m.role, 10) IN ('company_x_', 'company_y_')
    AND mc.context_id IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_ACTIVE_CONTEXT_WITH_INEFFECTIVE_GRANT',
    'operating_context',
    c.context_id,
    1
  FROM operating_contexts c
  JOIN organization_role_grants g
    ON g.id = c.role_grant_id
   AND g.tenant_id = c.tenant_id
   AND g.organization_id = c.organization_id
  WHERE c.status = 'active'
    AND (
      g.status <> 'active'
      OR NULLIF(TRIM(g.permit_no), '') IS NULL
      OR NULLIF(TRIM(g.permit_type), '') IS NULL
      OR NULLIF(TRIM(g.issuing_authority), '') IS NULL
      OR g.valid_from IS NULL
      OR g.valid_from > CURRENT_TIMESTAMP
      OR (g.valid_to IS NOT NULL AND g.valid_to <= CURRENT_TIMESTAMP)
    )
) AS issues
ORDER BY issue_code, resource_type, resource_id;

SELECT role, evidence_level, status, COUNT(*) AS grant_count
FROM organization_role_grants
GROUP BY role, evidence_level, status
ORDER BY role, evidence_level, status;

SELECT c.context_type, c.status AS context_status, mc.status AS mapping_status,
       COUNT(*) AS mapping_count
FROM membership_operating_contexts mc
JOIN operating_contexts c
  ON c.tenant_id = mc.tenant_id
 AND c.organization_id = mc.organization_id
 AND c.context_id = mc.context_id
GROUP BY c.context_type, c.status, mc.status
ORDER BY c.context_type, c.status, mc.status;
