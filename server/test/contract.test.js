import test from 'node:test';
import assert from 'node:assert/strict';
import { RFQ_LEVELS, PERMISSIONS, ROLES, hasPermission, isHumanAwardRole } from '../../shared/contract.js';
import {
  DomainError,
  assertDelegated,
  assertHumanAward,
  assertRelationshipAccess,
  assertTenantScope,
  assertTripStartReady,
  canReadQuote,
  validatePodEvidence
} from '../src/domain/workflow.js';
import { reviewShipperDraft } from '../src/routes/platform.routes.js';

test('RFQ2 cannot award directly to a driver', () => {
  assert.throws(
    () => assertHumanAward({ actor: { role: 'company_x_owner' }, level: RFQ_LEVELS.MARKET_B, winnerOrganizationType: 'driver' }),
    (error) => error instanceof DomainError && error.code === 'AWD-403'
  );
});

test('RFQ1 award requires a human shipper decision', () => {
  assert.throws(
    () => assertHumanAward({ actor: { role: 'company_x_owner' }, level: RFQ_LEVELS.MARKET_A, winnerOrganizationType: 'company_x' }),
    (error) => error instanceof DomainError && error.code === 'AWD-403'
  );
  assert.equal(assertHumanAward({ actor: { role: 'shipper_admin' }, level: RFQ_LEVELS.MARKET_A, winnerOrganizationType: 'company_x' }), true);
});

test('logistics award and CMR actions require explicit delegation', () => {
  assert.throws(
    () => assertHumanAward({ actor: { role: 'shipper_logistics_user' }, level: RFQ_LEVELS.MARKET_A, winnerOrganizationType: 'company_x' }),
    (error) => error instanceof DomainError && error.code === 'AUTH-403'
  );
  assert.equal(assertHumanAward({ actor: { role: 'shipper_logistics_user', delegationScope: { award: true } }, level: RFQ_LEVELS.MARKET_A, winnerOrganizationType: 'company_x' }), true);
  assert.throws(() => assertDelegated({ role: 'shipper_logistics_user' }, 'approveCmr'), (error) => error.code === 'AUTH-403');
  assert.equal(assertDelegated({ role: 'shipper_logistics_user', delegationScope: { approveCmr: true } }, 'approveCmr'), true);
});

test('finance user is relationship-scoped and cannot mutate trip state', () => {
  assert.equal(hasPermission('shipper_finance_user', PERMISSIONS.SEE_SETTLEMENT), true);
  assert.equal(hasPermission('shipper_finance_user', PERMISSIONS.UPDATE), false);
  assert.equal(hasPermission('shipper_finance_user', PERMISSIONS.SEE_LOCATION), false);
});

test('sealed quote book exposes only the bidder before deadline', () => {
  const rfq = { tenantId: 't1', publisherOrgId: 'shipper:1', deadlineAt: new Date(Date.now() + 60_000), state: 'OPEN' };
  assert.equal(canReadQuote({ actor: { tenantId: 't1', organizationId: 'company-x:1' }, rfq, quote: { bidderOrgId: 'company-x:1' } }), true);
  assert.equal(canReadQuote({ actor: { tenantId: 't1', organizationId: 'shipper:1' }, rfq, quote: { bidderOrgId: 'company-x:1' } }), false);
  assert.equal(canReadQuote({ actor: { tenantId: 't1', organizationId: 'other:1' }, rfq, quote: { bidderOrgId: 'company-x:1' } }), false);
});

test('trip start requires every readiness gate', () => {
  assert.throws(() => assertTripStartReady({ readiness: { customsReady: true } }), (error) => error.code === 'CMP-451');
  assert.equal(assertTripStartReady({ readiness: { customsReady: true, routePermitReady: true, documentsReady: true, vehicleReady: true, driverReady: true, preloadState: 'CHECKED_IN' } }), true);
});

test('POD requires authorized recipient and evidence set', () => {
  assert.throws(() => validatePodEvidence({ recipientOrgId: 'agent:2', authorityRef: 'A-1' }, { authorizedAgentOrgId: 'agent:3' }), (error) => error.code === 'POD-424');
  assert.equal(validatePodEvidence({ recipientOrgId: 'agent:3', authorityRef: 'A-1', receivedAt: new Date().toISOString(), location: { lat: 35.7, lng: 51.4 }, photos: ['photo-1'], signedCmrRef: 'cmr-1', otpVerified: true }, { authorizedAgentOrgId: 'agent:3', otpRequired: true }), true);
});

test('tenant and financial relationship boundaries reject substitution', () => {
  assert.throws(() => assertTenantScope({ tenantId: 'tenant-a' }, 'tenant-b'), (error) => error.code === 'AUTH-403');
  assert.throws(() => assertRelationshipAccess({ organizationId: 'customer:a' }, { payerOrgId: 'company:x', payeeOrgId: 'company:y', relationshipType: 'x_y' }), (error) => error.code === 'FIN-403');
  assert.equal(assertRelationshipAccess({ organizationId: 'customer:a' }, { payerOrgId: 'customer:a', payeeOrgId: 'company:x', relationshipType: 'customer_x' }), undefined);
});

