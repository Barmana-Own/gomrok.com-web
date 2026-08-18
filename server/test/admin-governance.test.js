import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_ROLES, PERMISSIONS, ROLES, hasPermission } from '../../shared/contract.js';
import { assertRulePackInput, assertRulePackTransition, redact } from '../src/routes/admin.routes.js';

test('admin roles are explicit and do not inherit commercial price access', () => {
  assert.ok(ADMIN_ROLES.includes(ROLES.SUPER_ADMIN));
  assert.ok(ADMIN_ROLES.includes(ROLES.FINANCE_ADMIN));
  for (const role of ADMIN_ROLES) assert.equal(hasPermission(role, PERMISSIONS.SEE_PRICE), false, `${role} must not see commercial price by default`);
  assert.equal(hasPermission(ROLES.SECURITY_ADMIN, PERMISSIONS.SEE_AUDIT), true);
  assert.equal(hasPermission(ROLES.FINANCE_ADMIN, PERMISSIONS.SEE_SETTLEMENT), true);
});

test('RulePack lifecycle is versioned and rejects silent or invalid transitions', () => {
  assert.equal(assertRulePackTransition('DRAFT', 'REVIEW'), true);
  assert.equal(assertRulePackTransition('SCHEDULED', 'ACTIVE'), true);
  assert.throws(() => assertRulePackTransition('ACTIVE', 'DRAFT'), (error) => error.code === 'RULE-409');
  assert.throws(() => assertRulePackTransition('DRAFT', 'ACTIVE'), (error) => error.code === 'RULE-409');
  assert.throws(() => assertRulePackInput({ ruleKey: 'practice', level: 'C', sourceType: 'C', sourceRef: 'manual', hardGate: true, rules: {} }), (error) => error.code === 'CMP-451');
});

test('governance audit redacts commercial and raw contact keys', () => {
  const output = redact({ amount: 1200, quoteBody: { price: 800 }, phone: '0912', reason: 'review', nested: { margin: 4, state: 'OPEN' } });
  assert.equal(output.amount, '[REDACTED_BY_POLICY]');
  assert.equal(output.quoteBody, '[REDACTED_BY_POLICY]');
  assert.equal(output.phone, '[REDACTED_BY_POLICY]');
  assert.equal(output.reason, 'review');
  assert.equal(output.nested.margin, '[REDACTED_BY_POLICY]');
  assert.equal(output.nested.state, 'OPEN');
});
