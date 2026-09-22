import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import 'dotenv/config';
import { pingDatabase, pool } from './db.js';
import platformRouter from './routes/platform.routes.js';
import adminRouter from './routes/admin.routes.js';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  IS_PRODUCTION,
  JWT_SECRET,
  OPERATING_CONTEXT_SESSIONS_ENABLED,
  PLATFORM_TENANT_ID
} from './config.js';
import { platformAuth, resolveIdempotencyKey } from './security/platform-auth.js';
import { CONTEXT_SESSION_MODES, ERROR_CODES, PERMISSIONS, ROLES } from '../../shared/contract.js';
import {
  assertContextSessionFeatureEnabled,
  createOperatingContextSessionService,
  publicOperatingContext
} from './services/operating-context-session.service.js';
import {
  publicPlatformUser,
  selectPlatformMembership,
  validatePlatformLoginInput
} from './services/platform-login.service.js';
import { invalidateRealtimeSession } from './realtime/broker.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const jwtSecret = JWT_SECRET;
const adminUsername = ADMIN_USERNAME;
const adminPassword = ADMIN_PASSWORD;
const operatingContextSessionService = createOperatingContextSessionService(pool);
const platformLoginDummyHash = bcrypt.hashSync(`invalid-platform-login:${randomBytes(24).toString('hex')}`, 10);

const configuredOrigins = String(process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5083',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5083',
  'http://gomrok.org',
  'https://gomrok.org',
  'http://www.gomrok.org',
  'https://www.gomrok.org',
  ...configuredOrigins
]);

const authAttempts = new Map();
const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX_ATTEMPTS = 12;

function authRateLimit(request, response, next) {
  const now = Date.now();
  const address = String(request.socket?.remoteAddress || 'unknown');
  const key = `${address}:${request.path}`;
  const current = authAttempts.get(key) || { count: 0, startedAt: now };
  if (now - current.startedAt >= AUTH_WINDOW_MS) {
    current.count = 0;
    current.startedAt = now;
  }
  current.count += 1;
  authAttempts.set(key, current);
  if (authAttempts.size > 10000) {
    for (const [entryKey, entry] of authAttempts) if (now - entry.startedAt >= AUTH_WINDOW_MS) authAttempts.delete(entryKey);
  }
  if (current.count > AUTH_MAX_ATTEMPTS) {
    response.setHeader('Retry-After', '60');
    return response.status(429).json({ code: 'AUTH-429', message: 'تعداد تلاش‌های ورود بیش از حد مجاز است.' });
  }
  return next();
}

// Keep the API usable from the local development host and from the deployed
// same-origin app. Handling preflight explicitly is important here because
// the production frontend is served behind IIS and sends JSON requests.
app.use((request, response, next) => {
  const origin = String(request.headers.origin || '').trim();

  if (origin && !allowedOrigins.has(origin)) {
    if (request.method === 'OPTIONS') {
      return response.status(403).json({ message: 'مبدأ درخواست مجاز نیست.' });
    }
    return next();
  }

  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }

  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-Id, Idempotency-Key, X-Idempotency-Key, X-Operating-Context, X-Purpose-Scope, X-Device-Id, X-Step-Up-Token, X-Step-Up');
    return response.status(204).end();
  }

  return next();
});
app.use((request, response, next) => {
  request.correlationId = String(request.headers['x-correlation-id'] || randomBytes(12).toString('hex')).slice(0, 128);
  response.setHeader('X-Correlation-Id', request.correlationId);
  next();
});
app.use(express.json({ limit: '64kb' }));

function normalizeDigits(value = '') {
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));
}

function digits(value = '') {
  return normalizeDigits(value).replace(/\D/g, '');
}

function issueToken(account, role = 'driver', membership = {}, session = null) {
  const claims = {
    sub: String(account.id),
    userId: membership.userId || account.id,
    membershipId: membership.membershipId || null,
    organizationId: membership.organizationId || null,
    externalType: membership.externalType || role,
    externalId: membership.externalId || account.id,
    role,
    tenantId: account.tenant_id
  };
  if (session) {
    claims.sessionId = session.sessionId;
    claims.sessionMode = session.mode;
    claims.sessionGeneration = session.generation;
    claims.contextId = session.activeContextId || null;
  }
  return jwt.sign(claims, jwtSecret, { expiresIn: '15m' });
}

function sessionTokenResponse(result) {
  const account = {
    id: result.binding.externalId || result.binding.userId,
    tenant_id: result.binding.tenantId
  };
  return {
    token: issueToken(account, result.binding.role, result.binding, result.session),
    refreshToken: result.refreshToken,
    session: {
      mode: result.session.mode,
      generation: result.session.generation,
      contextSelectionRequired: result.session.mode === CONTEXT_SESSION_MODES.BOOTSTRAP,
      activeContext: result.session.mode === CONTEXT_SESSION_MODES.CONTEXT
        ? publicOperatingContext(result.binding)
        : null,
      expiresAt: new Date(result.session.expiresAt).toISOString()
    }
  };
}

function contextSessionProblem(response, request, error) {
  const status = Number(error.status || error.statusCode || 500);
  const code = error.code || 'CTX-500';
  const safeCodes = new Set(['AUTH-401', 'AUTH-403', 'CTX-001', 'CTX-004', 'CTX-503']);
  return response.status(status).type('application/problem+json').json({
    type: `https://gomrok.org/problems/${code}`,
    title: code,
    status,
    detail: safeCodes.has(code) && error.message ? error.message : 'عملیات نشست زمینه انجام نشد.',
    code,
    correlationId: request.correlationId
  });
}

function requireContextSessionFeature(request, response, next) {
  try {
    assertContextSessionFeatureEnabled(OPERATING_CONTEXT_SESSIONS_ENABLED);
    return next();
  } catch (error) {
    return contextSessionProblem(response, request, error);
  }
}

