function assertExecutor(executor) {
  if (!executor || typeof executor.execute !== 'function') throw new TypeError('A mysql2-compatible executor is required.');
  return executor;
}

function parseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function sessionFromRow(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    userId: Number(row.user_id),
    originMembershipId: Number(row.origin_membership_id),
    activeMembershipId: row.active_membership_id === null ? null : Number(row.active_membership_id),
    activeOrganizationId: row.active_organization_id || null,
    activeContextId: row.active_context_id || null,
    generation: Number(row.generation),
    mode: row.session_mode,
    status: row.status,
    expiresAt: row.expires_at,
    lastSwitchedAt: row.last_switched_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function accessFromRow(row) {
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    userId: Number(row.user_id),
    membershipId: Number(row.membership_id),
    organizationId: row.organization_id,
    organizationType: row.organization_type,
    role: row.membership_role,
    transactionRole: row.transaction_role || null,
    routeScope: parseJson(row.route_scope),
    countryScope: parseJson(row.country_scope),
    cargoScope: parseJson(row.cargo_scope),
    qualificationState: row.qualification_state,
    kycLevel: row.kyc_level,
    contractState: row.contract_state || null,
    delegationScope: parseJson(row.delegation_json),
    externalType: row.external_type,
    externalId: row.external_id === null || row.external_id === undefined ? null : Number(row.external_id),
    contextId: row.context_id || null,
    contextType: row.context_type || null,
    roleGrantId: row.role_grant_id === null || row.role_grant_id === undefined ? null : Number(row.role_grant_id),
    roleGrantType: row.role_grant_type || null,
    evidenceLevel: row.evidence_level || null,
    displayColor: row.display_color || null
  };
}

function refreshFromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    tenantId: row.tenant_id,
    userId: Number(row.user_id),
    membershipId: Number(row.membership_id),
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
    rotatedToHash: row.rotated_to_hash || null,
    sessionId: row.session_id || null,
    sessionGeneration: row.session_generation === null || row.session_generation === undefined
      ? null
      : Number(row.session_generation)
  };
}

const membershipProjection = `m.id AS membership_id, m.tenant_id, m.organization_id, m.user_id,
       m.role AS membership_role, m.transaction_role, m.route_scope, m.country_scope,
       m.cargo_scope, m.qualification_state, m.kyc_level, m.contract_state, m.delegation_json,
       o.organization_type, u.external_type, u.external_id`;

const contextProjection = `${membershipProjection}, c.context_id, c.context_type, c.role_grant_id,
       c.display_color, g.role AS role_grant_type, g.evidence_level`;

