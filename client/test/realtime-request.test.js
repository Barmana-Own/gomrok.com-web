import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRealtimeHeaders, encodePurposeHeader, shouldRetryRealtimeStatus } from '../src/hooks/realtime-request.js';

test('realtime admin headers carry the bounded encoded purpose without exposing raw Persian text', () => {
  const purpose = 'بازبینی حاکمیت بازار و کنترل دسترسی';
  const headers = buildRealtimeHeaders({ token: 'synthetic-token', purpose });

  assert.equal(headers.Authorization, 'Bearer synthetic-token');
  assert.equal(headers.Accept, 'text/event-stream');
  assert.equal(headers['X-Purpose-Scope'], encodePurposeHeader(purpose));
  assert.doesNotMatch(headers['X-Purpose-Scope'], /[\u0600-\u06ff]/);
  assert.ok(headers['X-Purpose-Scope'].length <= 512);
});

test('realtime retries dependency failures but stops deterministic client denials', () => {
  assert.equal(shouldRetryRealtimeStatus(428), false);
  assert.equal(shouldRetryRealtimeStatus(401), false);
  assert.equal(shouldRetryRealtimeStatus(403), false);
  assert.equal(shouldRetryRealtimeStatus(500), true);
  assert.equal(shouldRetryRealtimeStatus(503), true);
});
