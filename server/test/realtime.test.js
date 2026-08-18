import test from 'node:test';
import assert from 'node:assert/strict';
import { publishPlatformEvent, subscribeRealtime, realtimeStats } from '../src/realtime/broker.js';

test('realtime broker filters events by tenant and recipient organization', () => {
  const first = [];
  const second = [];
  const otherTenant = [];
  const stopFirst = subscribeRealtime({ tenantId: 'tenant-a', organizationId: 'org-a', userId: 1, role: 'company_y_owner' }, (event) => first.push(event));
  const stopSecond = subscribeRealtime({ tenantId: 'tenant-a', organizationId: 'org-b', userId: 2, role: 'company_y_owner' }, (event) => second.push(event));
  const stopOtherTenant = subscribeRealtime({ tenantId: 'tenant-b', organizationId: 'org-a', userId: 3, role: 'company_y_owner' }, (event) => otherTenant.push(event));

  publishPlatformEvent({
    tenantId: 'tenant-a',
    eventName: 'PODSubmitted',
    entityType: 'trip_case',
    entityId: 42,
    recipientOrgIds: ['org-b'],
    payload: { caseId: 42, price: 900, contact: 'hidden' }
  });

  assert.equal(first.length, 0);
  assert.equal(second.length, 1);
  assert.equal(otherTenant.length, 0);
  assert.equal(second[0].payload.price, '[REDACTED_BY_POLICY]');
  assert.equal(second[0].payload.contact, '[REDACTED_BY_POLICY]');
  assert.equal(realtimeStats().connections >= 3, true);

  stopFirst();
  stopSecond();
  stopOtherTenant();
});

test('realtime broker falls back to actor organization when no recipient is supplied', () => {
  const received = [];
  const stop = subscribeRealtime({ tenantId: 'tenant-c', organizationId: 'org-c', userId: 8, role: 'company_x_owner' }, (event) => received.push(event));
  publishPlatformEvent({ tenantId: 'tenant-c', actorOrganizationId: 'org-c', eventName: 'SecurityIncidentOpened', entityType: 'case', payload: { state: 'OPEN' } });
  assert.equal(received.length, 1);
  assert.equal(received[0].payload.state, 'OPEN');
  stop();
});

test('realtime broker applies document, location and settlement permission gates', () => {
  const documentIssuer = [];
  const carrierOwner = [];
  const stopDocumentIssuer = subscribeRealtime({ tenantId: 'tenant-d', organizationId: 'org-y', userId: 9, role: 'company_y_document_issuer' }, (event) => documentIssuer.push(event));
  const stopCarrierOwner = subscribeRealtime({ tenantId: 'tenant-d', organizationId: 'org-y', userId: 10, role: 'company_y_owner' }, (event) => carrierOwner.push(event));

  publishPlatformEvent({ tenantId: 'tenant-d', eventName: 'SettlementConfirmed', entityType: 'relationship_ledger', entityId: 7, recipientOrgIds: ['org-y'], payload: { state: 'SETTLED' } });
  assert.equal(documentIssuer.length, 0);
  assert.equal(carrierOwner.length, 1);

  documentIssuer.length = 0;
  carrierOwner.length = 0;
  publishPlatformEvent({ tenantId: 'tenant-d', eventName: 'GPSInterrupted', entityType: 'trip_case', entityId: 7, recipientOrgIds: ['org-y'], payload: { state: 'INTERRUPTED' } });
  assert.equal(documentIssuer.length, 0);
  assert.equal(carrierOwner.length, 1);

  stopDocumentIssuer();
  stopCarrierOwner();
});
