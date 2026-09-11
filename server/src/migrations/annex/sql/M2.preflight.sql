-- M2 preflight is read-only. Every returned row has BLOCKER severity.
SELECT severity, issue_code, resource_type, resource_id, issue_count
FROM (
  SELECT
    'BLOCKER' AS severity,
    'M2_DATABASE_NOT_SELECTED' AS issue_code,
    'database' AS resource_type,
    NULL AS resource_id,
    1 AS issue_count
  WHERE DATABASE() IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_MYSQL_VERSION_UNSUPPORTED',
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
    'M2_BASE_TABLE_MISSING',
    'table',
    required.table_name,
    1
  FROM (
    SELECT 'platform_users' AS table_name
    UNION ALL SELECT 'platform_organizations'
    UNION ALL SELECT 'organization_memberships'
    UNION ALL SELECT 'operating_contexts'
    UNION ALL SELECT 'platform_refresh_tokens'
    UNION ALL SELECT 'platform_domain_events'
  ) AS required
  LEFT JOIN information_schema.tables t
    ON t.table_schema = DATABASE()
   AND t.table_name = required.table_name
  WHERE t.table_name IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_BASE_TABLE_ENGINE_UNSUPPORTED',
    'table',
    CONCAT(table_name, ':', COALESCE(engine, 'NULL')),
    1
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name IN (
      'platform_users',
      'platform_organizations',
      'organization_memberships',
      'operating_contexts',
      'platform_refresh_tokens',
      'platform_domain_events'
    )
    AND COALESCE(engine, '') <> 'InnoDB'

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_BASE_COLUMN_MISSING',
    'column',
    CONCAT(required.table_name, '.', required.column_name),
    1
  FROM (
    SELECT 'platform_users' AS table_name, 'id' AS column_name
    UNION ALL SELECT 'platform_users', 'tenant_id'
    UNION ALL SELECT 'organization_memberships', 'id'
    UNION ALL SELECT 'organization_memberships', 'tenant_id'
    UNION ALL SELECT 'organization_memberships', 'organization_id'
    UNION ALL SELECT 'organization_memberships', 'user_id'
    UNION ALL SELECT 'organization_memberships', 'role'
    UNION ALL SELECT 'operating_contexts', 'context_id'
    UNION ALL SELECT 'operating_contexts', 'tenant_id'
    UNION ALL SELECT 'operating_contexts', 'organization_id'
    UNION ALL SELECT 'operating_contexts', 'context_type'
    UNION ALL SELECT 'operating_contexts', 'role_grant_id'
    UNION ALL SELECT 'platform_refresh_tokens', 'id'
    UNION ALL SELECT 'platform_refresh_tokens', 'token_hash'
  ) AS required
  LEFT JOIN information_schema.columns c
    ON c.table_schema = DATABASE()
   AND c.table_name = required.table_name
   AND c.column_name = required.column_name
  WHERE c.column_name IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_ROLE_GRANT_STAGING_COLUMN_INVALID',
    'column',
    CONCAT(c.table_name, '.', c.column_name, ':', c.column_type, ':', c.is_nullable),
    1
  FROM information_schema.columns c
  WHERE c.table_schema = DATABASE()
    AND c.table_name = 'operating_contexts'
    AND c.column_name = 'role_grant_id'
    AND (LOWER(c.column_type) <> 'bigint unsigned' OR c.is_nullable <> 'YES')

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_ACTIVE_CONTEXT_WITHOUT_GRANT',
    'operating_context',
    context_id,
    1
  FROM operating_contexts
  WHERE status = 'active' AND role_grant_id IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_BASE_TABLE_COLLATION_UNSUPPORTED',
    'table',
    CONCAT(table_name, ':', COALESCE(table_collation, 'NULL')),
    1
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name IN (
      'platform_users',
      'platform_organizations',
      'organization_memberships',
      'operating_contexts',
      'platform_refresh_tokens'
    )
    AND COALESCE(table_collation, '') <> 'utf8mb4_unicode_ci'

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_PARTIAL_OBJECT_EXISTS',
    'table',
    table_name,
    1
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name IN (
      'organization_role_grants',
      'membership_operating_contexts',
      'platform_sessions'
    )

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_PARTIAL_OBJECT_EXISTS',
    'column',
    CONCAT(table_name, '.', column_name),
    1
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'platform_refresh_tokens'
    AND column_name IN ('session_id', 'session_generation')

  UNION ALL

  SELECT
    'BLOCKER',
    'M2_PARTIAL_OBJECT_EXISTS',
    'index',
    CONCAT(table_name, '.', index_name),
    1
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND (
      (table_name = 'platform_users' AND index_name = 'uq_platform_user_tenant_id')
      OR (table_name = 'organization_memberships' AND index_name IN (
        'uq_membership_tenant_user_id', 'uq_membership_context_scope'
      ))
      OR (table_name = 'operating_contexts' AND index_name IN (
        'uq_operating_context_role_grant', 'uq_operating_context_scope'
      ))
      OR (table_name = 'platform_refresh_tokens' AND index_name = 'idx_refresh_session_generation')
    )
) AS issues
ORDER BY issue_code, resource_type, resource_id;
