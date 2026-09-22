import { DomainError } from './workflow.js';

const SPECIAL_FLAGS = new Set([
  'fragile',
  'shock_sensitive',
  'temperature_controlled',
  'perishable',
  'pharmaceutical',
  'valuable',
  'dangerous',
  'hazardous',
  'chemical',
  'oversized',
  'liquid',
  'live_animal',
  'confidential',
  'moisture_sensitive',
  'light_sensitive',
  'fixed_orientation',
  'live_biological',
  'urgent',
  'other',
  'unknown',
  'none'
]);

const DANGEROUS_FLAGS = new Set(['dangerous', 'hazardous', 'chemical']);
const SPECIALIST_FLAGS = new Set(['dangerous', 'hazardous', 'chemical', 'live_biological', 'live_animal', 'oversized', 'pharmaceutical', 'liquid', 'unknown']);
const COUNTRY_DEFAULT = 'ایران';
const PHONE_PATTERN = /(?:\+?98|0)9\d{9}/;
const CURRENCY_CODES = new Set(['IRR', 'IRT', 'EUR', 'USD', 'AED', 'TRY', 'CNY']);
const DEFAULT_RULES = Object.freeze({
  policyVersion: 'cargo-inquiry-policy-v2',
  highValueThresholdMinor: 50_000_000_000,
  maxAutoDistanceKm: 2500,
  maxBroadcastDrivers: 100,
  offerValidityHours: 24
});

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function finite(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value) {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function integer(value) {
  const parsed = finite(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeFlag(value) {
  const flag = text(value, 40).toLowerCase();
  const aliases = {
    temperature: 'temperature_controlled',
    reefer: 'temperature_controlled',
    perishable_goods: 'perishable',
    high_value: 'valuable',
    highvalue: 'valuable',
    hazardous_material: 'hazardous',
    chemical: 'chemical',
    live: 'live_animal',
    confidential_goods: 'confidential',
    not_sure: 'unknown'
  };
  return aliases[flag] || flag;
}

function normalizeUnit(value, fallback) {
  const unit = text(value, 16).toLowerCase();
  return unit || fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function list(value, maxItems = 40, maxItemLength = 80) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => text(item, maxItemLength)).filter(Boolean);
}

function normalizeServices(input = {}) {
  const services = input.services || {};
  const location = (value = {}) => ({
    dockAvailable: bool(value.dockAvailable ?? value.dock_available),
    forkliftAvailable: bool(value.forkliftAvailable ?? value.forklift_available),
    craneAvailable: bool(value.craneAvailable ?? value.crane_available),
    largeVehicleAccess: bool(value.largeVehicleAccess ?? value.large_vehicle_access),
    residential: bool(value.residential),
    industrial: bool(value.industrial),
    restrictedAccess: bool(value.restrictedAccess ?? value.restricted_access),
    narrowRoad: bool(value.narrowRoad ?? value.narrow_road),
    heightWeightLimit: text(value.heightWeightLimit ?? value.height_weight_limit, 120),
    buildingEntry: bool(value.buildingEntry ?? value.building_entry),
    floors: integer(value.floors),
    parkingDifficulty: bool(value.parkingDifficulty ?? value.parking_difficulty),
    securityCoordination: bool(value.securityCoordination ?? value.security_coordination),
    appointmentRequired: bool(value.appointmentRequired ?? value.appointment_required)
  });
  return {
    origin: location(services.origin || services.pickup),
    destination: location(services.destination || services.delivery),
    responsibilities: {
      origin: text(services.responsibilities?.origin || services.originResponsibility || services.origin_responsibility, 48) || 'unknown',
      destination: text(services.responsibilities?.destination || services.destinationResponsibility || services.destination_responsibility, 48) || 'unknown'
    },
    helpers: {
      originCount: integer(services.helpers?.originCount ?? services.originHelperCount) ?? 0,
      destinationCount: integer(services.helpers?.destinationCount ?? services.destinationHelperCount) ?? 0,
      originMinutes: integer(services.helpers?.originMinutes ?? services.originOperationMinutes),
      destinationMinutes: integer(services.helpers?.destinationMinutes ?? services.destinationOperationMinutes)
    },
    requested: list(services.requested || services.additionalServices, 50, 60),
    pricing: input.servicePricing || services.pricing || {}
  };
}

function normalizeSpecialRequirements(input = {}, cargo = {}) {
  const source = input.specialRequirements || input.special_requirements || cargo.specialRequirements || cargo.special_requirements || {};
  const read = (key, aliases = []) => source[key] || aliases.map((alias) => source[alias]).find(Boolean) || {};
  const highValue = read('high_value', ['highValue', 'valuable']);
  const fragile = read('fragile');
  const hazardous = read('hazardous', ['dangerous', 'chemical']);
  const temperatureSource = read('temperature_controlled', ['temperatureControlled', 'cold_chain']);
  const temperature = Object.keys(temperatureSource).length ? temperatureSource : (cargo.temperature || {});
  const oversized = read('oversized');
  const liquid = read('liquid');
  const liveAnimal = read('live_animal', ['liveAnimal']);
  return {
    high_value: {
      declaredValue: finite(highValue.declaredValue ?? highValue.declared_value ?? input.value?.amount),
      currency: text(highValue.currency || input.value?.currency, 3).toUpperCase(),
      basis: text(highValue.basis, 40),
      insuranceRequired: bool(highValue.insuranceRequired ?? highValue.insurance_required),
      trackingRequired: bool(highValue.trackingRequired ?? highValue.tracking_required),
      directTransport: bool(highValue.directTransport ?? highValue.direct_transport),
      contactAllowed: bool(highValue.contactAllowed ?? highValue.contact_allowed, true),
      sealAuthority: text(highValue.sealAuthority ?? highValue.seal_authority, 120),
      identityCheck: bool(highValue.identityCheck ?? highValue.identity_check),
      photoRequired: bool(highValue.photoRequired ?? highValue.photo_required)
    },
    fragile: {
      itemType: text(fragile.itemType ?? fragile.item_type, 120),
      sensitivity: text(fragile.sensitivity, 24),
      packaged: bool(fragile.packaged),
      stackable: bool(fragile.stackable),
      rotatable: bool(fragile.rotatable),
      shockProhibited: bool(fragile.shockProhibited ?? fragile.shock_prohibited),
      coverRequired: bool(fragile.coverRequired ?? fragile.cover_required),
      impactSensorRequired: bool(fragile.impactSensorRequired ?? fragile.impact_sensor_required),
      deliveryAcceptance: text(fragile.deliveryAcceptance ?? fragile.delivery_acceptance, 180)
    },
    hazardous: {
      materialName: text(hazardous.materialName ?? hazardous.material_name, 180),
      technicalName: text(hazardous.technicalName ?? hazardous.technical_name, 180),
      unNumber: text(hazardous.unNumber ?? hazardous.un_number, 32),
      hazardClass: text(hazardous.hazardClass ?? hazardous.hazard_class, 40),
      subsidiaryRisk: text(hazardous.subsidiaryRisk ?? hazardous.subsidiary_risk, 80),
      packingGroup: text(hazardous.packingGroup ?? hazardous.packing_group, 40),
      physicalState: text(hazardous.physicalState ?? hazardous.physical_state, 24),
      amount: finite(hazardous.amount),
      amountUnit: normalizeUnit(hazardous.amountUnit ?? hazardous.amount_unit, ''),
      packagingType: text(hazardous.packagingType ?? hazardous.packaging_type, 60),
      packagingSafe: bool(hazardous.packagingSafe ?? hazardous.packaging_safe),
      labelsPresent: bool(hazardous.labelsPresent ?? hazardous.labels_present),
      emergencyPhone: text(hazardous.emergencyPhone ?? hazardous.emergency_phone, 32),
      routeRestrictions: text(hazardous.routeRestrictions ?? hazardous.route_restrictions, 300),
      specializedVehicle: bool(hazardous.specializedVehicle ?? hazardous.specialized_vehicle),
      qualifiedDriver: bool(hazardous.qualifiedDriver ?? hazardous.qualified_driver),
      noMixing: bool(hazardous.noMixing ?? hazardous.no_mixing),
      incidentInstruction: text(hazardous.incidentInstruction ?? hazardous.incident_instruction, 500)
    },
    temperature_controlled: {
      minC: finite(temperature.minC ?? temperature.min_c),
      maxC: finite(temperature.maxC ?? temperature.max_c),
      setpointC: finite(temperature.setpointC ?? temperature.setpoint_c),
      productType: text(temperature.productType ?? temperature.product_type, 120),
      controlType: text(temperature.controlType ?? temperature.control_type, 40),
      operationMode: text(temperature.operationMode ?? temperature.operation_mode, 24),
      productTempC: finite(temperature.productTempC ?? temperature.product_temp_c),
      preCoolingRequired: bool(temperature.preCoolingRequired ?? temperature.pre_cooling_required),
      loggingRequired: bool(temperature.loggingRequired ?? temperature.logging_required),
      reportRequired: bool(temperature.reportRequired ?? temperature.report_required),
      maxOutOfRangeMinutes: integer(temperature.maxOutOfRangeMinutes ?? temperature.max_out_of_range_minutes),
      expiry: text(temperature.expiry, 40),
      packagingAirflow: text(temperature.packagingAirflow ?? temperature.packaging_airflow, 120),
      multiZone: bool(temperature.multiZone ?? temperature.multi_zone)
    },
    oversized: {
      pieceWeight: finite(oversized.pieceWeight ?? oversized.piece_weight),
      finalHeightCm: finite(oversized.finalHeightCm ?? oversized.final_height_cm),
      centerOfGravity: text(oversized.centerOfGravity ?? oversized.center_of_gravity, 120),
      loadingMethod: text(oversized.loadingMethod ?? oversized.loading_method, 120),
      unloadingMethod: text(oversized.unloadingMethod ?? oversized.unloading_method, 120),
      originCrane: bool(oversized.originCrane ?? oversized.origin_crane),
      destinationCrane: bool(oversized.destinationCrane ?? oversized.destination_crane),
      permitRequired: bool(oversized.permitRequired ?? oversized.permit_required),
      escortRequired: bool(oversized.escortRequired ?? oversized.escort_required),
      routeSurveyRequired: bool(oversized.routeSurveyRequired ?? oversized.route_survey_required),
      splitLoads: bool(oversized.splitLoads ?? oversized.split_loads)
    },
    liquid: {
      liquidType: text(liquid.liquidType ?? liquid.liquid_type, 120),
      flammable: bool(liquid.flammable),
      corrosive: bool(liquid.corrosive),
      volume: finite(liquid.volume),
      weight: finite(liquid.weight),
      containerType: text(liquid.containerType ?? liquid.container_type, 80),
      containerCount: integer(liquid.containerCount ?? liquid.container_count),
      sealing: text(liquid.sealing, 80),
      leakageRisk: text(liquid.leakageRisk ?? liquid.leakage_risk, 24),
      dedicatedTank: bool(liquid.dedicatedTank ?? liquid.dedicated_tank),
      compatibleContainer: bool(liquid.compatibleContainer ?? liquid.compatible_container)
    },
    live_animal: {
      animalType: text(liveAnimal.animalType ?? liveAnimal.animal_type, 100),
      count: integer(liveAnimal.count),
      weight: finite(liveAnimal.weight),
      enclosure: text(liveAnimal.enclosure, 100),
      ventilation: bool(liveAnimal.ventilation),
      foodWater: bool(liveAnimal.foodWater ?? liveAnimal.food_water),
      healthDocuments: bool(liveAnimal.healthDocuments ?? liveAnimal.health_documents),
      temperature: text(liveAnimal.temperature, 120),
      handover: text(liveAnimal.handover, 180)
    }
  };
}

export function normalizeInquiryPayload(input = {}) {
  const formVersion = text(input.formVersion || input.form_version, 16) || 'v1';
  const requester = input.requester || {};
  const contact = input.contact || {};
  const route = input.route || {};
  const stops = Array.isArray(input.stops) && input.stops.length ? input.stops : [
    { operation: 'pickup', ...(input.origin || {}) },
    { operation: 'delivery', ...(input.destination || {}) }
  ];
  const normalizedStops = stops.slice(0, 20).map((stop, index) => ({
    operation: text(stop.operation, 24) || (index === 0 ? 'pickup' : 'delivery'),
    sequence: index + 1,
    country: text(stop.country, 80) || (index === 0 ? COUNTRY_DEFAULT : ''),
    province: text(stop.province, 80),
    city: text(stop.city, 100),
    district: text(stop.district, 120),
    placeType: text(stop.placeType || stop.place_type, 40),
    locationType: text(stop.locationType || stop.location_type || stop.placeType, 40),
    address: text(stop.address, 500),
    postalCode: text(stop.postalCode || stop.postal_code, 24),
    latitude: finite(stop.latitude),
    longitude: finite(stop.longitude),
    appointment: text(stop.appointment, 24) || 'unknown',
    receivingHours: text(stop.receivingHours || stop.receiving_hours, 120),
    operationMinutes: integer(stop.operationMinutes || stop.operation_minutes),
    accessRestrictions: text(stop.accessRestrictions || stop.access_restrictions, 300),
    loadingMethod: text(stop.loadingMethod || stop.loading_method, 40) || 'unknown',
    availableEquipment: list(stop.availableEquipment || stop.available_equipment, 20, 40),
    labor: text(stop.labor, 40) || 'unknown',
    contactName: text(stop.contactName || stop.contact_name, 180),
    contactPhone: text(stop.contactPhone || stop.contact_phone, 32),
    coordinationNote: text(stop.coordinationNote || stop.coordination_note, 300)
  }));
  const cargo = input.cargo || {};
  const schedule = input.schedule || {};
  const vehicle = input.vehicle || {};
  const services = input.services || {};
  const value = input.value || {};
  const flags = [...new Set((Array.isArray(cargo.specialFlags) ? cargo.specialFlags : []).map(normalizeFlag).filter(Boolean))];
  const rawExtraStops = route.extraStops || route.extra_stops;
  const extraStops = Array.isArray(rawExtraStops)
    ? rawExtraStops.slice(0, 18).map((stop, index) => ({ ...normalizeInquiryPayload({ stops: [stop] }).stops[0], sequence: index + 2 }))
    : [];
  const units = (Array.isArray(input.handlingUnits) ? input.handlingUnits : []).slice(0, 100).map((unit) => ({
    description: text(unit.description, 180),
    packagingType: text(unit.packagingType || unit.packaging_type, 40),
    quantity: integer(unit.quantity) ?? 1,
    weightBasis: text(unit.weightBasis || unit.weight_basis, 24) || 'per_unit',
    grossWeight: finite(unit.grossWeight ?? unit.gross_weight),
    netWeight: finite(unit.netWeight ?? unit.net_weight),
    weightUnit: normalizeUnit(unit.weightUnit || unit.weight_unit, 'kg'),
    volume: finite(unit.volume),
    volumeUnit: normalizeUnit(unit.volumeUnit || unit.volume_unit, 'm3'),
    length: positive(unit.length),
    width: positive(unit.width),
    height: positive(unit.height),
    dimensionUnit: normalizeUnit(unit.dimensionUnit || unit.dimension_unit, 'm'),
    stackability: text(unit.stackability, 24) || 'unknown',
    maxStackLayers: integer(unit.maxStackLayers || unit.max_stack_layers),
    orientation: text(unit.orientation, 32) || 'free',
    rotatable: bool(unit.rotatable),
    nonStandardShape: bool(unit.nonStandardShape ?? unit.non_standard_shape),
    overhangAllowed: bool(unit.overhangAllowed ?? unit.overhang_allowed)
  }));
  return {
    formVersion,
    requester: {
      kind: text(requester.kind, 24) || 'person',
      name: text(requester.name, 180),
      mobile: text(requester.mobile, 32),
      companyName: text(requester.companyName || requester.company_name, 180),
      capacity: text(requester.capacity, 40),
      email: text(requester.email, 180),
      alternatePhone: text(requester.alternatePhone || requester.alternate_phone, 32),
      nationalIdentifier: text(requester.nationalIdentifier || requester.national_identifier, 32),
      preferredNotification: text(requester.preferredNotification || requester.preferred_notification, 24) || 'sms',
      allowPhone: bool(requester.allowPhone ?? requester.allow_phone, true),
      allowSms: bool(requester.allowSms ?? requester.allow_sms, true)
    },
    contact: {
      channel: text(contact.channel, 16) || 'phone',
      timeWindow: text(contact.timeWindow || contact.time_window, 80),
      mobileVerified: bool(contact.mobileVerified ?? contact.mobile_verified),
      otpChallengeId: text(contact.otpChallengeId || contact.otp_challenge_id, 80)
    },
    route: {
      scope: text(route.scope, 24) || 'domestic',
      routeType: text(route.routeType || route.route_type, 24) || (extraStops.length ? 'multi_stop' : 'intercity'),
      sameLocationMode: text(route.sameLocationMode || route.same_location_mode, 24),
      estimatedDistanceKm: finite(route.estimatedDistanceKm ?? route.estimated_distance_km),
      extraStops
    },
    stops: normalizedStops,
    schedule: {
      readyStatus: text(schedule.readyStatus || schedule.ready_status, 24) || 'ready',
      pickupFrom: text(schedule.pickupFrom || schedule.pickup_from || schedule.pickupReadyAt || schedule.pickup_ready_at, 40),
      pickupTo: text(schedule.pickupTo || schedule.pickup_to, 40),
      deliveryFrom: text(schedule.deliveryFrom || schedule.delivery_from, 40),
      deliveryTo: text(schedule.deliveryTo || schedule.delivery_to, 40),
      deliveryDeadline: text(schedule.deliveryDeadline || schedule.delivery_deadline, 40),
      scheduleType: text(schedule.scheduleType || schedule.schedule_type, 24) || 'one_time',
      futureDateAllowed: bool(schedule.futureDateAllowed ?? schedule.future_date_allowed),
      deliveryAppointment: bool(schedule.deliveryAppointment ?? schedule.delivery_appointment),
      loadingMinutes: integer(schedule.loadingMinutes ?? schedule.loading_minutes),
      unloadingMinutes: integer(schedule.unloadingMinutes ?? schedule.unloading_minutes),
      expirySensitive: bool(schedule.expirySensitive ?? schedule.expiry_sensitive),
      urgency: text(schedule.urgency, 24) || 'normal',
      flexibility: text(schedule.flexibility, 24) || 'unknown',
      quoteDeadline: text(schedule.quoteDeadline || schedule.quote_deadline, 40),
      timezone: text(schedule.timezone, 64) || 'Asia/Tehran'
    },
    cargo: {
      title: text(cargo.title, 180),
      category: text(cargo.category, 50),
      cargoType: text(cargo.cargoType || cargo.cargo_type || cargo.category, 80),
      brandModel: text(cargo.brandModel || cargo.brand_model, 180),
      description: text(cargo.description, 1000),
      descriptionPublic: text(cargo.descriptionPublic || cargo.description_public, 600),
      descriptionPrivate: text(cargo.descriptionPrivate || cargo.description_private, 1600),
      condition: text(cargo.condition, 40),
      readyForLoading: bool(cargo.readyForLoading ?? cargo.ready_for_loading),
      assemblyRequired: bool(cargo.assemblyRequired ?? cargo.assembly_required),
      count: integer(cargo.count),
      unitType: text(cargo.unitType || cargo.unit_type, 40),
      loadMode: text(cargo.loadMode || cargo.load_mode, 24) || 'full_truck',
      measurementStatus: text(cargo.measurementStatus || cargo.measurement_status, 24) || 'unknown',
      packagingStatus: text(cargo.packagingStatus || cargo.packaging_status, 24) || 'unknown',
      totalGrossWeight: finite(cargo.totalGrossWeight ?? cargo.total_gross_weight),
      weightUnit: normalizeUnit(cargo.weightUnit || cargo.weight_unit, 'kg'),
      netWeight: finite(cargo.netWeight ?? cargo.net_weight),
      packagingWeight: finite(cargo.packagingWeight ?? cargo.packaging_weight),
      isWeightEstimated: bool(cargo.isWeightEstimated ?? cargo.is_weight_estimated ?? cargo.measurementStatus === 'estimated'),
      officialWeighing: bool(cargo.officialWeighing ?? cargo.official_weighing),
      concentrated: bool(cargo.concentrated),
      unbalanced: bool(cargo.unbalanced),
      totalVolume: finite(cargo.totalVolume ?? cargo.total_volume),
      volumeUnit: normalizeUnit(cargo.volumeUnit || cargo.volume_unit, 'm3'),
      largestUnitWeight: finite(cargo.largestUnitWeight ?? cargo.largest_unit_weight),
      divisibility: text(cargo.divisibility, 24) || 'unknown',
      mixAllowed: text(cargo.mixAllowed || cargo.mix_allowed, 24) || 'unknown',
      packaging: {
        type: text(cargo.packaging?.type || cargo.packagingType || cargo.packaging_type, 40),
        stackable: bool(cargo.packaging?.stackable ?? cargo.packagingStackable),
        waterproof: bool(cargo.packaging?.waterproof ?? cargo.packagingWaterproof),
        sealed: bool(cargo.packaging?.sealed ?? cargo.packagingSealed),
        packedBy: text(cargo.packaging?.packedBy || cargo.packagingPackedBy, 24),
        inspectionRequired: bool(cargo.packaging?.inspectionRequired ?? cargo.packagingInspectionRequired)
      },
      specialFlags: flags,
      notesForDriver: text(cargo.notesForDriver || cargo.notes_for_driver, 500),
      temperature: cargo.temperature ? {
        minC: finite(cargo.temperature.minC ?? cargo.temperature.min_c),
        maxC: finite(cargo.temperature.maxC ?? cargo.temperature.max_c),
        setpointC: finite(cargo.temperature.setpointC ?? cargo.temperature.setpoint_c),
        rangeSource: text(cargo.temperature.rangeSource || cargo.temperature.range_source, 80),
        pickupCondition: text(cargo.temperature.pickupCondition || cargo.temperature.pickup_condition, 80),
        preconditionRequired: text(cargo.temperature.preconditionRequired || cargo.temperature.precondition_required, 24)
      } : null,
      specialRequirements: normalizeSpecialRequirements(input, cargo)
    },
    handlingUnits: units,
    vehicle: {
      preferenceMode: text(vehicle.preferenceMode || vehicle.preference_mode, 24) || 'guidance',
      class: text(vehicle.class, 32),
      body: text(vehicle.body, 40),
      types: list(vehicle.types || vehicle.allowedTypes || vehicle.allowed_types, 20, 80),
      vehicleId: integer(vehicle.vehicleId || vehicle.vehicle_id),
      count: integer(vehicle.count) ?? 1,
      requiredPayload: finite(vehicle.requiredPayload ?? vehicle.required_payload),
      requiredEquipment: list(vehicle.requiredEquipment || vehicle.required_equipment, 40, 40),
      services: {
        packaging: text(services.packaging, 100),
        loadingUnloading: text(services.loadingUnloading || services.loading_unloading, 100),
        waybillRequested: bool(services.waybillRequested ?? services.waybill_requested),
        insuranceRequested: text(services.insuranceRequested || services.insurance_requested, 40),
        additional: text(services.additional, 200)
      }
    },
    services: normalizeServices(input),
    documents: Array.isArray(input.documents || input.files)
      ? (input.documents || input.files).slice(0, 30).map((document) => ({
        documentType: text(document.documentType || document.document_type, 60),
        originalName: text(document.originalName || document.original_name || document.name, 180),
        mimeType: text(document.mimeType || document.mime_type || document.type, 120),
        sizeBytes: integer(document.sizeBytes || document.size),
        visibility: text(document.visibility || document.visibilityScope || document.visibility_scope, 24) || 'PRIVATE',
        status: text(document.status || document.scanStatus || document.scan_status, 24) || 'PENDING'
      }))
      : [],
    payer: {
      type: text(input.payer?.type || input.payerType || input.payer_type, 32) || 'requester',
      name: text(input.payer?.name, 180),
      mobile: text(input.payer?.mobile, 32),
      organizationId: text(input.payer?.organizationId || input.payer?.organization_id, 128)
    },
    value: {
      amount: finite(value.amount),
      amountMinor: integer(value.amountMinor ?? value.amount_minor),
      currency: text(value.currency, 3).toUpperCase(),
      budgetAmount: finite(value.budgetAmount ?? value.budget_amount),
      budgetCurrency: text(value.budgetCurrency || value.budget_currency, 3).toUpperCase(),
      insuranceRequested: bool(value.insuranceRequested ?? value.insurance_requested)
    },
    consent: {
      shareWithDrivers: bool(input.consent?.shareWithDrivers ?? input.consent?.share_with_drivers),
      dataAccuracy: bool(input.consent?.dataAccuracy ?? input.consent?.data_accuracy),
      prohibitedGoods: bool(input.consent?.prohibitedGoods ?? input.consent?.prohibited_goods),
      contractNotFinal: bool(input.consent?.contractNotFinal ?? input.consent?.contract_not_final),
      priceMayChange: bool(input.consent?.priceMayChange ?? input.consent?.price_may_change),
      contactPermission: bool(input.consent?.contactPermission ?? input.consent?.contact_permission, true),
      acceptedAt: text(input.consent?.acceptedAt || input.consent?.accepted_at, 40)
    },
    notes: text(input.notes, 1000)
  };
}

function weightToKg(value, unit) {
  if (value === null) return null;
  if (unit === 'ton' || unit === 't' || unit === 'mt') return value * 1000;
  return value;
}

function volumeToM3(value, unit) {
  if (value === null) return null;
  if (unit === 'l' || unit === 'liter' || unit === 'litre') return value / 1000;
  return value;
}

export function calculateCargo(payload) {
  const cargo = payload?.cargo || {};
  const units = Array.isArray(payload?.handlingUnits) ? payload.handlingUnits : [];
  let itemWeight = 0;
  let hasWeight = false;
  let itemVolume = 0;
  let hasVolume = false;
  let dimensionRows = 0;
  for (const unit of units) {
    if (unit.grossWeight !== null && unit.grossWeight !== undefined) {
      const quantity = unit.weightBasis === 'total_row' ? 1 : unit.quantity;
      itemWeight += weightToKg(unit.grossWeight * quantity, unit.weightUnit);
      hasWeight = true;
    }
    if (unit.volume !== null && unit.volume !== undefined) {
      const quantity = unit.weightBasis === 'total_row' ? 1 : unit.quantity;
      itemVolume += volumeToM3(unit.volume * quantity, unit.volumeUnit);
      hasVolume = true;
    } else if (unit.length && unit.width && unit.height) {
      const dimensionFactor = unit.dimensionUnit === 'cm' ? 0.000001 : 1;
      itemVolume += unit.length * unit.width * unit.height * dimensionFactor * unit.quantity;
      hasVolume = true;
      dimensionRows += 1;
    }
  }
  const explicitWeight = weightToKg(cargo.totalGrossWeight, cargo.weightUnit);
  const explicitVolume = volumeToM3(cargo.totalVolume, cargo.volumeUnit);
  const calculatedWeight = hasWeight ? itemWeight : null;
  const weightVariancePct = explicitWeight !== null && calculatedWeight !== null && explicitWeight > 0
    ? Math.abs(explicitWeight - calculatedWeight) / explicitWeight * 100
    : null;
  return {
    totalGrossWeightKg: explicitWeight ?? calculatedWeight,
    totalVolumeM3: explicitVolume ?? (hasVolume ? itemVolume : null),
    calculatedFromUnits: explicitWeight === null && hasWeight,
    calculatedVolumeFromUnits: explicitVolume === null && hasVolume,
    unitCount: units.reduce((sum, unit) => sum + (unit.quantity > 0 ? unit.quantity : 0), 0),
    itemWeightKg: calculatedWeight,
    itemVolumeM3: hasVolume ? itemVolume : null,
    weightVariancePct,
    hasDimensions: dimensionRows > 0,
    dimensionRows
  };
}

function pushMissing(missing, key, value) {
  if (!value) missing.push(key);
}

export function validateInquiry(payload, { mode = 'support', strict = true, now = new Date(), rules: configuredRules = {} } = {}) {
  const normalized = normalizeInquiryPayload(payload);
  const missing = [];
  const errors = [];
  const warnings = [];
  const rules = { ...DEFAULT_RULES, ...configuredRules };
  const structured = normalized.formVersion === 'v2';
  const stops = normalized.stops;
  const pickup = stops.find((stop) => stop.operation === 'pickup') || stops[0];
  const delivery = stops.find((stop) => stop.operation === 'delivery') || stops[1];
  const calculation = calculateCargo(normalized);
  const flags = new Set(normalized.cargo.specialFlags);
  const dangerous = [...flags].some((flag) => DANGEROUS_FLAGS.has(flag));
  const specialRequirements = normalized.cargo.specialRequirements;
  const highValue = specialRequirements.high_value;
  const declaredValue = normalized.value.amountMinor ?? highValue.declaredValue;
  const highValueOverThreshold = declaredValue !== null && declaredValue >= rules.highValueThresholdMinor;
  const specialistRequired = [...flags].some((flag) => SPECIALIST_FLAGS.has(flag)) || highValueOverThreshold;
  const manualOnly = normalized.schedule.scheduleType === 'recurring' || normalized.route.scope !== 'domestic';
  const prohibited = ['prohibited', 'illegal', 'unsupported'].includes(normalized.cargo.category) || ['prohibited', 'illegal'].includes(normalized.cargo.cargoType);

  pushMissing(missing, 'requester.name', normalized.requester.name);
  pushMissing(missing, 'requester.mobile', normalized.requester.mobile);
  pushMissing(missing, 'contact.channel', normalized.contact.channel);
  pushMissing(missing, 'stops.pickup.country', pickup?.country);
  pushMissing(missing, 'stops.pickup.city', pickup?.city);
  pushMissing(missing, 'stops.delivery.country', delivery?.country);
  pushMissing(missing, 'stops.delivery.city', delivery?.city);
  pushMissing(missing, 'cargo.title', normalized.cargo.title);
  pushMissing(missing, 'cargo.description', normalized.cargo.description);
  if (structured) {
    pushMissing(missing, 'stops.pickup.placeType', pickup?.placeType);
    pushMissing(missing, 'stops.delivery.placeType', delivery?.placeType);
    if (!normalized.schedule.pickupFrom && normalized.schedule.readyStatus !== 'unknown') missing.push('schedule.pickupFrom');
    if (!normalized.schedule.quoteDeadline) missing.push('schedule.quoteDeadline');
    if (!normalized.cargo.cargoType) missing.push('cargo.cargoType');
    if (!normalized.vehicle.class && normalized.vehicle.preferenceMode !== 'guidance') missing.push('vehicle.class');
  }

  if (normalized.contact.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.requester.email)) errors.push({ field: 'requester.email', code: 'INVALID_EMAIL', message: 'برای پاسخ ایمیلی، ایمیل معتبر لازم است.' });
  if (normalized.contact.channel !== 'phone' && normalized.contact.channel !== 'sms' && normalized.contact.channel !== 'email') errors.push({ field: 'contact.channel', code: 'INVALID_CHANNEL', message: 'کانال پاسخ معتبر نیست.' });
  if (normalized.contact.channel === 'sms' && normalized.requester.mobile.length < 7) errors.push({ field: 'requester.mobile', code: 'INVALID_MOBILE', message: 'شماره موبایل برای پیامک معتبر نیست.' });
  if (normalized.cargo.specialFlags.includes('none') && normalized.cargo.specialFlags.length > 1) errors.push({ field: 'cargo.specialFlags', code: 'NONE_COMBINATION', message: 'گزینه «بدون ویژگی ویژه» با ویژگی‌های دیگر ترکیب نمی‌شود.' });
  if (normalized.cargo.specialFlags.some((flag) => !SPECIAL_FLAGS.has(flag))) errors.push({ field: 'cargo.specialFlags', code: 'UNKNOWN_FLAG', message: 'ویژگی حساس بار معتبر نیست.' });
  if (PHONE_PATTERN.test(normalized.cargo.descriptionPublic) || PHONE_PATTERN.test(normalized.cargo.notesForDriver)) errors.push({ field: 'cargo.descriptionPublic', code: 'PUBLIC_CONTACT_FORBIDDEN', message: 'شماره تماس را در توضیح عمومی بار وارد نکنید.' });
  if (normalized.cargo.netWeight !== null && calculation.totalGrossWeightKg !== null && normalized.cargo.netWeight > calculation.totalGrossWeightKg) errors.push({ field: 'cargo.netWeight', code: 'NET_OVER_GROSS', message: 'وزن خالص از وزن ناخالص بیشتر نیست.' });
  if (normalized.cargo.totalGrossWeight !== null && normalized.cargo.totalGrossWeight <= 0) errors.push({ field: 'cargo.totalGrossWeight', code: 'NON_POSITIVE_WEIGHT', message: 'وزن کل باید بزرگ‌تر از صفر باشد.' });
  if (normalized.cargo.totalVolume !== null && normalized.cargo.totalVolume < 0) errors.push({ field: 'cargo.totalVolume', code: 'NEGATIVE_VOLUME', message: 'حجم نمی‌تواند منفی باشد.' });
  if (structured && calculation.weightVariancePct !== null && calculation.weightVariancePct > 5) errors.push({ field: 'cargo.totalGrossWeight', code: 'ITEM_WEIGHT_MISMATCH', message: 'مجموع وزن قلم‌های بار با وزن کل اختلاف غیرمجاز دارد.' });
  if (normalized.cargo.isWeightEstimated) warnings.push({ field: 'cargo.totalGrossWeight', code: 'ESTIMATED_WEIGHT', message: 'وزن تقریبی است و ممکن است پس از وزن‌کشی تغییر کند.' });
  for (const unit of normalized.handlingUnits) {
    if (!Number.isInteger(unit.quantity) || unit.quantity < 1) errors.push({ field: 'handlingUnits.quantity', code: 'INVALID_QUANTITY', message: 'تعداد واحد حمل باید عدد صحیح مثبت باشد.' });
    if (unit.weightBasis !== 'per_unit' && unit.weightBasis !== 'total_row') errors.push({ field: 'handlingUnits.weightBasis', code: 'INVALID_WEIGHT_BASIS', message: 'مبنای وزن واحد حمل معتبر نیست.' });
    if (unit.grossWeight !== null && unit.grossWeight < 0) errors.push({ field: 'handlingUnits.grossWeight', code: 'NEGATIVE_WEIGHT', message: 'وزن نمی‌تواند منفی باشد.' });
    if ([unit.length, unit.width, unit.height].some((value) => value !== null && value <= 0)) errors.push({ field: 'handlingUnits.dimensions', code: 'INVALID_DIMENSION', message: 'ابعاد باید مثبت باشند.' });
    const dimensions = [unit.length, unit.width, unit.height].filter((value) => value !== null);
    if (structured && dimensions.length > 0 && dimensions.length < 3) errors.push({ field: 'handlingUnits.dimensions', code: 'INCOMPLETE_DIMENSION', message: 'طول، عرض و ارتفاع باید با هم ثبت شوند.' });
  }
  const temperature = normalized.cargo.temperature || specialRequirements.temperature_controlled;
  if (flags.has('temperature_controlled')) {
    if (temperature?.minC === null || temperature?.maxC === null) errors.push({ field: 'cargo.temperature', code: 'TEMPERATURE_REQUIRED', message: 'بازه دما برای بار دماکنترل لازم است.' });
    if (temperature?.minC !== null && temperature?.maxC !== null && temperature.minC > temperature.maxC) errors.push({ field: 'cargo.temperature', code: 'TEMPERATURE_ORDER', message: 'حداقل دما نباید از حداکثر بیشتر باشد.' });
    if (temperature?.setpointC !== null && temperature?.minC !== null && temperature?.maxC !== null && (temperature.setpointC < temperature.minC || temperature.setpointC > temperature.maxC)) errors.push({ field: 'cargo.temperature.setpointC', code: 'SETPOINT_OUTSIDE_RANGE', message: 'نقطه تنظیم باید داخل بازه مجاز باشد.' });
    if (!['reefer', 'refrigerated', 'temperature_controlled'].includes(normalized.vehicle.body) && strict && mode === 'automatic') errors.push({ field: 'vehicle.body', code: 'REEFER_REQUIRED', message: 'برای بار دمایی خودروی دارای کنترل دما لازم است.' });
  }
  const hazardous = specialRequirements.hazardous;
  if (dangerous && mode === 'automatic' && strict) {
    for (const [field, value] of [['cargo.specialRequirements.hazardous.materialName', hazardous.materialName], ['cargo.specialRequirements.hazardous.unNumber', hazardous.unNumber], ['cargo.specialRequirements.hazardous.hazardClass', hazardous.hazardClass], ['cargo.specialRequirements.hazardous.amount', hazardous.amount]]) {
      if (!value && value !== 0) errors.push({ field, code: 'HAZARDOUS_DETAILS_REQUIRED', message: 'اطلاعات ماده خطرناک برای بررسی کارشناس کامل نیست.' });
    }
  } else if (dangerous) warnings.push({ field: 'cargo.specialRequirements.hazardous', code: 'HAZARDOUS_REVIEW_REQUIRED', message: 'بار خطرناک تا تأیید کارشناس منتشر نمی‌شود.' });
  if (flags.has('liquid') && mode === 'automatic' && strict && !specialRequirements.liquid.liquidType) errors.push({ field: 'cargo.specialRequirements.liquid.liquidType', code: 'LIQUID_DETAILS_REQUIRED', message: 'نوع مایع برای انتشار مشخص نیست.' });
  if (flags.has('live_animal') && mode === 'automatic' && strict && !specialRequirements.live_animal.animalType) errors.push({ field: 'cargo.specialRequirements.live_animal.animalType', code: 'LIVE_ANIMAL_DETAILS_REQUIRED', message: 'نوع حیوان زنده برای انتشار مشخص نیست.' });
  if (flags.has('valuable') && declaredValue === null && mode === 'automatic' && strict) errors.push({ field: 'value.amount', code: 'VALUE_REQUIRED', message: 'ارزش اظهارشده بار ارزشمند لازم است.' });
  if (highValueOverThreshold) warnings.push({ field: 'value.amount', code: 'HIGH_VALUE_REVIEW', message: 'ارزش بار از آستانه انتشار خودکار عبور کرده است.' });
  const pickupFrom = isoDate(normalized.schedule.pickupFrom);
  const pickupTo = isoDate(normalized.schedule.pickupTo);
  const deliveryFrom = isoDate(normalized.schedule.deliveryFrom);
  const deliveryTo = isoDate(normalized.schedule.deliveryTo);
  const deliveryDeadline = isoDate(normalized.schedule.deliveryDeadline || normalized.schedule.deliveryTo);
  const quoteDeadline = isoDate(normalized.schedule.quoteDeadline);
  if (!['Asia/Tehran', 'UTC'].includes(normalized.schedule.timezone)) errors.push({ field: 'schedule.timezone', code: 'INVALID_TIMEZONE', message: 'منطقه زمانی استعلام معتبر نیست.' });
  if (normalized.schedule.readyStatus !== 'unknown' && !pickupFrom) errors.push({ field: 'schedule.pickupFrom', code: 'INVALID_PICKUP_TIME', message: 'زمان شروع بارگیری معتبر نیست.' });
  if (pickupFrom && pickupFrom.getTime() < now.getTime() - 60_000 && !normalized.schedule.futureDateAllowed) errors.push({ field: 'schedule.pickupFrom', code: 'PAST_PICKUP_TIME', message: 'زمان بارگیری در گذشته است.' });
  if (pickupFrom && pickupTo && pickupTo < pickupFrom) errors.push({ field: 'schedule.pickupTo', code: 'PICKUP_ORDER', message: 'پایان بازه بارگیری نباید قبل از شروع آن باشد.' });
  if (deliveryFrom && pickupFrom && deliveryFrom < pickupFrom) errors.push({ field: 'schedule.deliveryFrom', code: 'DELIVERY_BEFORE_PICKUP', message: 'زمان تحویل نباید قبل از زمان بارگیری باشد.' });
  if (deliveryTo && deliveryFrom && deliveryTo < deliveryFrom) errors.push({ field: 'schedule.deliveryTo', code: 'DELIVERY_ORDER', message: 'پایان بازه تحویل نباید قبل از شروع آن باشد.' });
  if (quoteDeadline && pickupFrom && quoteDeadline > pickupFrom) errors.push({ field: 'schedule.quoteDeadline', code: 'DEADLINE_AFTER_PICKUP', message: 'مهلت استعلام نباید بعد از شروع بارگیری باشد.' });
  if (quoteDeadline && quoteDeadline <= now) errors.push({ field: 'schedule.quoteDeadline', code: 'PAST_QUOTE_DEADLINE', message: 'مهلت استعلام باید در آینده باشد.' });
  if (deliveryDeadline && pickupFrom && deliveryDeadline < pickupFrom) errors.push({ field: 'schedule.deliveryDeadline', code: 'DELIVERY_DEADLINE_ORDER', message: 'آخرین مهلت تحویل نباید قبل از بارگیری باشد.' });
  if (normalized.schedule.urgency === 'urgent' && (!pickupFrom || !deliveryDeadline)) errors.push({ field: 'schedule', code: 'URGENT_SCHEDULE_REQUIRED', message: 'بار فوری به زمان دقیق بارگیری و آخرین مهلت تحویل نیاز دارد.' });
  if (normalized.vehicle.count < 1) errors.push({ field: 'vehicle.count', code: 'INVALID_VEHICLE_COUNT', message: 'تعداد خودرو باید مثبت باشد.' });
  if (normalized.vehicle.requiredPayload !== null && calculation.totalGrossWeightKg !== null && normalized.vehicle.requiredPayload < calculation.totalGrossWeightKg) errors.push({ field: 'vehicle.requiredPayload', code: 'VEHICLE_CAPACITY_EXCEEDED', message: 'ظرفیت انتخابی برای وزن بار کافی نیست.' });
  if (normalized.route.estimatedDistanceKm !== null && normalized.route.estimatedDistanceKm > rules.maxAutoDistanceKm) warnings.push({ field: 'route.estimatedDistanceKm', code: 'DISTANCE_REVIEW', message: 'مسیر از سقف انتشار خودکار عبور کرده و نیازمند بررسی است.' });
  if (pickup?.city && delivery?.city && pickup.city === delivery.city && !['urban', 'round_trip'].includes(normalized.route.sameLocationMode || normalized.route.routeType)) errors.push({ field: 'route.routeType', code: 'SAME_CITY_ROUTE_TYPE_REQUIRED', message: 'برای مبدأ و مقصد یکسان، نوع حمل شهری یا رفت‌وبرگشت را مشخص کنید.' });

  if (mode === 'automatic' && strict) {
    if (!normalized.consent.shareWithDrivers) errors.push({ field: 'consent.shareWithDrivers', code: 'DRIVER_SHARING_CONSENT_REQUIRED', message: 'رضایت اشتراک اطلاعات لازم برای انتشار خودکار ثبت نشده است.' });
    if (calculation.totalGrossWeightKg === null || calculation.totalGrossWeightKg <= 0) errors.push({ field: 'cargo.totalGrossWeight', code: 'WEIGHT_REQUIRED', message: 'برای انتشار خودکار وزن ناخالص مثبت لازم است.' });
    if (normalized.vehicle.preferenceMode === 'guidance') errors.push({ field: 'vehicle.preferenceMode', code: 'VEHICLE_GUIDANCE_REVIEW', message: 'انتخاب خودرو برای انتشار خودکار کامل نیست و نیازمند بررسی است.' });
    if (normalized.schedule.readyStatus === 'unknown') errors.push({ field: 'schedule.readyStatus', code: 'READY_STATUS_REVIEW', message: 'آمادگی بار برای انتشار خودکار مشخص نیست.' });
    if (!quoteDeadline) missing.push('schedule.quoteDeadline');
    if (structured) {
      for (const [field, value] of [['consent.dataAccuracy', normalized.consent.dataAccuracy], ['consent.prohibitedGoods', normalized.consent.prohibitedGoods], ['consent.contractNotFinal', normalized.consent.contractNotFinal], ['consent.priceMayChange', normalized.consent.priceMayChange]]) {
        if (!value) errors.push({ field, code: 'CONSENT_REQUIRED', message: 'تأییدهای نهایی فرم کامل نشده است.' });
      }
    }
  }
  if (mode === 'support' && strict && normalized.requester.mobile.length < 7) errors.push({ field: 'requester.mobile', code: 'INVALID_MOBILE', message: 'شماره تماس برای پیگیری معتبر نیست.' });

  const complex = normalized.route.extraStops.length > 0 || normalized.vehicle.count > 1 || normalized.route.scope !== 'domestic' || normalized.route.routeType === 'round_trip' || (normalized.route.estimatedDistanceKm !== null && normalized.route.estimatedDistanceKm > rules.maxAutoDistanceKm);
  const ready = missing.length === 0 && errors.length === 0;
  const decisionCode = prohibited
    ? 'REJECTED_PROHIBITED_OR_UNSUPPORTED'
    : !ready
      ? 'REJECTED_MISSING_INFORMATION'
      : manualOnly
        ? 'MANUAL_ONLY'
        : specialistRequired
          ? 'SUPPORT_REVIEW_REQUIRED'
          : (complex || warnings.some((warning) => warning.code === 'DISTANCE_REVIEW'))
            ? 'MANUAL_ONLY'
          : 'AUTO_DRIVER_QUOTE';
  return {
    ready,
    missing: [...new Set(missing)],
    errors,
    warnings,
    calculation,
    flags: [...flags],
    requiresSpecialist: specialistRequired,
    dangerous,
    complex,
    manualOnly,
    prohibited,
    highValueOverThreshold,
    decisionCode,
    policyVersion: rules.policyVersion,
    publicationAllowed: ready && !specialistRequired && !complex,
    mode,
    normalized
  };
}

export function assertInquiryValid(payload, options = {}) {
  const result = validateInquiry(payload, { ...options, strict: true });
  if (!result.ready) throw new DomainError('CARGO-422', 'اطلاعات استعلام کامل یا معتبر نیست.', 422, { missing: result.missing, errors: result.errors });
  return result;
}

export function publicationDecision(review) {
  const code = review?.decisionCode || (!review?.ready ? 'REJECTED_MISSING_INFORMATION' : review?.requiresSpecialist || review?.complex ? 'SUPPORT_REVIEW_REQUIRED' : 'AUTO_DRIVER_QUOTE');
  if (code === 'REJECTED_PROHIBITED_OR_UNSUPPORTED') return { state: 'REJECTED', code, reason: 'prohibited_or_unsupported' };
  if (code === 'REJECTED_MISSING_INFORMATION') return { state: 'NEEDS_COMPLETION', code, reason: 'missing_or_invalid_data' };
  if (code === 'MANUAL_ONLY') return { state: 'PENDING_REVIEW', code, reason: 'manual_only_policy' };
  if (code === 'SUPPORT_REVIEW_REQUIRED') return { state: 'PENDING_SPECIALIST', code, reason: 'specialist_review_required' };
  return { state: 'PUBLISHED', code: 'AUTO_DRIVER_QUOTE', reason: null };
}

export function driverProjection(inquiry, { includePrice = false } = {}) {
  const rawPayload = inquiry?.payload || inquiry?.payload_json || {};
  const payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload || '{}') : rawPayload;
  const normalized = normalizeInquiryPayload(payload);
  const pickup = normalized.stops.find((stop) => stop.operation === 'pickup') || normalized.stops[0];
  const delivery = normalized.stops.find((stop) => stop.operation === 'delivery') || normalized.stops[1];
  const calculation = calculateCargo(normalized);
  return {
    publicId: inquiry.publicId || inquiry.public_id,
    versionNo: inquiry.versionNo || inquiry.version_no || 1,
    cargo: {
      title: normalized.cargo.title,
      category: normalized.cargo.category,
      totalGrossWeightKg: calculation.totalGrossWeightKg,
      totalVolumeM3: calculation.totalVolumeM3,
      specialFlags: normalized.cargo.specialFlags,
      measurementStatus: normalized.cargo.measurementStatus,
      condition: normalized.cargo.condition,
      packagingType: normalized.cargo.packaging.type
    },
    route: {
      origin: { country: pickup?.country || '', city: pickup?.city || '', district: pickup?.district || '' },
      destination: { country: delivery?.country || '', city: delivery?.city || '', district: delivery?.district || '' }
    },
    schedule: { pickupFrom: normalized.schedule.pickupFrom, pickupTo: normalized.schedule.pickupTo, urgency: normalized.schedule.urgency, timezone: normalized.schedule.timezone },
    vehicle: { class: normalized.vehicle.class, body: normalized.vehicle.body, types: normalized.vehicle.types, requiredEquipment: normalized.vehicle.requiredEquipment },
    services: normalized.services.requested,
    priceContext: includePrice ? { budgetAmount: normalized.value.budgetAmount, budgetCurrency: normalized.value.budgetCurrency } : undefined
  };
}