test('shipper wizard review is server-owned and blocks incomplete publish', () => {
  const item = { direction: 'EXPORT', deadline_at: '2030-01-01T00:00:00.000Z' };
  const incomplete = reviewShipperDraft(item, { direction: 'EXPORT' });
  assert.equal(incomplete.ready, false);
  assert.ok(incomplete.missingFields.includes('origin.location'));
  const complete = reviewShipperDraft(item, {
    direction: 'EXPORT',
    origin: { country: 'IR', location: 'Tehran' },
    destination: { country: 'TR', location: 'Istanbul' },
    cargo: { type: 'General', weight: 100, condition: 'normal' },
    commercial: { incoterm: 'DAP', namedPlace: 'Istanbul' },
    schedule: { readyDate: '2030-01-01T00:00:00.000Z' }
  });
  assert.equal(complete.ready, true);
  assert.throws(() => reviewShipperDraft(item, { direction: 'EXPORT' }, { forPublish: true }), (error) => error.code === 'CASE-422');
});

test('Company X role boundaries preserve Market B human award and scoped operations', () => {
  assert.equal(hasPermission(ROLES.COMPANY_X_OPERATIONS_MANAGER, PERMISSIONS.CREATE), true);
  assert.equal(hasPermission(ROLES.COMPANY_X_DISPATCHER, PERMISSIONS.SEE_LOCATION), true);
  assert.equal(hasPermission(ROLES.COMPANY_X_DOCUMENT_EXPERT, PERMISSIONS.SEE_PRICE), false);
  assert.equal(isHumanAwardRole(ROLES.COMPANY_X_OPERATIONS_MANAGER, RFQ_LEVELS.MARKET_B), true);
  assert.equal(isHumanAwardRole(ROLES.COMPANY_X_DISPATCHER, RFQ_LEVELS.MARKET_B), false);
});

test('Company Y role boundaries preserve carrier-only finance and document separation', () => {
  assert.equal(hasPermission(ROLES.COMPANY_Y_OWNER, PERMISSIONS.SEE_SETTLEMENT), true);
  assert.equal(hasPermission(ROLES.COMPANY_Y_OWNER, PERMISSIONS.SEE_LOCATION), true);
  assert.equal(hasPermission(ROLES.COMPANY_Y_DOCUMENT_ISSUER, PERMISSIONS.SEE_DOCUMENTS), true);
  assert.equal(hasPermission(ROLES.COMPANY_Y_DOCUMENT_ISSUER, PERMISSIONS.SEE_SETTLEMENT), false);
  assert.equal(isHumanAwardRole(ROLES.COMPANY_Y_OWNER, RFQ_LEVELS.MARKET_B), false);
  assert.throws(
    () => assertHumanAward({ actor: { role: ROLES.COMPANY_Y_OWNER }, level: RFQ_LEVELS.MARKET_B, winnerOrganizationType: 'driver' }),
    (error) => error instanceof DomainError && error.code === 'AWD-403'
  );
});

test('Driver role is limited to own operational writes and scoped reads', () => {
  assert.equal(hasPermission(ROLES.DRIVER, PERMISSIONS.CREATE), true);
  assert.equal(hasPermission(ROLES.DRIVER, PERMISSIONS.UPDATE), true);
  assert.equal(hasPermission(ROLES.DRIVER, PERMISSIONS.SEE_DOCUMENTS), true);
  assert.equal(hasPermission(ROLES.DRIVER, PERMISSIONS.SEE_LOCATION), true);
  assert.equal(hasPermission(ROLES.DRIVER, PERMISSIONS.APPROVE), false);
  assert.equal(hasPermission(ROLES.DRIVER, PERMISSIONS.SEE_SETTLEMENT), false);
  assert.equal(hasPermission(ROLES.DRIVER, PERMISSIONS.EXPORT), false);
});

test('Agent/Z role is limited to assigned delivery evidence and X-Agent settlement', () => {
  assert.equal(hasPermission(ROLES.AGENT_Z, PERMISSIONS.CREATE), true);
  assert.equal(hasPermission(ROLES.AGENT_Z, PERMISSIONS.SEE_DOCUMENTS), true);
  assert.equal(hasPermission(ROLES.AGENT_Z, PERMISSIONS.SEE_LOCATION), true);
  assert.equal(hasPermission(ROLES.AGENT_Z, PERMISSIONS.SEE_SETTLEMENT), true);
  assert.equal(hasPermission(ROLES.AGENT_Z, PERMISSIONS.SEE_CONTACT), false);
  assert.equal(hasPermission(ROLES.AGENT_Z, PERMISSIONS.SEE_PRICE), false);
  assert.equal(hasPermission(ROLES.AGENT_Z, PERMISSIONS.APPROVE), false);
  assert.equal(hasPermission(ROLES.AGENT_Z, PERMISSIONS.EXPORT), false);
});