function issueAdminToken() {
  return jwt.sign({ sub: 'super-admin', role: 'super_admin' }, jwtSecret, { expiresIn: '4h' });
}

function requireAdmin(request, response, next) {
  if (IS_PRODUCTION) return response.status(410).json({ code: 'AUTH-410', message: 'مسیر Legacy Admin در محیط تولید غیرفعال است؛ از IAM سازمانی استفاده کنید.' });
  const authorization = String(request.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return response.status(401).json({ message: 'ورود مدیر سیستم لازم است.' });

  try {
    const claims = jwt.verify(token, jwtSecret);
    if (claims.role !== 'super_admin') return response.status(403).json({ message: 'دسترسی پنل مدیریت مجاز نیست.' });
    const purpose = String(request.headers['x-purpose-scope'] || '').trim();
    if (purpose.length < 8) return response.status(428).json({ code: 'AUTH-428', message: 'دسترسی Legacy Admin نیز به Purpose Scope نیاز دارد.' });
    claims.purpose = purpose;
    request.admin = claims;
    return next();
  } catch (_error) {
    return response.status(401).json({ message: 'نشست پنل مدیریت منقضی یا نامعتبر است.' });
  }
}

function publicDriver(driver) {
  return {
    id: driver.id,
    firstName: driver.first_name,
    lastName: driver.last_name,
    nationalId: driver.national_id,
    phone: driver.phone,
    province: driver.province,
    city: driver.city,
    status: driver.status,
    role: 'driver'
  };
}

function publicCarrier(carrier) {
  return {
    id: carrier.id,
    businessName: carrier.business_name,
    registrationNumber: carrier.registration_number || null,
    nationalIdentifier: carrier.identity_number,
    managerName: [carrier.manager_first_name, carrier.manager_last_name].filter(Boolean).join(' '),
    phone: carrier.phone,
    province: carrier.province,
    city: carrier.city,
    status: carrier.status,
    role: 'carrier'
  };
}

function publicRegistration(row) {
  const isDriver = row.role === 'driver';
  return {
    id: row.id,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    nationalId: row.national_id,
    businessName: row.business_name,
    registrationNumber: row.registration_number,
    nationalIdentifier: row.national_identifier,
    managerName: row.manager_name,
    phone: row.phone,
    province: row.province,
    status: row.status,
    accountId: row.account_id,
    accountCreated: Boolean(row.account_id),
    accountCreatedAt: row.account_created_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: 'registration',
    label: isDriver ? 'راننده' : 'شرکت حمل‌ونقل'
  };
}

function maskAdminValue(value, visible = 2) {
  const text = String(value || '');
  if (!text) return null;
  if (text.length <= visible) return '*'.repeat(text.length);
  return `${text.slice(0, visible)}${'*'.repeat(Math.min(Math.max(text.length - visible, 3), 8))}`;
}

function publicAdminRegistration(row) {
  return {
    id: row.id,
    role: row.role,
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    businessName: row.business_name || null,
    phone: maskAdminValue(row.phone, 3),
    nationalId: maskAdminValue(row.national_id, 2),
    registrationNumber: maskAdminValue(row.registration_number, 2),
    nationalIdentifier: maskAdminValue(row.national_identifier, 2),
    province: row.province || null,
    status: row.status,
    accountId: row.account_id,
    accountCreated: Boolean(row.account_id),
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: 'legacy-registration-governance'
  };
}

function registrationRole(role) {
  if (role === 'driver' || role === 'drivers') return 'driver';
  if (role === 'carrier' || role === 'carriers') return 'carrier';
  return null;
}

function roleConfig(role) {
  return role === 'driver'
    ? { table: 'drivers', label: 'راننده', plural: 'راننده‌ها' }
    : { table: 'carriers', label: 'شرکت حمل‌ونقل', plural: 'شرکت‌های حمل‌ونقل' };
}

function cleanManagerName(payload) {
  const direct = String(payload.managerName || '').trim();
  if (direct) return direct;
  return [payload.managerFirstName, payload.managerLastName]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function driverPayload(payload) {
  return {
    firstName: String(payload.firstName || '').trim(),
    lastName: String(payload.lastName || '').trim(),
    nationalId: digits(payload.nationalId),
    phone: normalizeDigits(payload.phone).replace(/\s/g, ''),
    province: String(payload.province || '').trim()
  };
}

function carrierPayload(payload) {
  return {
    businessName: String(payload.businessName || '').trim(),
    registrationNumber: digits(payload.registrationNumber),
    nationalIdentifier: digits(payload.nationalIdentifier || payload.identityNumber),
    managerName: cleanManagerName(payload),
    phone: normalizeDigits(payload.phone).replace(/\s/g, ''),
    province: String(payload.province || '').trim()
  };
}

function validateDriver(payload) {
  if (!payload.firstName || !payload.lastName || !/^\d{10}$/.test(payload.nationalId) || !/^09\d{9}$/.test(payload.phone) || !payload.province) {
    return 'اطلاعات راننده کامل یا معتبر نیست.';
  }
  return '';
}

function validateCarrier(payload) {
  if (
    payload.businessName.length < 2 ||
    !/^\d{1,32}$/.test(payload.registrationNumber) ||
    !/^\d{11}$/.test(payload.nationalIdentifier) ||
    payload.managerName.length < 2 ||
    !/^09\d{9}$/.test(payload.phone) ||
    !payload.province
  ) {
    return 'اطلاعات شرکت حمل‌ونقل کامل یا معتبر نیست.';
  }
  return '';
}

async function writeAudit({ actorId, eventType, subjectType = 'driver', subjectId, payload = {}, executor = pool }) {
  await executor.execute(
    `INSERT INTO audit_events (actor_id, event_type, subject_type, subject_id, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [actorId || null, eventType, subjectType, subjectId || null, JSON.stringify(payload)]
  );
}

async function createDriverRegistration(payload, response) {
  const input = driverPayload(payload);
  const validationMessage = validateDriver(input);
  if (validationMessage) return response.status(400).json({ message: validationMessage });

  try {
    const [existingAccount] = await pool.execute(
      'SELECT id FROM drivers WHERE national_id = ? OR phone = ? LIMIT 1',
      [input.nationalId, input.phone]
    );
    const [existingRequest] = await pool.execute(
      `SELECT id FROM registration_requests
       WHERE role = 'driver' AND status <> 'rejected'
         AND (national_id = ? OR phone = ?) LIMIT 1`,
      [input.nationalId, input.phone]
    );
    if (existingAccount.length || existingRequest.length) {
      return response.status(409).json({ message: 'این کد ملی یا شماره تماس قبلاً ثبت شده است.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO registration_requests
       (tenant_id, role, first_name, last_name, national_id, phone, province, status)
       VALUES ('platform', 'driver', ?, ?, ?, ?, ?, 'pending')`,
      [input.firstName, input.lastName, input.nationalId, input.phone, input.province]
    );
    const [rows] = await pool.execute('SELECT * FROM registration_requests WHERE id = ?', [result.insertId]);
    await writeAudit({ eventType: 'DriverRegistrationRequested', subjectId: result.insertId, payload: { source: 'mobile-web' } });
    return response.status(201).json({
      message: 'درخواست ثبت‌نام راننده ثبت شد و پس از تأیید حساب ایجاد می‌شود.',
      registration: publicRegistration(rows[0])
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: 'ثبت درخواست انجام نشد؛ اتصال دیتابیس را بررسی کن.' });
  }
}

async function createCarrierRegistration(payload, response) {
  const input = carrierPayload(payload);
  const validationMessage = validateCarrier(input);
  if (validationMessage) return response.status(400).json({ message: validationMessage });

  try {
    const [existingAccount] = await pool.execute(
      'SELECT id FROM carriers WHERE identity_number = ? OR phone = ? LIMIT 1',
      [input.nationalIdentifier, input.phone]
    );
    const [existingRequest] = await pool.execute(
      `SELECT id FROM registration_requests
       WHERE role = 'carrier' AND status <> 'rejected'
         AND (national_identifier = ? OR phone = ? OR registration_number = ?) LIMIT 1`,
      [input.nationalIdentifier, input.phone, input.registrationNumber]
    );
    if (existingAccount.length || existingRequest.length) {
      return response.status(409).json({ message: 'این شناسه، شماره ثبت یا شماره تماس قبلاً ثبت شده است.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO registration_requests
       (tenant_id, role, business_name, registration_number, national_identifier, manager_name, phone, province, status)
       VALUES ('platform', 'carrier', ?, ?, ?, ?, ?, ?, 'pending')`,
      [input.businessName, input.registrationNumber, input.nationalIdentifier, input.managerName, input.phone, input.province]
    );
    const [rows] = await pool.execute('SELECT * FROM registration_requests WHERE id = ?', [result.insertId]);
    await writeAudit({ eventType: 'CarrierRegistrationRequested', subjectType: 'carrier', subjectId: result.insertId, payload: { source: 'mobile-web' } });
    return response.status(201).json({
      message: 'درخواست ثبت‌نام شرکت حمل‌ونقل ثبت شد و پس از تأیید حساب ایجاد می‌شود.',
      registration: publicRegistration(rows[0])
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: 'ثبت درخواست شرکت حمل‌ونقل انجام نشد؛ اتصال دیتابیس را بررسی کن.' });
  }
}

app.get('/api/health', async (_request, response) => {
  try {
    await pingDatabase();
    response.json({ ok: true, service: 'gomrok-server', database: 'up', domain: 'gomrok.org' });
  } catch (error) {
    response.status(503).json({ ok: false, service: 'gomrok-server', database: 'down', message: error.message });
  }
});

app.post('/api/admin/login', authRateLimit, (request, response) => {
  if (IS_PRODUCTION) return response.status(410).json({ code: 'AUTH-410', message: 'ورود Legacy Admin در محیط تولید غیرفعال است.' });
  const username = String(request.body?.username || '').trim();
  const password = String(request.body?.password || '');
  if (!adminPassword) {
    return response.status(503).json({ code: 'AUTH-503', message: 'ورود مدیر تا زمان تنظیم ADMIN_PASSWORD غیرفعال است.' });
  }
  if (username !== adminUsername || password !== adminPassword) {
    return response.status(401).json({ message: 'نام کاربری یا رمز عبور مدیر سیستم اشتباه است.' });
  }
  return response.json({ token: issueAdminToken(), admin: { username: adminUsername, role: 'super_admin' } });
});

async function listRegistrations(role, response) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, role, first_name, last_name, national_id, phone, province,
              business_name, registration_number, national_identifier, manager_name,
              status, account_id, account_created_at, approved_at, approved_by,
              created_at, updated_at
       FROM registration_requests WHERE role = ? ORDER BY created_at DESC`,
      [role]
    );
    return response.json({ items: rows.map(publicAdminRegistration) });
  } catch (error) {
    console.error(error);
    return response.status(503).json({ message: `فهرست ${roleConfig(role).plural} در دسترس نیست؛ اتصال دیتابیس را بررسی کن.` });
  }
}

app.get('/api/admin/summary', requireAdmin, async (_request, response) => {
  try {
    const [rows] = await pool.query(
      `SELECT role, COUNT(*) AS total,
              SUM(status = 'pending') AS pending,
              SUM(status = 'active') AS active,
              SUM(status = 'disabled') AS disabled
       FROM registration_requests GROUP BY role`
    );
    const summary = { drivers: 0, carriers: 0, pendingDrivers: 0, pendingCarriers: 0, activeDrivers: 0, activeCarriers: 0, disabledDrivers: 0, disabledCarriers: 0 };
    for (const row of rows) {
      const prefix = row.role === 'driver' ? 'Drivers' : 'Carriers';
      summary[row.role === 'driver' ? 'drivers' : 'carriers'] = Number(row.total || 0);
      summary[`pending${prefix}`] = Number(row.pending || 0);
      summary[`active${prefix}`] = Number(row.active || 0);
      summary[`disabled${prefix}`] = Number(row.disabled || 0);
    }
    return response.json(summary);
  } catch (error) {
    console.error(error);
    return response.status(503).json({ message: 'اطلاعات آماری در دسترس نیست؛ اتصال دیتابیس را بررسی کن.' });
  }
});

app.get('/api/admin/registrations/drivers', requireAdmin, (_request, response) => listRegistrations('driver', response));
app.get('/api/admin/registrations/carriers', requireAdmin, (_request, response) => listRegistrations('carrier', response));
// Backward-compatible aliases for the first version of the admin panel.
app.get('/api/admin/drivers', requireAdmin, (_request, response) => listRegistrations('driver', response));
app.get('/api/admin/carriers', requireAdmin, (_request, response) => listRegistrations('carrier', response));

app.post('/api/registrations/driver', (request, response) => createDriverRegistration(request.body || {}, response));
app.post('/api/registrations/carrier', (request, response) => createCarrierRegistration(request.body || {}, response));
// Keep the original public endpoints working while the new /app routes use
// the registration-request workflow.
app.post('/api/auth/register-driver', (request, response) => createDriverRegistration(request.body || {}, response));
app.post('/api/auth/register-carrier', (request, response) => createCarrierRegistration(request.body || {}, response));

function temporaryPassword() {
  return randomBytes(9).toString('base64url');
}

async function approveRegistration(role, id, adminUsernameValue) {
  const connection = await pool.getConnection();
  let generatedPassword = null;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM registration_requests WHERE id = ? AND role = ? FOR UPDATE', [id, role]);
    const registration = rows[0];
    if (!registration) {
      const error = new Error('درخواست ثبت‌نام پیدا نشد.');
      error.statusCode = 404;
      throw error;
    }

    let accountId = registration.account_id;
    if (accountId) {
      await connection.execute(`UPDATE ${roleConfig(role).table} SET status = 'active' WHERE id = ?`, [accountId]);
    } else {
      generatedPassword = temporaryPassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 12);
      if (role === 'driver') {
        const [result] = await connection.execute(
          `INSERT INTO drivers
           (tenant_id, first_name, last_name, national_id, phone, province, city, password_hash, status)
           VALUES ('platform', ?, ?, ?, ?, ?, '', ?, 'active')`,
          [registration.first_name, registration.last_name, registration.national_id, registration.phone, registration.province, passwordHash]
        );
        accountId = result.insertId;
      } else {
        const managerName = String(registration.manager_name || '').slice(0, 80);
        const [result] = await connection.execute(
          `INSERT INTO carriers
           (tenant_id, carrier_type, business_name, registration_number, manager_first_name, manager_last_name,
            identity_number, phone, email, province, city, address, password_hash, status)
           VALUES ('platform', 'شرکت حمل‌ونقل', ?, ?, ?, '', ?, ?, NULL, ?, '', NULL, ?, 'active')`,
          [registration.business_name, registration.registration_number, managerName, registration.national_identifier, registration.phone, registration.province, passwordHash]
        );
        accountId = result.insertId;
      }
    }

    await connection.execute(
      `UPDATE registration_requests
       SET status = 'active', account_id = ?, account_created_at = COALESCE(account_created_at, NOW()),
           approved_at = NOW(), approved_by = ?
       WHERE id = ?`,
      [accountId, adminUsernameValue, id]
    );
    await connection.commit();
    return { accountId, generatedPassword };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

app.patch('/api/admin/registrations/:role/:id/status', requireAdmin, async (request, response) => {
  const role = registrationRole(request.params.role);
  const id = Number(request.params.id);
  const action = String(request.body?.action || '').trim();
  if (!role || !Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'شناسه درخواست معتبر نیست.' });

  try {
    if (action === 'approve') {
      const result = await approveRegistration(role, id, adminUsername);
      await writeAudit({ eventType: 'RegistrationApproved', subjectType: role, subjectId: id, payload: { accountId: result.accountId } });
      return response.json({ message: 'درخواست تأیید شد و حساب ایجاد یا فعال شد.', ...result });
    }

    const [rows] = await pool.execute('SELECT * FROM registration_requests WHERE id = ? AND role = ?', [id, role]);
    const registration = rows[0];
    if (!registration) return response.status(404).json({ message: 'درخواست ثبت‌نام پیدا نشد.' });

    if (action === 'disable' || action === 'enable') {
      const nextStatus = action === 'disable' ? 'disabled' : (registration.account_id ? 'active' : 'pending');
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        if (registration.account_id) {
          await connection.execute(`UPDATE ${roleConfig(role).table} SET status = ? WHERE id = ?`, [nextStatus, registration.account_id]);
        }
        await connection.execute('UPDATE registration_requests SET status = ? WHERE id = ?', [nextStatus, id]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      await writeAudit({ eventType: action === 'disable' ? 'RegistrationDisabled' : 'RegistrationEnabled', subjectType: role, subjectId: id });
      return response.json({ message: action === 'disable' ? 'حساب غیرفعال شد.' : 'حساب فعال شد.' });
    }

    if (action === 'reject') {
      if (registration.account_id) return response.status(409).json({ message: 'حساب ایجادشده را نمی‌توان رد کرد؛ ابتدا آن را غیرفعال کن.' });
      await pool.execute("UPDATE registration_requests SET status = 'rejected' WHERE id = ?", [id]);
      await writeAudit({ eventType: 'RegistrationRejected', subjectType: role, subjectId: id });
      return response.json({ message: 'درخواست رد شد.' });
    }

    return response.status(400).json({ message: 'عملیات وضعیت شناخته نشد.' });
  } catch (error) {
    console.error(error);
    return response.status(error.statusCode || 500).json({ message: error.message || 'تغییر وضعیت انجام نشد.' });
  }
});

app.put('/api/admin/registrations/:role/:id', requireAdmin, async (request, response) => {
  const role = registrationRole(request.params.role);
  const id = Number(request.params.id);
  if (!role || !Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'شناسه درخواست معتبر نیست.' });

  const input = role === 'driver' ? driverPayload(request.body || {}) : carrierPayload(request.body || {});
  const validationMessage = role === 'driver' ? validateDriver(input) : validateCarrier(input);
  if (validationMessage) return response.status(400).json({ message: validationMessage });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM registration_requests WHERE id = ? AND role = ? FOR UPDATE', [id, role]);
    const registration = rows[0];
    if (!registration) {
      await connection.rollback();
      return response.status(404).json({ message: 'درخواست ثبت‌نام پیدا نشد.' });
    }

    if (role === 'driver') {
      await connection.execute(
        `UPDATE registration_requests SET first_name = ?, last_name = ?, national_id = ?, phone = ?, province = ? WHERE id = ?`,
        [input.firstName, input.lastName, input.nationalId, input.phone, input.province, id]
      );
      if (registration.account_id) {
        await connection.execute(
          `UPDATE drivers SET first_name = ?, last_name = ?, national_id = ?, phone = ?, province = ? WHERE id = ?`,
          [input.firstName, input.lastName, input.nationalId, input.phone, input.province, registration.account_id]
        );
      }
    } else {
      await connection.execute(
        `UPDATE registration_requests
         SET business_name = ?, registration_number = ?, national_identifier = ?, manager_name = ?, phone = ?, province = ?
         WHERE id = ?`,
        [input.businessName, input.registrationNumber, input.nationalIdentifier, input.managerName, input.phone, input.province, id]
      );
      if (registration.account_id) {
        await connection.execute(
          `UPDATE carriers SET business_name = ?, registration_number = ?, manager_first_name = ?, identity_number = ?, phone = ?, province = ? WHERE id = ?`,
          [input.businessName, input.registrationNumber, input.managerName.slice(0, 80), input.nationalIdentifier, input.phone, input.province, registration.account_id]
        );
      }
    }
    await connection.commit();
    await writeAudit({ eventType: 'RegistrationUpdated', subjectType: role, subjectId: id });
    return response.json({ message: 'اطلاعات کاربر ویرایش شد.' });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: 'کد ملی، شناسه یا شماره تماس تکراری است.' });
    return response.status(500).json({ message: 'ویرایش اطلاعات انجام نشد.' });
  } finally {
    connection.release();
  }
});