export function validateOffer(input = {}) {
  const rawAmountMinor = integer(input.amountMinor ?? input.totalAmountMinor ?? input.total_amount_minor);
  const amount = finite(input.amount);
  const amountMinor = rawAmountMinor ?? (amount !== null ? Math.round(amount) : null);
  const currency = text(input.currency, 3).toUpperCase() || 'IRR';
  const validUntil = isoDate(input.validUntil || input.valid_until);
  const errors = [];
  if (amountMinor === null || amountMinor <= 0) errors.push({ field: 'amountMinor', code: 'INVALID_AMOUNT', message: 'مبلغ پیشنهاد باید مثبت باشد.' });
  if (!CURRENCY_CODES.has(currency)) errors.push({ field: 'currency', code: 'INVALID_CURRENCY', message: 'ارز پیشنهاد پشتیبانی نمی‌شود.' });
  if (!validUntil || validUntil <= new Date()) errors.push({ field: 'validUntil', code: 'INVALID_VALID_UNTIL', message: 'اعتبار پیشنهاد باید در آینده باشد.' });
  const includedServices = list(input.includedServices || input.included_services || (input.included ? [input.included] : []), 40, 80);
  const excludedServices = list(input.excludedServices || input.excluded_services || (input.excluded ? [input.excluded] : []), 40, 80);
  if (!includedServices.length && !excludedServices.length && input.servicesRequired) errors.push({ field: 'includedServices', code: 'SERVICE_SCOPE_REQUIRED', message: 'اقلام مشمول و غیرمشمول قیمت را مشخص کنید.' });
  if (errors.length) throw new DomainError('OFFER-422', 'پیشنهاد قیمت معتبر نیست.', 422, { errors });
  const components = input.components && typeof input.components === 'object' ? Object.fromEntries(Object.entries(input.components).slice(0, 24).map(([key, value]) => [text(key, 64), integer(value) ?? 0])) : {};
  return {
    amount: amount ?? amountMinor,
    amountMinor,
    currency,
    validUntil: validUntil.toISOString(),
    basis: text(input.basis, 200),
    included: text(input.included, 500),
    excluded: text(input.excluded, 500),
    includedServices,
    excludedServices,
    components,
    estimatedArrivalMinutes: integer(input.estimatedArrivalMinutes ?? input.estimated_arrival_minutes),
    vehicleId: integer(input.vehicleId ?? input.vehicle_id),
    loadingIncluded: input.loadingIncluded ?? input.loading_included ?? null,
    unloadingIncluded: input.unloadingIncluded ?? input.unloading_included ?? null,
    conditions: text(input.conditions, 500),
    note: text(input.driverNote || input.note, 600)
  };
}

