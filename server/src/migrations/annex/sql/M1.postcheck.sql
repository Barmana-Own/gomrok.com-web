-- M1 postcheck is read-only. The first result set must be empty.
SELECT severity, issue_code, resource_type, resource_id, issue_count
FROM (
  SELECT
    'BLOCKER' AS severity,
    'M1_CONTEXT_BACKFILL_MISSING' AS issue_code,
    'organization' AS resource_type,
    CONCAT(candidate.tenant_id, ':', candidate.organization_id, ':', candidate.context_type) AS resource_id,
    1 AS issue_count
  FROM (
    SELECT tenant_id, id AS organization_id, 'FWD' AS context_type
    FROM platform_organizations
    WHERE organization_type = 'company_x'
    UNION
    SELECT tenant_id, id AS organization_id, 'CAR' AS context_type
    FROM platform_organizations
    WHERE organization_type = 'company_y'
    UNION
    SELECT tenant_id, organization_id, 'FWD' AS context_type
    FROM organization_memberships
    WHERE LEFT(role, 10) = 'company_x_'
    UNION
    SELECT tenant_id, organization_id, 'CAR' AS context_type
    FROM organization_memberships
    WHERE LEFT(role, 10) = 'company_y_'
  ) AS candidate
  LEFT JOIN operating_contexts c
    ON c.tenant_id = candidate.tenant_id
   AND c.organization_id = candidate.organization_id
   AND c.context_type = candidate.context_type
  WHERE c.context_id IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M1_CONTEXT_ORGANIZATION_MISSING',
    'operating_context',
    c.context_id,
    1
  FROM operating_contexts c
  LEFT JOIN platform_organizations o
    ON o.tenant_id = c.tenant_id
   AND o.id = c.organization_id
  WHERE o.id IS NULL
) AS issues
ORDER BY issue_code, resource_type, resource_id;

SELECT context_type, status, COUNT(*) AS context_count
FROM operating_contexts
GROUP BY context_type, status
ORDER BY context_type, status;