app.delete('/api/admin/registrations/:role/:id', requireAdmin, async (request, response) => {
  const role = registrationRole(request.params.role);
  const id = Number(request.params.id);
  if (!role || !Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'شناسه درخواست معتبر نیست.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT account_id, status FROM registration_requests WHERE id = ? AND role = ? FOR UPDATE', [id, role]);
    const registration = rows[0];
    if (!registration) {
      await connection.rollback();
      return response.status(404).json({ message: 'درخواست ثبت‌نام پیدا نشد.' });
    }
    if (registration.account_id) {
      await connection.execute(`UPDATE ${roleConfig(role).table} SET status = 'disabled' WHERE id = ?`, [registration.account_id]);
    }
    await connection.execute("UPDATE registration_requests SET status = 'disabled' WHERE id = ? AND role = ?", [id, role]);
    await connection.commit();
    await writeAudit({ eventType: 'RegistrationSoftDeleted', subjectType: role, subjectId: id, payload: { previousStatus: registration.status } });
    return response.json({ message: 'رکورد به‌صورت غیرمخرب غیرفعال شد.' });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: 'حذف اطلاعات انجام نشد.' });
  } finally {
    connection.release();
  }
});

app.get('/api/admin/registrations/:role/export', requireAdmin, async (request, response) => {
  const role = registrationRole(request.params.role);
  if (!role) return response.status(400).json({ message: 'نوع کاربر معتبر نیست.' });
  await writeAudit({ eventType: 'RegistrationExportBlocked', subjectType: role, payload: { reason: 'governed-export-required', admin: request.admin?.sub || null } });
  return response.status(403).type('application/problem+json').json({
    type: 'https://gomrok.org/problems/CRM-403',
    title: 'CRM-403',
    status: 403,
    code: 'CRM-403',
    detail: 'خروجی عمومی غیرفعال است؛ ابتدا درخواست خروجی محدوده‌دار و تأیید شخص دوم ثبت کنید.'
  });
});

