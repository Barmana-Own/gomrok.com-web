import { randomBytes } from 'node:crypto';
import { hasPermission, PERMISSIONS } from '../../../shared/contract.js';

const subscribers = new Map();
const maxConnections = Math.max(Number(process.env.REALTIME_MAX_CONNECTIONS || 500), 10);
const sensitiveKeyPattern = /(?:password|secret|token|authorization|cookie|raw.?contact|contact|phone|email|price|rate|margin|quote|amount|value|file.?ref|file.?url|bank|account|location|latitude|longitude|coordinates|geo.?point|accuracy|speed)/i;
const documentEventPattern = /(?:document|cmr|tir|pod|evidence|loading|warehouse|receipt)/i;
const locationEventPattern = /(?:gps|location|route|border|trip.?started|destination|incident|deviation|arrival)/i;
const settlementEventPattern = /(?:settlement|payment|ledger|invoice|export)/i;
const contactEventPattern = /contact/i;

export function redactRealtimePayload(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value === undefined ? null : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactRealtimePayload(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, item]) => [
    key,
    sensitiveKeyPattern.test(key) ? '[REDACTED_BY_POLICY]' : redactRealtimePayload(item, depth + 1)
  ]));
}

function requiredPermission(eventName) {
  if (contactEventPattern.test(eventName)) return PERMISSIONS.SEE_CONTACT;
  if (settlementEventPattern.test(eventName)) return PERMISSIONS.SEE_SETTLEMENT;
  if (locationEventPattern.test(eventName)) return PERMISSIONS.SEE_LOCATION;
  if (documentEventPattern.test(eventName)) return PERMISSIONS.SEE_DOCUMENTS;
  return PERMISSIONS.READ;
}

function visibleToSubscriber(event, subscriber) {
  if (event.tenantId !== subscriber.tenantId) return false;
  if (!hasPermission(subscriber.role, requiredPermission(event.eventName))) return false;
  const orgIds = new Set((event.recipientOrgIds || []).map(String));
  const userIds = new Set((event.recipientUserIds || []).map(String));
  if (!orgIds.size && !userIds.size) return String(event.actorOrganizationId || '') === String(subscriber.organizationId || '');
  return orgIds.has(String(subscriber.organizationId)) || userIds.has(String(subscriber.userId));
}

export function subscribeRealtime(actor, send) {
  if (subscribers.size >= maxConnections) {
    const error = new Error('ظرفیت اتصال بلادرنگ این نمونه تکمیل است.');
    error.code = 'RT-429';
    error.status = 429;
    throw error;
  }
  const id = randomBytes(12).toString('hex');
  subscribers.set(id, {
    tenantId: actor.tenantId,
    organizationId: actor.organizationId,
    userId: actor.userId,
    role: actor.role,
    send
  });
  return () => subscribers.delete(id);
}

export function publishPlatformEvent({
  tenantId,
  eventName,
  entityType,
  entityId = null,
  actorOrganizationId = null,
  correlationId = null,
  payload = {},
  recipientOrgIds = [],
  recipientUserIds = []
}) {
  const event = {
    id: `${Date.now()}-${randomBytes(4).toString('hex')}`,
    tenantId,
    eventName,
    entityType,
    entityId,
    occurredAt: new Date().toISOString(),
    correlationId,
    actorOrganizationId,
    recipientOrgIds: [...new Set(recipientOrgIds.filter(Boolean))],
    recipientUserIds: [...new Set(recipientUserIds.filter(Boolean))],
    payload: redactRealtimePayload(payload)
  };
  for (const subscriber of subscribers.values()) {
    if (!visibleToSubscriber(event, subscriber)) continue;
    try {
      subscriber.send(event);
    } catch (_error) {
      // The request close handler owns removal; a failed write must not break the publisher.
    }
  }
  return event;
}

export function realtimeStats() {
  return { connections: subscribers.size, maxConnections };
}