export function assertOfferSelectable({ offer, inquiry, versionNo, now = new Date() }) {
  if (!offer || !inquiry) throw new DomainError('OFFER-404', 'پیشنهاد پیدا نشد.', 404);
  if (String(offer.inquiry_id || offer.inquiryId) !== String(inquiry.id)) throw new DomainError('OFFER-403', 'پیشنهاد به این استعلام تعلق ندارد.', 403);
  if (Number(offer.version_no || offer.versionNo) !== Number(versionNo)) throw new DomainError('OFFER-409', 'پیشنهاد مربوط به نسخه جاری استعلام نیست.', 409);
  if (offer.state && offer.state !== 'ACTIVE') throw new DomainError('OFFER-409', 'این پیشنهاد دیگر فعال نیست.', 409);
  if (new Date(offer.valid_until || offer.validUntil).getTime() <= now.getTime()) throw new DomainError('OFFER-409', 'مهلت پیشنهاد پایان یافته است.', 409);
  if (inquiry.state === 'OFFER_SELECTED' || inquiry.state === 'CANCELLED' || inquiry.state === 'EXPIRED') throw new DomainError('CARGO-409', 'استعلام در وضعیت انتخاب پیشنهاد نیست.', 409);
  return true;
}

export { SPECIALIST_FLAGS };
