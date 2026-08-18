import { randomBytes } from 'node:crypto';
import 'dotenv/config';

const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
const configuredJwtSecret = String(process.env.JWT_SECRET || '');
const configuredStepUpSecret = String(process.env.STEP_UP_SECRET || '');
const configuredAdminPassword = process.env.ADMIN_PASSWORD ? String(process.env.ADMIN_PASSWORD) : '';

if (configuredJwtSecret && configuredJwtSecret.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters.');
}

if (nodeEnv === 'production' && configuredJwtSecret.length < 32) {
  throw new Error('JWT_SECRET is required in production and must contain at least 32 characters.');
}

if (configuredStepUpSecret && configuredStepUpSecret.length < 32) {
  throw new Error('STEP_UP_SECRET must contain at least 32 characters.');
}

if (nodeEnv === 'production' && configuredStepUpSecret.length < 32) {
  throw new Error('STEP_UP_SECRET is required in production and must contain at least 32 characters.');
}

if (nodeEnv === 'production' && (!configuredAdminPassword || configuredAdminPassword.length < 16)) {
  throw new Error('ADMIN_PASSWORD is required in production and must contain at least 16 characters.');
}

export const JWT_SECRET = configuredJwtSecret || randomBytes(48).toString('base64url');
export const STEP_UP_SECRET = configuredStepUpSecret || randomBytes(48).toString('base64url');
export const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
export const ADMIN_PASSWORD = configuredAdminPassword || null;
export const IS_PRODUCTION = nodeEnv === 'production';
