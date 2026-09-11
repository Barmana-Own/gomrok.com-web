-- M1 preflight is read-only. Every returned row has BLOCKER severity.
SELECT severity, issue_code, resource_type, resource_id, issue_count
FROM (
  SELECT
    'BLOCKER' AS severity,
    'M1_DATABASE_NOT_SELECTED' AS issue_code,
    'database' AS resource_type,
    NULL AS resource_id,
    1 AS issue_count
  WHERE DATABASE() IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M1_MYSQL_VERSION_UNSUPPORTED',
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
    'M1_BASE_TABLE_MISSING',
    'table',
    required.table_name,
    1
  FROM (
    SELECT 'platform_organizations' AS table_name
    UNION ALL SELECT 'organization_memberships'
  ) AS required
  LEFT JOIN information_schema.tables t
    ON t.table_schema = DATABASE()
   AND t.table_name = required.table_name
  WHERE t.table_name IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M1_BASE_TABLE_ENGINE_UNSUPPORTED',
    'table',
    CONCAT(table_name, ':', COALESCE(engine, 'NULL')),
    1
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name IN ('platform_organizations', 'organization_memberships')
    AND COALESCE(engine, '') <> 'InnoDB'

  UNION ALL

  SELECT
    'BLOCKER',
    'M1_BASE_COLUMN_MISSING',
    'column',
    CONCAT(required.table_name, '.', required.column_name),
    1
  FROM (
    SELECT 'platform_organizations' AS table_name, 'id' AS column_name
    UNION ALL SELECT 'platform_organizations', 'tenant_id'
    UNION ALL SELECT 'platform_organizations', 'organization_type'
    UNION ALL SELECT 'organization_memberships', 'id'
    UNION ALL SELECT 'organization_memberships', 'tenant_id'
    UNION ALL SELECT 'organization_memberships', 'organization_id'
    UNION ALL SELECT 'organization_memberships', 'role'
  ) AS required
  LEFT JOIN information_schema.columns c
    ON c.table_schema = DATABASE()
   AND c.table_name = required.table_name
   AND c.column_name = required.column_name
  WHERE c.column_name IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M1_BASE_COLUMN_INCOMPATIBLE',
    'column',
    CONCAT(c.table_name, '.', c.column_name, ':', c.column_type, ':', c.is_nullable, ':', COALESCE(c.collation_name, 'NULL')),
    1
  FROM information_schema.columns c
  JOIN (
    SELECT 'platform_organizations' AS table_name, 'id' AS column_name, 'varchar(128)' AS column_type,
           'NO' AS is_nullable, 'utf8mb4' AS character_set_name, 'utf8mb4_unicode_ci' AS collation_name
    UNION ALL SELECT 'platform_organizations', 'tenant_id', 'varchar(64)', 'NO', 'utf8mb4', 'utf8mb4_unicode_ci'
    UNION ALL SELECT 'platform_organizations', 'organization_type', 'varchar(40)', 'NO', 'utf8mb4', 'utf8mb4_unicode_ci'
    UNION ALL SELECT 'organization_memberships', 'tenant_id', 'varchar(64)', 'NO', 'utf8mb4', 'utf8mb4_unicode_ci'
    UNION ALL SELECT 'organization_memberships', 'organization_id', 'varchar(128)', 'NO', 'utf8mb4', 'utf8mb4_unicode_ci'
    UNION ALL SELECT 'organization_memberships', 'role', 'varchar(64)', 'NO', 'utf8mb4', 'utf8mb4_unicode_ci'
  ) AS expected
    ON expected.table_name = c.table_name
   AND expected.column_name = c.column_name
  WHERE c.table_schema = DATABASE()
    AND (
      LOWER(c.column_type) <> expected.column_type
      OR c.is_nullable <> expected.is_nullable
      OR NOT (c.character_set_name <=> expected.character_set_name)
      OR NOT (c.collation_name <=> expected.collation_name)
    )

  UNION ALL

  SELECT
    'BLOCKER',
    'M1_ORPHAN_MEMBERSHIP_ORGANIZATION',
    'membership',
    CAST(m.id AS CHAR),
    1
  FROM organization_memberships m
  LEFT JOIN platform_organizations o
    ON o.tenant_id = m.tenant_id
   AND o.id = m.organization_id
  WHERE (LEFT(m.role, 10) = 'company_x_' OR LEFT(m.role, 10) = 'company_y_')
    AND o.id IS NULL

  UNION ALL

  SELECT
    'BLOCKER',
    'M1_PARTIAL_OBJECT_EXISTS',
    'table',
    table_name,
    1
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'operating_contexts'

  UNION ALL

  SELECT
    'BLOCKER',
    'M1_PARTIAL_OBJECT_EXISTS',
    'index',
    index_name,
    1
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'platform_organizations'
    AND index_name = 'uq_platform_org_tenant_id'
) AS issues
ORDER BY issue_code, resource_type, resource_id;
