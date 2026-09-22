import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const appSource = readFileSync(resolve(import.meta.dirname, '..', 'src', 'App.jsx'), 'utf8');

test('keeps each production panel on a distinct role route', () => {
  for (const path of ['/app/shipper', '/app/forwarder', '/app/careers', '/app/driver', '/app/agent', '/admin/v2']) {
    assert.match(appSource, new RegExp(`path: '${path.replaceAll('/', '\\/')}'`), `missing panel route ${path}`);
  }
  assert.match(appSource, /if \(panelEntryRoute && !panelEntryRoute\.roles\.includes\(user\.role\)\)/);
  assert.match(appSource, /RolePanelAccessDenied/);
  assert.match(appSource, /function OrganizationLoginPage\(\{ panel, panelKey, onBack, onLoggedIn \}\)/);
  assert.match(appSource, /api\/auth\/login-platform/);
  assert.match(appSource, /ورود به پنل/);
  assert.match(appSource, /screen--organization-login/);
  assert.match(appSource, /if \(page === 'panel-entry' && panelEntryRoute\)/);
  assert.match(appSource, /roles: \['shipper_admin', 'shipper_logistics_user', 'shipper_finance_user', 'consignee'\]/);
  assert.match(appSource, /roles: \['agent_z'\]/);
  assert.match(appSource, /onLoggedIn=\{handleLoggedIn\}/);
  assert.match(appSource, /navigatePanelEntry/);
  assert.match(appSource, /heading: 'خوش آمدید، صاحب کالا'/);
  assert.match(appSource, /heading: 'خوش آمدید، فورواردر'/);
  assert.match(appSource, /heading: 'خوش آمدید، نماینده مقصد'/);
});
