import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertInquiryValid,
  assertOfferSelectable,
  calculateCargo,
  driverProjection,
  normalizeInquiryPayload,
  publicationDecision,
  validateInquiry,
  validateOffer
} from '../src/domain/cargo-inquiry.js';

const base = {
  requester: { name: 'علی رضایی', mobile: '+989121234567' },
  contact: { channel: 'sms' },
  route: { scope: 'domestic' },
  stops: [
    { operation: 'pickup', country: 'ایران', city: 'تهران', district: 'شهرک صنعتی' },
    { operation: 'delivery', country: 'ایران', city: 'تبریز', district: 'مرکز شهر' }
  ],
  schedule: { readyStatus: 'ready', pickupFrom: '2035-02-01T08:00:00+03:30', quoteDeadline: '2035-02-01T07:00:00+03:30' },
  cargo: { title: 'قطعات صنعتی', category: 'industrial', description: 'قطعات بسته‌بندی‌شده', specialFlags: [] },
  vehicle: { preferenceMode: 'known', class: 'truck', body: 'covered', count: 1 },
  consent: { shareWithDrivers: true }
};

test('cargo calculation multiplies per-unit weight once', () => {
  const normalized = normalizeInquiryPayload({ ...base, handlingUnits: [{ quantity: 3, grossWeight: 400, weightUnit: 'kg', weightBasis: 'per_unit' }] });
  assert.equal(calculateCargo(normalized).totalGrossWeightKg, 1200);
});

test('explicit total weight is not multiplied by handling-unit quantity', () => {
  const normalized = normalizeInquiryPayload({ ...base, cargo: { ...base.cargo, totalGrossWeight: 1200, weightUnit: 'kg' }, handlingUnits: [{ quantity: 3, grossWeight: 1200, weightUnit: 'kg', weightBasis: 'total_row' }] });
  assert.equal(calculateCargo(normalized).totalGrossWeightKg, 1200);
});

test('dimensions produce a labelled volume estimate', () => {
  const normalized = normalizeInquiryPayload({ ...base, handlingUnits: [{ quantity: 2, length: 1.5, width: 1.2, height: 1.5, dimensionUnit: 'm' }] });
  assert.ok(Math.abs(calculateCargo(normalized).totalVolumeM3 - 5.4) < 1e-9);
});

test('temperature range accepts negative Celsius and rejects an outside setpoint', () => {
  const reeferVehicle = { ...base.vehicle, body: 'reefer' };
  const valid = validateInquiry({ ...base, vehicle: reeferVehicle, cargo: { ...base.cargo, specialFlags: ['temperature_controlled'], temperature: { minC: -18, maxC: -2, setpointC: -10 } }, handlingUnits: [{ quantity: 1, grossWeight: 400, weightUnit: 'kg' }] }, { mode: 'automatic', strict: true });
  assert.equal(valid.ready, true);
  const invalid = validateInquiry({ ...base, vehicle: reeferVehicle, cargo: { ...base.cargo, specialFlags: ['temperature_controlled'], temperature: { minC: -18, maxC: -2, setpointC: 1 } }, handlingUnits: [{ quantity: 1, grossWeight: 400, weightUnit: 'kg' }] }, { mode: 'automatic', strict: true });
  assert.ok(invalid.errors.some((error) => error.code === 'SETPOINT_OUTSIDE_RANGE'));
});

test('v2 structured form keeps special requirements and normalizes temperature fallback', () => {
  const normalized = normalizeInquiryPayload({
    ...base,
    formVersion: 'v2',
    cargo: {
      ...base.cargo,
      cargoType: 'food',
      descriptionPublic: 'محموله عمومی',
      descriptionPrivate: 'جزئیات خصوصی برای بررسی پشتیبانی',
      specialFlags: ['temperature_controlled'],
      temperature: { minC: -20, maxC: -5, setpointC: -12 }
    },
    handlingUnits: [{ quantity: 2, grossWeight: 250, weightUnit: 'kg', weightBasis: 'per_unit' }]
  });
  assert.equal(normalized.formVersion, 'v2');
  assert.equal(normalized.cargo.specialRequirements.temperature_controlled.minC, -20);
  assert.equal(normalized.cargo.descriptionPublic, 'محموله عمومی');
  assert.equal(calculateCargo(normalized).totalGrossWeightKg, 500);
});