async function ensurePlatformMembership(account, accountType) {
  const tenantId = account.tenant_id || 'platform';
  const isCarrier = accountType === 'carrier';
  const role = isCarrier ? 'company_y_owner' : 'driver';
  const organizationId = isCarrier ? `company-y:${account.id}` : `driver:${account.id}`;
  const organizationType = isCarrier ? 'company_y' : 'driver';
  const displayName = isCarrier
    ? String(account.business_name || `Company Y ${account.id}`)
    : `${account.first_name || ''} ${account.last_name || ''}`.trim() || `Driver ${account.id}`;

  await pool.execute(
    `INSERT INTO platform_organizations
      (id, tenant_id, organization_type, display_name, qualification_state)
     VALUES (?, ?, ?, ?, 'qualified')
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), status = 'active'`,
    [organizationId, tenantId, organizationType, displayName]
  );
  await pool.execute(
    `INSERT INTO platform_users (tenant_id, external_type, external_id, display_name)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), status = 'active'`,
    [tenantId, accountType, account.id, displayName]
  );
  const [users] = await pool.execute(
    `SELECT id FROM platform_users WHERE tenant_id = ? AND external_type = ? AND external_id = ? LIMIT 1`,
    [tenantId, accountType, account.id]
  );
  const userId = users[0]?.id;
  await pool.execute(
    `INSERT INTO organization_memberships
      (tenant_id, organization_id, user_id, role, transaction_role, qualification_state, kyc_level, status)
     VALUES (?, ?, ?, ?, ?, 'qualified', 'verified', 'active')
     ON DUPLICATE KEY UPDATE status = 'active', qualification_state = 'qualified', kyc_level = 'verified'`,
    [tenantId, organizationId, userId, role, isCarrier ? 'carrier' : 'driver']
  );
  const [memberships] = await pool.execute(
    `SELECT id FROM organization_memberships WHERE tenant_id = ? AND organization_id = ? AND user_id = ? AND role = ? LIMIT 1`,
    [tenantId, organizationId, userId, role]
  );
  return { userId, membershipId: memberships[0]?.id, organizationId, externalType: accountType, externalId: account.id, role };
}

