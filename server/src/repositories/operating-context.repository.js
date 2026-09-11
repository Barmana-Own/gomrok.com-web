import { validateOperatingContext, validateOrganizationRoleGrant } from '../domain/operating-context.js';

function assertExecutor(executor) {
  if (!executor || typeof executor.execute !== 'function') throw new TypeError('A mysql2-compatible executor is required.');
  return executor;
}

function parseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  return JSON.parse(value);
}

function roleGrantFromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    role: row.role,
    permitNo: row.permit_no,
    permitType: row.permit_type,
    issuingAuthority: row.issuing_authority,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    evidenceLevel: row.evidence_level,
    routeScope: parseJson(row.route_scope),
    cargoScope: parseJson(row.cargo_scope),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function contextFromRow(row) {
  if (!row) return null;
  return {
    contextId: row.context_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    roleGrantId: row.role_grant_id === null || row.role_grant_id === undefined
      ? null
      : Number(row.role_grant_id),
    contextType: row.context_type,
    dataPartitionKey: row.data_partition_key,
    ledgerId: row.ledger_id ?? null,
    displayColor: row.display_color,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createOperatingContextRepository(executor) {
  const db = assertExecutor(executor);

  const findRoleGrant = async ({ tenantId, organizationId, grantId }) => {
    const [rows] = await db.execute(
      `SELECT id, tenant_id, organization_id, role, permit_no, permit_type, issuing_authority,
              valid_from, valid_to, evidence_level, route_scope, cargo_scope, status, created_at, updated_at
         FROM organization_role_grants
        WHERE tenant_id = ? AND organization_id = ? AND id = ?
        LIMIT 1`,
      [tenantId, organizationId, grantId]
    );
    return roleGrantFromRow(rows[0]);
  };

  return Object.freeze({
    findRoleGrant,

    async findContext({ tenantId, organizationId, contextId }) {
      const [rows] = await db.execute(
        `SELECT context_id, tenant_id, organization_id, role_grant_id, context_type,
                data_partition_key, ledger_id, display_color, status, created_at, updated_at
           FROM operating_contexts
          WHERE tenant_id = ? AND organization_id = ? AND context_id = ?
          LIMIT 1`,
        [tenantId, organizationId, contextId]
      );
      return contextFromRow(rows[0]);
    },

    async listOrganizationContexts({ tenantId, organizationId }) {
      const [rows] = await db.execute(
        `SELECT c.context_id, c.tenant_id, c.organization_id, c.role_grant_id, c.context_type,
                c.data_partition_key, c.ledger_id, c.display_color, c.status, c.created_at, c.updated_at
           FROM operating_contexts c
           JOIN organization_role_grants g
             ON g.id = c.role_grant_id
            AND g.tenant_id = c.tenant_id
            AND g.organization_id = c.organization_id
          WHERE c.tenant_id = ? AND c.organization_id = ?
          ORDER BY c.context_type, c.context_id`,
        [tenantId, organizationId]
      );
      return rows.map(contextFromRow);
    },

    async insertRoleGrant(input) {
      const grant = validateOrganizationRoleGrant(input);
      const [result] = await db.execute(
        `INSERT INTO organization_role_grants
          (tenant_id, organization_id, role, permit_no, permit_type, issuing_authority,
           valid_from, valid_to, evidence_level, route_scope, cargo_scope, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          grant.tenantId,
          grant.organizationId,
          grant.role,
          grant.permitNo,
          grant.permitType,
          grant.issuingAuthority,
          grant.validFrom,
          grant.validTo,
          grant.evidenceLevel,
          grant.routeScope === null ? null : JSON.stringify(grant.routeScope),
          grant.cargoScope === null ? null : JSON.stringify(grant.cargoScope),
          grant.status
        ]
      );
      return { ...grant, id: Number(result.insertId) };
    },

    async insertContext(input, { at = new Date() } = {}) {
      const roleGrant = await findRoleGrant({
        tenantId: input?.tenantId,
        organizationId: input?.organizationId,
        grantId: input?.roleGrantId
      });
      const context = validateOperatingContext(input, { roleGrant, at });
      await db.execute(
        `INSERT INTO operating_contexts
          (context_id, tenant_id, organization_id, role_grant_id, context_type,
           data_partition_key, ledger_id, display_color, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          context.contextId,
          context.tenantId,
          context.organizationId,
          context.roleGrantId,
          context.contextType,
          context.dataPartitionKey,
          context.ledgerId,
          context.displayColor,
          context.status
        ]
      );
      return context;
    }
  });
}