export function createOperatingContextSessionRepository(executor) {
  const db = assertExecutor(executor);

  return Object.freeze({
    async hasContextMapping({ tenantId, userId }, { forShare = false } = {}) {
      const [rows] = await db.execute(
        `SELECT 1 AS mapped_context
           FROM membership_operating_contexts
          WHERE tenant_id = ? AND user_id = ?
          LIMIT 1${forShare ? ' FOR SHARE' : ''}`,
        [tenantId, userId]
      );
      return Boolean(rows[0]);
    },

    async findSession({ sessionId, tenantId, userId }, { forUpdate = false } = {}) {
      const [rows] = await db.execute(
        `SELECT s.session_id, s.tenant_id, s.user_id, s.origin_membership_id,
                s.active_membership_id, s.active_organization_id, s.active_context_id,
                s.generation, s.session_mode, s.status, s.expires_at, s.last_switched_at,
                s.created_at, s.updated_at
           FROM platform_sessions s
          WHERE s.session_id = ? AND s.tenant_id = ? AND s.user_id = ?
          LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
        [sessionId, tenantId, userId]
      );
      return sessionFromRow(rows[0]);
    },

    async findOriginMembership({ tenantId, userId, membershipId }, { forShare = false } = {}) {
      const [rows] = await db.execute(
        `SELECT ${membershipProjection}, NULL AS context_id, NULL AS context_type,
                NULL AS role_grant_id, NULL AS display_color, NULL AS role_grant_type,
                NULL AS evidence_level
           FROM organization_memberships m
           JOIN platform_users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
           JOIN platform_organizations o ON o.id = m.organization_id AND o.tenant_id = m.tenant_id
          WHERE m.tenant_id = ? AND m.user_id = ? AND m.id = ?
            AND m.status = 'active' AND u.status = 'active' AND o.status = 'active'
          LIMIT 1${forShare ? ' FOR SHARE' : ''}`,
        [tenantId, userId, membershipId]
      );
      return accessFromRow(rows[0]);
    },

    async findContextAccess({ tenantId, userId, membershipId, organizationId, contextId }, { forShare = false } = {}) {
      const [rows] = await db.execute(
        `SELECT ${contextProjection}
           FROM membership_operating_contexts mc
           JOIN organization_memberships m
             ON m.id = mc.membership_id
            AND m.tenant_id = mc.tenant_id
            AND m.user_id = mc.user_id
            AND m.organization_id = mc.organization_id
           JOIN platform_users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
           JOIN platform_organizations o ON o.id = m.organization_id AND o.tenant_id = m.tenant_id
           JOIN operating_contexts c
             ON c.context_id = mc.context_id
            AND c.tenant_id = mc.tenant_id
            AND c.organization_id = mc.organization_id
           JOIN organization_role_grants g
             ON g.id = c.role_grant_id
            AND g.tenant_id = c.tenant_id
            AND g.organization_id = c.organization_id
          WHERE mc.tenant_id = ? AND mc.user_id = ? AND mc.membership_id = ?
            AND mc.organization_id = ? AND mc.context_id = ?
            AND mc.status = 'active' AND m.status = 'active' AND u.status = 'active'
            AND o.status = 'active' AND c.status = 'active' AND g.status = 'active'
            AND g.valid_from <= NOW() AND (g.valid_to IS NULL OR g.valid_to > NOW())
          LIMIT 1${forShare ? ' FOR SHARE' : ''}`,
        [tenantId, userId, membershipId, organizationId, contextId]
      );
      return accessFromRow(rows[0]);
    },

    async findContextAccessByContext({ tenantId, userId, contextId }, { forShare = false } = {}) {
      const [rows] = await db.execute(
        `SELECT ${contextProjection}
           FROM membership_operating_contexts mc
           JOIN organization_memberships m
             ON m.id = mc.membership_id
            AND m.tenant_id = mc.tenant_id
            AND m.user_id = mc.user_id
            AND m.organization_id = mc.organization_id
           JOIN platform_users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
           JOIN platform_organizations o ON o.id = m.organization_id AND o.tenant_id = m.tenant_id
           JOIN operating_contexts c
             ON c.context_id = mc.context_id
            AND c.tenant_id = mc.tenant_id
            AND c.organization_id = mc.organization_id
           JOIN organization_role_grants g
             ON g.id = c.role_grant_id
            AND g.tenant_id = c.tenant_id
            AND g.organization_id = c.organization_id
          WHERE mc.tenant_id = ? AND mc.user_id = ? AND mc.context_id = ?
            AND mc.status = 'active' AND m.status = 'active' AND u.status = 'active'
            AND o.status = 'active' AND c.status = 'active' AND g.status = 'active'
            AND g.valid_from <= NOW() AND (g.valid_to IS NULL OR g.valid_to > NOW())
          LIMIT 2${forShare ? ' FOR SHARE' : ''}`,
        [tenantId, userId, contextId]
      );
      return rows.map(accessFromRow);
    },

    async listContextAccess({ tenantId, userId }, { forShare = false } = {}) {
      const [rows] = await db.execute(
        `SELECT ${contextProjection}
           FROM membership_operating_contexts mc
           JOIN organization_memberships m
             ON m.id = mc.membership_id
            AND m.tenant_id = mc.tenant_id
            AND m.user_id = mc.user_id
            AND m.organization_id = mc.organization_id
           JOIN platform_users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
           JOIN platform_organizations o ON o.id = m.organization_id AND o.tenant_id = m.tenant_id
           JOIN operating_contexts c
             ON c.context_id = mc.context_id
            AND c.tenant_id = mc.tenant_id
            AND c.organization_id = mc.organization_id
           JOIN organization_role_grants g
             ON g.id = c.role_grant_id
            AND g.tenant_id = c.tenant_id
            AND g.organization_id = c.organization_id
          WHERE mc.tenant_id = ? AND mc.user_id = ?
            AND mc.status = 'active' AND m.status = 'active' AND u.status = 'active'
            AND o.status = 'active' AND c.status = 'active' AND g.status = 'active'
            AND g.valid_from <= NOW() AND (g.valid_to IS NULL OR g.valid_to > NOW())
          ORDER BY c.context_type, c.context_id${forShare ? ' FOR SHARE' : ''}`,
        [tenantId, userId]
      );
      return rows.map(accessFromRow);
    },

    async findRefreshToken(tokenHash, { forUpdate = false } = {}) {
      const [rows] = await db.execute(
        `SELECT id, tenant_id, user_id, membership_id, token_hash, expires_at, revoked_at,
                rotated_to_hash, session_id, session_generation
           FROM platform_refresh_tokens
          WHERE token_hash = ?
          LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
        [tokenHash]
      );
      return refreshFromRow(rows[0]);
    },

    async insertSession(session) {
      const [result] = await db.execute(
        `INSERT INTO platform_sessions
          (session_id, tenant_id, user_id, origin_membership_id, active_membership_id,
           active_organization_id, active_context_id, generation, session_mode, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
          session.sessionId,
          session.tenantId,
          session.userId,
          session.originMembershipId,
          session.activeMembershipId,
          session.activeOrganizationId,
          session.activeContextId,
          session.generation,
          session.mode,
          session.expiresAt
        ]
      );
      return result;
    },

    async updateSessionContext({ sessionId, tenantId, userId, expectedGeneration, nextGeneration, access }) {
      const [result] = await db.execute(
        `UPDATE platform_sessions
            SET active_membership_id = ?, active_organization_id = ?, active_context_id = ?,
                generation = ?, session_mode = 'context', last_switched_at = NOW()
          WHERE session_id = ? AND tenant_id = ? AND user_id = ?
            AND generation = ? AND status = 'active' AND expires_at > NOW()`,
        [
          access.membershipId,
          access.organizationId,
          access.contextId,
          nextGeneration,
          sessionId,
          tenantId,
          userId,
          expectedGeneration
        ]
      );
      return result;
    },

    async insertRefreshToken({ tenantId, userId, membershipId, tokenHash, expiresAt, sessionId, sessionGeneration }) {
      const [result] = await db.execute(
        `INSERT INTO platform_refresh_tokens
          (tenant_id, user_id, membership_id, token_hash, expires_at, session_id, session_generation)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tenantId, userId, membershipId, tokenHash, expiresAt, sessionId, sessionGeneration]
      );
      return result;
    },

    async revokeRefreshToken({ id, rotatedToHash }) {
      const [result] = await db.execute(
        `UPDATE platform_refresh_tokens
            SET revoked_at = NOW(), rotated_to_hash = ?
          WHERE id = ? AND revoked_at IS NULL`,
        [rotatedToHash, id]
      );
      return result;
    },

    async revokeUserRefreshTokens({ tenantId, userId }) {
      const [result] = await db.execute(
        `UPDATE platform_refresh_tokens
            SET revoked_at = NOW()
          WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL`,
        [tenantId, userId]
      );
      return result;
    },

    async revokeUserSessions({ tenantId, userId }) {
      const [result] = await db.execute(
        `UPDATE platform_sessions
            SET status = 'revoked'
          WHERE tenant_id = ? AND user_id = ? AND status = 'active'`,
        [tenantId, userId]
      );
      return result;
    },

    async appendContextSwitched({ tenantId, actorUserId, correlationId, fromContextId, toContextId, fromGeneration, toGeneration }) {
      const [result] = await db.execute(
        `INSERT INTO platform_domain_events
          (tenant_id, event_name, event_version, entity_type, entity_id, actor_user_id, correlation_id, payload_json)
         VALUES (?, 'ContextSwitched', 1, 'platform_session', NULL, ?, ?, ?)`,
        [
          tenantId,
          actorUserId,
          correlationId || null,
          JSON.stringify({ fromContextId: fromContextId || null, toContextId, fromGeneration, toGeneration })
        ]
      );
      return result;
    }
  });
}