function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function issueRefreshToken(account, membership) {
  const token = randomBytes(48).toString('base64url');
  await pool.execute(
    `INSERT INTO platform_refresh_tokens (tenant_id, user_id, membership_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [account.tenant_id, membership.userId, membership.membershipId, hashRefreshToken(token)]
  );
  return token;
}

async function issueLoginTokens(account, role, membership) {
  if (OPERATING_CONTEXT_SESSIONS_ENABLED) {
    const contextSession = await operatingContextSessionService.startLoginSession({
      tenantId: account.tenant_id,
      userId: membership.userId,
      originMembershipId: membership.membershipId
    });
    if (contextSession) return sessionTokenResponse(contextSession);
  }
  const refreshToken = await issueRefreshToken(account, membership);
  return { token: issueToken(account, role, membership), refreshToken };
}

async function rotateLegacyRefreshToken(token) {
  const tokenHash = hashRefreshToken(token);
  const [rows] = await pool.execute(
    `SELECT r.*, m.organization_id, m.role, u.external_type, u.external_id
       FROM platform_refresh_tokens r
       JOIN organization_memberships m ON m.id = r.membership_id AND m.tenant_id = r.tenant_id
       JOIN platform_users u ON u.id = r.user_id AND u.tenant_id = r.tenant_id
      WHERE r.token_hash = ? AND r.revoked_at IS NULL AND r.expires_at > NOW()
        AND m.status = 'active' AND u.status = 'active'
      LIMIT 1`,
    [tokenHash]
  );
  const current = rows[0];
  if (!current) {
    const error = new Error('توکن نوسازی نامعتبر یا منقضی است.');
    error.statusCode = 401;
    error.code = 'AUTH-401';
    throw error;
  }
  const account = { id: current.external_id, tenant_id: current.tenant_id };
  const membership = {
    userId: current.user_id,
    membershipId: current.membership_id,
    organizationId: current.organization_id,
    externalType: current.external_type,
    externalId: current.external_id
  };
  const nextRefreshToken = await issueRefreshToken(account, membership);
  await pool.execute(`UPDATE platform_refresh_tokens SET revoked_at = NOW(), rotated_to_hash = ? WHERE id = ? AND revoked_at IS NULL`, [hashRefreshToken(nextRefreshToken), current.id]);
  return { token: issueToken(account, current.role, membership), refreshToken: nextRefreshToken };
}

app.post('/api/auth/refresh', authRateLimit, async (request, response) => {
  const refreshToken = typeof request.body?.refreshToken === 'string' ? request.body.refreshToken : '';
  if (!refreshToken) return response.status(400).json({ code: 'AUTH-400', message: 'توکن نوسازی لازم است.' });
  try {
    if (OPERATING_CONTEXT_SESSIONS_ENABLED) {
      const contextRotation = await operatingContextSessionService.rotateContextRefreshToken(refreshToken);
      if (contextRotation) return response.json(sessionTokenResponse(contextRotation));
    }
    return response.json(await rotateLegacyRefreshToken(refreshToken));
  } catch (error) {
    if (
      error?.code === ERROR_CODES.CONTEXT_BINDING ||
      error?.code === ERROR_CODES.CONTEXT_SESSION_CONFLICT
    ) {
      return contextSessionProblem(response, request, error);
    }
    const status = Number(error.status || error.statusCode || 500);
    const code = error.code || 'AUTH-500';
    const safeCodes = new Set(['AUTH-401']);
    return response.status(status).json({
      code,
      message: safeCodes.has(code) && error.message ? error.message : 'نوسازی نشست انجام نشد.'
    });
  }
});

app.get(
  '/api/platform/me/contexts',
  requireContextSessionFeature,
  platformAuth({ sessionMode: 'selection' }),
  async (request, response) => {
    try {
      const contexts = await operatingContextSessionService.listAvailableContexts({
        tenantId: request.contextSession.tenantId,
        userId: request.contextSession.userId
      });
      return response.json({
        session: {
          mode: request.contextSession.sessionMode,
          generation: request.contextSession.sessionGeneration,
          activeContextId: request.contextSession.contextId
        },
        contexts: contexts.map(publicOperatingContext)
      });
    } catch (error) {
      return contextSessionProblem(response, request, error);
    }
  }
);

app.post(
  '/api/auth/context/select',
  requireContextSessionFeature,
  authRateLimit,
  platformAuth({ sessionMode: 'bootstrap' }),
  async (request, response) => {
    try {
      const result = await operatingContextSessionService.transitionContext({
        claims: request.contextSession,
        targetContextId: request.body?.targetContextId,
        rawRefreshToken: request.body?.refreshToken,
        expectedMode: CONTEXT_SESSION_MODES.BOOTSTRAP,
        correlationId: request.correlationId
      });
      invalidateRealtimeSession(result.session.sessionId, result.session.generation);
      return response.json(sessionTokenResponse(result));
    } catch (error) {
      return contextSessionProblem(response, request, error);
    }
  }
);

app.post(
  '/api/auth/context/switch',
  requireContextSessionFeature,
  authRateLimit,
  platformAuth({ sessionMode: 'context' }),
  async (request, response) => {
    try {
      const result = await operatingContextSessionService.transitionContext({
        claims: request.contextSession,
        targetContextId: request.body?.targetContextId,
        rawRefreshToken: request.body?.refreshToken,
        expectedMode: CONTEXT_SESSION_MODES.CONTEXT,
        correlationId: request.correlationId
      });
      invalidateRealtimeSession(result.session.sessionId, result.session.generation);
      return response.json(sessionTokenResponse(result));
    } catch (error) {
      return contextSessionProblem(response, request, error);
    }
  }
);

app.post('/api/auth/login', authRateLimit, async (request, response) => {
  const phone = normalizeDigits(request.body?.phone).replace(/\s/g, '');
  const password = String(request.body?.password || '');
  if (!/^09\d{9}$/.test(phone) || !password) return response.status(400).json({ message: 'شماره تماس و رمز عبور را وارد کن.' });

  try {
    const [rows] = await pool.execute('SELECT * FROM drivers WHERE phone = ? LIMIT 1', [phone]);
    const driver = rows[0];
    if (!driver || driver.status !== 'active' || !driver.password_hash || !(await bcrypt.compare(password, driver.password_hash))) {
      return response.status(401).json({ message: 'حساب راننده فعال نیست یا اطلاعات ورود اشتباه است.' });
    }
    const membership = await ensurePlatformMembership(driver, 'driver');
    const tokens = await issueLoginTokens(driver, 'driver', membership);
    await writeAudit({ actorId: driver.id, eventType: 'DriverLoggedIn', subjectId: driver.id, payload: { source: 'mobile-web', organizationId: membership.organizationId } });
    return response.json({ ...tokens, user: publicDriver(driver) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: 'ورود انجام نشد؛ اتصال دیتابیس را بررسی کن.' });
  }
});

app.post('/api/auth/login-carrier', authRateLimit, async (request, response) => {
  const phone = normalizeDigits(request.body?.phone).replace(/\s/g, '');
  const password = String(request.body?.password || '');
  if (!/^09\d{9}$/.test(phone) || !password) return response.status(400).json({ message: 'شماره تماس و رمز عبور را وارد کن.' });

  try {
    const [rows] = await pool.execute('SELECT * FROM carriers WHERE phone = ? LIMIT 1', [phone]);
    const carrier = rows[0];
    if (!carrier || carrier.status !== 'active' || !carrier.password_hash || !(await bcrypt.compare(password, carrier.password_hash))) {
      return response.status(401).json({ message: 'حساب شرکت حمل‌ونقل فعال نیست یا اطلاعات ورود اشتباه است.' });
    }
    const membership = await ensurePlatformMembership(carrier, 'carrier');
    const tokens = await issueLoginTokens(carrier, 'company_y_owner', membership);
    await writeAudit({ actorId: carrier.id, eventType: 'CarrierLoggedIn', subjectType: 'carrier', subjectId: carrier.id, payload: { source: 'mobile-web', organizationId: membership.organizationId } });
    return response.json({ ...tokens, user: publicCarrier(carrier) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: 'ورود شرکت حمل‌ونقل انجام نشد؛ اتصال دیتابیس را بررسی کن.' });
  }
});

app.post('/api/auth/login-platform', authRateLimit, async (request, response) => {
  let input;
  try {
    input = validatePlatformLoginInput(request.body);
  } catch (error) {
    return response.status(Number(error.status || 400)).json({ code: error.code || 'AUTH-400', message: error.message });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT c.id AS credential_id, c.user_id, c.password_hash, c.failed_attempts, c.locked_until,
              u.tenant_id, u.external_type, u.external_id, u.display_name,
              m.id AS membership_id, m.organization_id, m.role, m.transaction_role,
              o.organization_type, o.display_name AS organization_display_name
         FROM platform_user_credentials c
         JOIN platform_users u ON u.id = c.user_id AND u.tenant_id = c.tenant_id
         JOIN organization_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
         JOIN platform_organizations o ON o.id = m.organization_id AND o.tenant_id = m.tenant_id
        WHERE c.login_identifier_normalized = ?
          AND c.tenant_id = ?
          AND c.status = 'active'
          AND u.status = 'active'
          AND m.status = 'active'
          AND o.status = 'active'
          AND (c.locked_until IS NULL OR c.locked_until <= NOW())
        ORDER BY m.id ASC
        LIMIT 50`,
      [input.identifier, PLATFORM_TENANT_ID]
    );
    const credential = rows[0];
    const passwordMatches = credential
      ? await bcrypt.compare(input.password, credential.password_hash)
      : await bcrypt.compare(input.password, platformLoginDummyHash);
    if (!credential || !passwordMatches) {
      if (credential) {
        await pool.execute(
          `UPDATE platform_user_credentials
              SET failed_attempts = LEAST(failed_attempts + 1, 5),
                  locked_until = CASE WHEN failed_attempts >= 4 THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE) ELSE locked_until END
            WHERE id = ? AND status = 'active'`,
          [credential.credential_id]
        );
      }
      return response.status(401).json({ code: 'AUTH-401', message: 'اطلاعات ورود معتبر نیست یا عضویت این پنل فعال نیست.' });
    }

    const selection = selectPlatformMembership(rows, input);
    if (selection.kind === 'not-found') {
      return response.status(401).json({ code: 'AUTH-401', message: 'اطلاعات ورود معتبر نیست یا عضویت این پنل فعال نیست.' });
    }
    if (selection.kind === 'ambiguous') {
      return response.status(409).json({
        code: 'AUTH-409',
        message: 'این حساب برای چند نقش این پنل فعال است؛ نقش ورود را انتخاب کنید.',
        roles: selection.roles
      });
    }

    const membershipRow = selection.membership;
    await pool.execute(
      `UPDATE platform_user_credentials
          SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW()
        WHERE id = ? AND status = 'active'`,
      [credential.credential_id]
    );
    const account = { id: membershipRow.user_id, tenant_id: membershipRow.tenant_id };
    const membership = {
      userId: membershipRow.user_id,
      membershipId: membershipRow.membership_id,
      organizationId: membershipRow.organization_id,
      externalType: membershipRow.external_type,
      externalId: membershipRow.external_id,
      role: membershipRow.role
    };
    const tokens = await issueLoginTokens(account, membershipRow.role, membership);
    await writeAudit({
      actorId: membershipRow.user_id,
      eventType: 'PlatformUserLoggedIn',
      subjectType: 'platform_user',
      subjectId: membershipRow.user_id,
      payload: { source: 'organization-login', panel: input.panel, organizationId: membershipRow.organization_id, role: membershipRow.role }
    });
    return response.json({ ...tokens, user: publicPlatformUser(membershipRow) });
  } catch (error) {
    console.error(error);
    return response.status(503).json({ code: 'AUTH-503', message: 'ورود سازمانی موقتاً در دسترس نیست؛ اتصال سرور را بررسی کنید.' });
  }
});

