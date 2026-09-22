import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNEX_ERROR_REGISTRY,
  CONTEXT_SESSION_MODES,
  DOCUMENT_TYPES,
  ERROR_CODES,
  EVENTS,
  OPERATING_CONTEXT_TYPE_BY_GRANT,
  OPERATING_CONTEXT_TYPES,
  ORGANIZATION_ROLE_GRANT_TYPES,
  ROLES,
  operatingContextTypeForRoleGrant
} from '../../shared/contract.js';

test('organization legal qualifications remain distinct from application user roles', () => {
  assert.equal(ORGANIZATION_ROLE_GRANT_TYPES.FORWARDER, 'FORWARDER');
  assert.equal(ORGANIZATION_ROLE_GRANT_TYPES.CARRIER, 'CARRIER');
  assert.notEqual(ORGANIZATION_ROLE_GRANT_TYPES.FORWARDER, ROLES.COMPANY_X_OWNER);
  assert.notEqual(ORGANIZATION_ROLE_GRANT_TYPES.CARRIER, ROLES.COMPANY_Y_OWNER);
  assert.equal(Object.isFrozen(ORGANIZATION_ROLE_GRANT_TYPES), true);
});

test('role grants map to separate operating context types without using a panel role', () => {
  assert.equal(OPERATING_CONTEXT_TYPE_BY_GRANT.FORWARDER, OPERATING_CONTEXT_TYPES.FORWARDER);
  assert.equal(OPERATING_CONTEXT_TYPE_BY_GRANT.CARRIER, OPERATING_CONTEXT_TYPES.CARRIER);
  assert.equal(operatingContextTypeForRoleGrant(' forwarder '), 'FWD');
  assert.equal(operatingContextTypeForRoleGrant('carrier'), 'CAR');
  assert.equal(operatingContextTypeForRoleGrant(ROLES.COMPANY_X_OWNER), null);
  assert.equal(operatingContextTypeForRoleGrant('unknown'), null);
  assert.equal(Object.isFrozen(OPERATING_CONTEXT_TYPES), true);
  assert.equal(Object.isFrozen(OPERATING_CONTEXT_TYPE_BY_GRANT), true);
});

test('bill of lading, CMR, and TIR carnet are distinct document domains', () => {
  const documentTypes = Object.values(DOCUMENT_TYPES);
  assert.equal(new Set(documentTypes).size, documentTypes.length);
  assert.equal(DOCUMENT_TYPES.BILL_OF_LADING, 'BILL_OF_LADING');
  assert.equal(DOCUMENT_TYPES.CMR, 'CMR');
  assert.equal(DOCUMENT_TYPES.TIR_CARNET, 'TIR_CARNET');
  assert.equal(Object.isFrozen(DOCUMENT_TYPES), true);
});

test('context session modes and errors have one shared contract', () => {
  assert.deepEqual(CONTEXT_SESSION_MODES, { BOOTSTRAP: 'bootstrap', CONTEXT: 'context' });
  assert.equal(ERROR_CODES.CONTEXT_BINDING, 'CTX-001');
  assert.equal(ERROR_CODES.CONTEXT_SESSION_CONFLICT, 'CTX-004');
  assert.equal(EVENTS.includes('ContextSwitched'), true);
  assert.equal(Object.isFrozen(CONTEXT_SESSION_MODES), true);
});

test('annex error registry preserves source HTTP mappings and open mappings', () => {
  const expectedHttp = {
    'CTX-001': 400,
    'CTX-002': 403,
    'CTX-003': 403,
    'CTX-004': 409,
    'AWD-004': 422,
    'RNK-002': 500,
    'CEG-003': 403,
    'CEG-004': 409,
    'CNT-005': 409,
    'CNT-006': 422,
    'FIN-007': 422,
    'FIN-008': 422,
    'FIN-009': 422,
    'CAP-001': 422,
    'CAP-002': 500,
    'FLT-006': 403,
    'FLT-007': 409,
    'FLT-008': 422,
    'TIR-004': 422,
    'DOC-010': 422,
    'GATE-002': 403
  };
  for (const [code, httpStatus] of Object.entries(expectedHttp)) {
    assert.equal(ANNEX_ERROR_REGISTRY[code].httpStatus, httpStatus, code);
    assert.equal(Object.isFrozen(ANNEX_ERROR_REGISTRY[code]), true, code);
  }
  for (const code of ['RNK-003', 'AUD-002', 'DOC-001', 'POD-003', 'INT-001']) {
    assert.equal(ANNEX_ERROR_REGISTRY[code].httpStatus, null, code);
  }
  assert.equal(Object.isFrozen(ANNEX_ERROR_REGISTRY), true);
  assert.equal(ERROR_CODES.INCOMPLETE_POD, 'POD-424');
  assert.equal(ERROR_CODES.FORBIDDEN_DIRECT_DRIVER_AWARD, 'AWD-403');
});
