import { createHash, randomBytes } from 'node:crypto';
import { CONTEXT_SESSION_MODES, ERROR_CODES } from '../../../shared/contract.js';
import {
  assertContextRoleCompatibility,
  assertCurrentSession,
  authenticationError,
  authorizationError,
  contextSessionConflict,
  normalizeContextId,
  normalizeRefreshToken
} from '../domain/operating-context-session.js';
import { createOperatingContextSessionRepository } from '../repositories/operating-context-session.repository.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function defaultTokenHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function defaultSessionId() {
  return randomBytes(24).toString('base64url');
}

function defaultRefreshToken() {
  return randomBytes(48).toString('base64url');
}

function activeSessionClaims(session) {
  return {
    sessionId: session.sessionId,
    sessionMode: session.mode,
    sessionGeneration: session.generation,
    contextId: session.activeContextId
  };
}

function assertRefreshUsable(refresh, session, at) {
  if (!refresh || refresh.sessionId !== session.sessionId) throw authenticationError('توکن نوسازی نامعتبر یا منقضی است.');
  if (refresh.sessionGeneration !== session.generation) throw contextSessionConflict();
  const expiresAt = new Date(refresh.expiresAt);
  if (refresh.revokedAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= at.getTime()) {
    throw authenticationError('توکن نوسازی نامعتبر یا منقضی است.');
  }
}

async function rollback(connection) {
  try {
    await connection.rollback();
  } catch (_error) {
    // Preserve the original failure; rollback errors are handled by the DB layer.
  }
}

export function publicOperatingContext(access) {
  return {
    contextId: access.contextId,
    contextType: access.contextType,
    organizationId: access.organizationId,
    membershipId: access.membershipId,
    role: access.role,
    displayColor: access.displayColor,
    evidenceLevel: access.evidenceLevel
  };
}