app.post('/api/auth/change-password', platformAuth({ roles: [ROLES.DRIVER, ROLES.COMPANY_Y_OWNER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  let key;
  try {
    key = resolveIdempotencyKey(request);
  } catch (error) {
    const status = Number(error.status || 400);
    const code = error.code || ERROR_CODES.IDEMPOTENCY_HEADER;
    return response.status(status).type('application/problem+json').json({
      type: `https://gomrok.org/problems/${code}`,
      title: code,
      status,
      detail: error.message || 'هدر جلوگیری از تکرار معتبر نیست.',
      code,
      correlationId: request.correlationId
    });
  }
  if (!key) return response.status(428).json({ code: 'AUTH-428', message: 'برای تغییر رمز عبور Idempotency-Key یا X-Idempotency-Key لازم است.' });
  const currentPassword = String(request.body?.currentPassword || '');
  const newPassword = String(request.body?.newPassword || '');
  if (newPassword.length < 12 || newPassword.length > 256) {
    return response.status(400).json({ code: 'AUTH-422', message: 'رمز عبور جدید باید بین ۱۲ تا ۲۵۶ نویسه باشد.' });
  }
  const accountType = request.actor.externalType === 'carrier' ? 'carrier' : request.actor.externalType === 'driver' ? 'driver' : null;
  const table = accountType === 'carrier' ? 'carriers' : accountType === 'driver' ? 'drivers' : null;
  if (!table || !request.actor.externalId) return response.status(403).json({ code: 'AUTH-403', message: 'حساب این نشست امکان تغییر رمز ندارد.' });
  try {
    const [rows] = await pool.execute(`SELECT id, password_hash FROM ${table} WHERE id = ? AND tenant_id = ? AND status = 'active' LIMIT 1`, [request.actor.externalId, request.actor.tenantId]);
    const account = rows[0];
    if (!account || !account.password_hash || !(await bcrypt.compare(currentPassword, account.password_hash))) {
      return response.status(401).json({ code: 'AUTH-401', message: 'رمز عبور فعلی معتبر نیست.' });
    }
    if (await bcrypt.compare(newPassword, account.password_hash)) return response.status(400).json({ code: 'AUTH-423', message: 'رمز عبور جدید باید با رمز قبلی متفاوت باشد.' });
    const nextPasswordHash = await bcrypt.hash(newPassword, 12);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [updated] = await connection.execute(
        `UPDATE ${table} SET password_hash = ? WHERE id = ? AND tenant_id = ? AND password_hash = ?`,
        [nextPasswordHash, account.id, request.actor.tenantId, account.password_hash]
      );
      if (Number(updated.affectedRows) !== 1) {
        const conflict = new Error('رمز عبور هم‌زمان تغییر کرده است؛ دوباره وارد شوید.');
        conflict.code = 'AUTH-409';
        conflict.status = 409;
        throw conflict;
      }
      await connection.execute(
        `UPDATE platform_refresh_tokens SET revoked_at = NOW() WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL`,
        [request.actor.tenantId, request.actor.userId]
      );
      if (OPERATING_CONTEXT_SESSIONS_ENABLED) {
        await connection.execute(
          `UPDATE platform_sessions SET status = 'revoked' WHERE tenant_id = ? AND user_id = ? AND status = 'active'`,
          [request.actor.tenantId, request.actor.userId]
        );
      }
      await writeAudit({
        actorId: request.actor.userId,
        eventType: 'PasswordChanged',
        subjectType: accountType,
        subjectId: account.id,
        payload: { source: 'platform-account-security' },
        executor: connection
      });
      await connection.commit();
    } catch (error) {
      try { await connection.rollback(); } catch (_rollbackError) { /* Preserve the original error. */ }
      throw error;
    } finally {
      connection.release();
    }
    return response.json({ message: 'رمز عبور تغییر کرد؛ برای دریافت نشست جدید دوباره وارد شوید.' });
  } catch (error) {
    if (error?.code === 'AUTH-409') {
      return response.status(409).json({ code: 'AUTH-409', message: error.message });
    }
    console.error(error);
    return response.status(503).json({ code: 'AUTH-503', message: 'تغییر رمز عبور موقتاً در دسترس نیست.' });
  }
});

app.use('/api/platform', platformRouter);
app.use('/api/platform/admin', adminRouter);

export { app };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, '127.0.0.1', () => {
    console.log(`Gomrok API: http://127.0.0.1:${port}`);
  });
}