test('dangerous goods do not enter ordinary automatic publication', () => {
  const review = validateInquiry({ ...base, cargo: { ...base.cargo, specialFlags: ['dangerous'], specialRequirements: { hazardous: { materialName: 'حلال صنعتی', unNumber: 'UN1993', hazardClass: '3', amount: 100 } } }, handlingUnits: [{ quantity: 1, grossWeight: 400, weightUnit: 'kg' }] }, { mode: 'automatic', strict: true });
  assert.equal(review.requiresSpecialist, true);
  assert.equal(publicationDecision(review).state, 'PENDING_SPECIALIST');
});

test('driver projection excludes exact address, contact and value data', () => {
  const projection = driverProjection({ public_id: 'i-1', version_no: 1, payload_json: JSON.stringify({ ...base, value: { amount: 999999, budgetAmount: 1 }, stops: [{ ...base.stops[0], address: 'نشانی خصوصی' }, base.stops[1]] }) });
  assert.equal(projection.route.origin.city, 'تهران');
  assert.equal(projection.route.origin.address, undefined);
  assert.equal(projection.cargo.description, undefined);
  assert.equal(projection.priceContext, undefined);
});

test('complex route is held for review rather than silently published', () => {
  const review = validateInquiry({ ...base, route: { scope: 'domestic', extraStops: [{ operation: 'pickup', country: 'ایران', city: 'قم' }] }, handlingUnits: [{ quantity: 1, grossWeight: 400, weightUnit: 'kg' }] }, { mode: 'automatic', strict: true });
  assert.equal(review.complex, true);
  assert.equal(publicationDecision(review).state, 'PENDING_REVIEW');
});

test('expired or stale-version offers cannot be selected', () => {
  assert.throws(() => assertOfferSelectable({
    inquiry: { id: 3, state: 'OFFERS_RECEIVED' },
    offer: { inquiry_id: 3, version_no: 1, state: 'ACTIVE', valid_until: '2020-01-01T00:00:00Z' },
    versionNo: 1
  }), (error) => error.code === 'OFFER-409');
  assert.throws(() => assertOfferSelectable({
    inquiry: { id: 3, state: 'OFFERS_RECEIVED' },
    offer: { inquiry_id: 3, version_no: 1, state: 'ACTIVE', valid_until: '2035-01-01T00:00:00Z' },
    versionNo: 2
  }), (error) => error.code === 'OFFER-409');
});

test('offer validation uses integer minor units and explicit service scope', () => {
  const offer = validateOffer({
    amountMinor: 1250000,
    currency: 'IRR',
    validUntil: '2035-02-02T08:00:00+03:30',
    components: { linehaul: 1000000, loading: 250000 },
    includedServices: ['بارگیری'],
    excludedServices: ['بیمه مستقل']
  });
  assert.equal(offer.amountMinor, 1250000);
  assert.equal(offer.currency, 'IRR');
  assert.deepEqual(offer.components, { linehaul: 1000000, loading: 250000 });
  assert.deepEqual(offer.includedServices, ['بارگیری']);
  assert.deepEqual(offer.excludedServices, ['بیمه مستقل']);
});

test('automatic review rejects missing consent and missing positive weight', () => {
  assert.throws(() => assertInquiryValid({ ...base, consent: { shareWithDrivers: false } }, { mode: 'automatic' }), (error) => error.code === 'CARGO-422' && error.details.errors.some((item) => item.code === 'DRIVER_SHARING_CONSENT_REQUIRED') && error.details.errors.some((item) => item.code === 'WEIGHT_REQUIRED'));
});