export function createOperatingContextSessionService(database, {
  now = () => new Date(),
  createSessionId = defaultSessionId,
  createRefreshToken = defaultRefreshToken,
  hashToken = defaultTokenHash
} = {}) {
  if (!database || typeof database.getConnection !== 'function' || typeof database.execute !== 'function') {
    throw new TypeError('A mysql2-compatible pool is required.');
  }

  async function withTransaction(handler) {
    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const result = await handler(createOperatingContextSessionRepository(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await rollback(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  return Object.freeze({
    async listAvailableContexts({ tenantId, userId }) {
      const contexts = await createOperatingContextSessionRepository(database).listContextAccess({ tenantId, userId });
      contexts.forEach(assertContextRoleCompatibility);
      return contexts;
    },

    async startLoginSession({ tenantId, userId, originMembershipId }) {
      return withTransaction(async (repository) => {
        const at = now();
        const origin = await repository.findOriginMembership({ tenantId, userId, membershipId: originMembershipId }, { forShare: true });
        if (!origin) throw authenticationError('عضویت سازمانی فعال پیدا نشد.');

        const hasContextMapping = await repository.hasContextMapping({ tenantId, userId }, { forShare: true });
        const contexts = await repository.listContextAccess({ tenantId, userId }, { forShare: true });
        contexts.forEach(assertContextRoleCompatibility);
        if (!contexts.length) {
          if (hasContextMapping) throw authorizationError('هیچ زمینه عملیاتی فعال و دارای صلاحیت برای این کاربر وجود ندارد.');
          return null;
        }
        if (new Set(contexts.map((item) => item.contextId)).size !== contexts.length) {
          throw contextSessionConflict('نگاشت زمینه عملیاتی کاربر مبهم است.');
        }

        const active = contexts.length === 1 ? contexts[0] : null;
        const session = {
          sessionId: createSessionId(),
          tenantId,
          userId,
          originMembershipId,
          activeMembershipId: active?.membershipId || null,
          activeOrganizationId: active?.organizationId || null,
          activeContextId: active?.contextId || null,
          generation: active ? 1 : 0,
          mode: active ? CONTEXT_SESSION_MODES.CONTEXT : CONTEXT_SESSION_MODES.BOOTSTRAP,
          status: 'active',
          expiresAt: new Date(at.getTime() + SESSION_TTL_MS)
        };
        const refreshToken = createRefreshToken();
        const binding = active || origin;
        await repository.insertSession(session);
        await repository.insertRefreshToken({
          tenantId,
          userId,
          membershipId: binding.membershipId,
          tokenHash: hashToken(refreshToken),
          expiresAt: session.expiresAt,
          sessionId: session.sessionId,
          sessionGeneration: session.generation
        });
        return { session, binding, refreshToken, availableContextCount: contexts.length };
      });
    },

    async rotateContextRefreshToken(rawRefreshToken) {
      const refreshToken = normalizeRefreshToken(rawRefreshToken);
      return withTransaction(async (repository) => {
        const at = now();
        const tokenHash = hashToken(refreshToken);
        const candidateRefresh = await repository.findRefreshToken(tokenHash);
        if (!candidateRefresh?.sessionId) return null;

        const session = await repository.findSession({
          sessionId: candidateRefresh.sessionId,
          tenantId: candidateRefresh.tenantId,
          userId: candidateRefresh.userId
        }, { forUpdate: true });
        if (!session) throw authenticationError();
        assertCurrentSession(session, activeSessionClaims(session), at);
        const currentRefresh = await repository.findRefreshToken(tokenHash, { forUpdate: true });
        assertRefreshUsable(currentRefresh, session, at);

        const binding = session.mode === CONTEXT_SESSION_MODES.CONTEXT
          ? await repository.findContextAccess({
            tenantId: session.tenantId,
            userId: session.userId,
            membershipId: session.activeMembershipId,
            organizationId: session.activeOrganizationId,
            contextId: session.activeContextId
          }, { forShare: true })
          : await repository.findOriginMembership({
            tenantId: session.tenantId,
            userId: session.userId,
            membershipId: session.originMembershipId
          }, { forShare: true });
        if (!binding) throw authorizationError();
        assertContextRoleCompatibility(binding);

        const nextRefreshToken = createRefreshToken();
        const nextHash = hashToken(nextRefreshToken);
        await repository.insertRefreshToken({
          tenantId: session.tenantId,
          userId: session.userId,
          membershipId: binding.membershipId,
          tokenHash: nextHash,
          expiresAt: session.expiresAt,
          sessionId: session.sessionId,
          sessionGeneration: session.generation
        });
        const revoked = await repository.revokeRefreshToken({ id: currentRefresh.id, rotatedToHash: nextHash });
        if (Number(revoked.affectedRows) !== 1) throw contextSessionConflict();
        return { session, binding, refreshToken: nextRefreshToken };
      });
    },

    async revokeUserSessions({ tenantId, userId }) {
      if (typeof tenantId !== 'string' || !tenantId.trim() || !Number.isSafeInteger(Number(userId)) || Number(userId) < 1) {
        throw new TypeError('A valid tenant and user are required.');
      }
      return withTransaction(async (repository) => {
        const refreshResult = await repository.revokeUserRefreshTokens({ tenantId, userId: Number(userId) });
        const sessionResult = await repository.revokeUserSessions({ tenantId, userId: Number(userId) });
        return {
          revokedRefreshTokens: Number(refreshResult.affectedRows || 0),
          revokedSessions: Number(sessionResult.affectedRows || 0)
        };
      });
    },

    async transitionContext({ claims, targetContextId, rawRefreshToken, expectedMode, correlationId }) {
      const target = normalizeContextId(targetContextId, { field: 'targetContextId' });
      const refreshToken = normalizeRefreshToken(rawRefreshToken);
      if (!Object.values(CONTEXT_SESSION_MODES).includes(expectedMode)) throw new TypeError('expectedMode is invalid.');

      return withTransaction(async (repository) => {
        const at = now();
        const session = await repository.findSession({
          sessionId: claims.sessionId,
          tenantId: claims.tenantId,
          userId: claims.userId
        }, { forUpdate: true });
        assertCurrentSession(session, claims, at);
        if (session.mode !== expectedMode) {
          throw expectedMode === CONTEXT_SESSION_MODES.CONTEXT
            ? contextSessionConflict()
            : contextSessionConflict('نشست انتخاب زمینه قبلاً مصرف شده است.');
        }

        const currentRefresh = await repository.findRefreshToken(hashToken(refreshToken), { forUpdate: true });
        assertRefreshUsable(currentRefresh, session, at);

        const targets = await repository.findContextAccessByContext({
          tenantId: session.tenantId,
          userId: session.userId,
          contextId: target
        }, { forShare: true });
        if (targets.length !== 1) throw authorizationError();
        const binding = targets[0];
        assertContextRoleCompatibility(binding);
        if (session.activeContextId === binding.contextId) throw contextSessionConflict('این زمینه عملیاتی هم‌اکنون فعال است.');

        const nextGeneration = session.generation + 1;
        const updated = await repository.updateSessionContext({
          sessionId: session.sessionId,
          tenantId: session.tenantId,
          userId: session.userId,
          expectedGeneration: session.generation,
          nextGeneration,
          access: binding
        });
        if (Number(updated.affectedRows) !== 1) throw contextSessionConflict();

        const nextRefreshToken = createRefreshToken();
        const nextHash = hashToken(nextRefreshToken);
        await repository.insertRefreshToken({
          tenantId: session.tenantId,
          userId: session.userId,
          membershipId: binding.membershipId,
          tokenHash: nextHash,
          expiresAt: session.expiresAt,
          sessionId: session.sessionId,
          sessionGeneration: nextGeneration
        });
        const revoked = await repository.revokeRefreshToken({ id: currentRefresh.id, rotatedToHash: nextHash });
        if (Number(revoked.affectedRows) !== 1) throw contextSessionConflict();

        await repository.appendContextSwitched({
          tenantId: session.tenantId,
          actorUserId: session.userId,
          correlationId,
          fromContextId: session.activeContextId,
          toContextId: binding.contextId,
          fromGeneration: session.generation,
          toGeneration: nextGeneration
        });

        return {
          session: {
            ...session,
            activeMembershipId: binding.membershipId,
            activeOrganizationId: binding.organizationId,
            activeContextId: binding.contextId,
            generation: nextGeneration,
            mode: CONTEXT_SESSION_MODES.CONTEXT,
            lastSwitchedAt: at
          },
          binding,
          refreshToken: nextRefreshToken
        };
      });
    }
  });
}

export function assertContextSessionFeatureEnabled(enabled) {
  if (!enabled) {
    const error = new Error('نشست زمینه عملیاتی تا اعتبارسنجی و اعمال M1/M2 فعال نیست.');
    error.code = 'CTX-503';
    error.status = 503;
    throw error;
  }
  return true;
}

export function contextSessionErrorCodes() {
  return Object.freeze([ERROR_CODES.CONTEXT_BINDING, ERROR_CODES.CONTEXT_SESSION_CONFLICT]);
}
