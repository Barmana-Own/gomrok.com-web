const migration = ({
  id,
  order,
  packageId,
  title,
  dependsOn = [],
  status = 'RESERVED',
  preflightScript = null,
  preflightChecksum = null,
  script = null,
  checksum = null,
  postcheckScript = null,
  postcheckChecksum = null
}) => Object.freeze({
  id,
  order,
  packageId,
  title,
  dependsOn: Object.freeze([...dependsOn]),
  status,
  preflightScript,
  preflightChecksum,
  script,
  checksum,
  postcheckScript,
  postcheckChecksum
});

export const ANNEX_MIGRATION_SEQUENCE = Object.freeze([
  'M1',
  'M2',
  'M3',
  'M4',
  'M5',
  'M6',
  'M7',
  'M8'
]);

// RESERVED slots have no artifacts. PREPARED slots have checksum-pinned
// artifacts but remain non-executable until disposable-database validation
// promotes them to READY in a separately reviewed package.
export const ANNEX_MIGRATION_MANIFEST = Object.freeze({
  schemaVersion: 2,
  series: 'structural-annex-v1',
  migrations: Object.freeze([
    migration({
      id: 'M1',
      order: 1,
      packageId: 'P10',
      title: 'Operating contexts and initial role-derived boundaries',
      status: 'PREPARED',
      preflightScript: 'sql/M1.preflight.sql',
      preflightChecksum: '1f7c0f212f625104bbc4f0af309d24c91c31bd4d0629849798611be5e31fbdc1',
      script: 'sql/M1.sql',
      checksum: 'c526ba9e262b5b2219a3ca8c7aeb470ade3649c0b51678a29519db023c1176a6',
      postcheckScript: 'sql/M1.postcheck.sql',
      postcheckChecksum: '264476a4614678a7f4a2f7d813bef8b27708f9139f2f0763ecf0ce9f32acac8b'
    }),
    migration({
      id: 'M2',
      order: 2,
      packageId: 'P10',
      title: 'Role grants, context linkage, membership, and sessions',
      dependsOn: ['M1'],
      status: 'PREPARED',
      preflightScript: 'sql/M2.preflight.sql',
      preflightChecksum: '4070f3f5f0ed2bb4708fca62e315302038551465c03fe556b4ef441af27c14e8',
      script: 'sql/M2.sql',
      checksum: '53930f2a02f955e4afab54fa3d952b17ae329b0350d2544549405fda913389db',
      postcheckScript: 'sql/M2.postcheck.sql',
      postcheckChecksum: '879fce9d0c989948681e29f28befb78d70f753d87956a86fa09084b3ad4e5283'
    }),
    migration({
      id: 'M3',
      order: 3,
      packageId: 'P11',
      title: 'Nullable transactional context and controlled backfill',
      dependsOn: ['M2'],
      status: 'PREPARED',
      preflightScript: 'sql/M3.preflight.sql',
      preflightChecksum: '7dd37c69564cb34acfccfc011e27b3dfc2521a0a12bae8cd8251c28faaec64b8',
      script: 'sql/M3.sql',
      checksum: 'd5197d7ba552e485e90bbadb3c4908a4ce8d51a28370f5936f5676a57edd41c0',
      postcheckScript: 'sql/M3.postcheck.sql',
      postcheckChecksum: '60fad25cf7704e9ff26ecfb2286666a08673222837a3184e3d28d2825b2730d8'
    }),
    migration({ id: 'M4', order: 4, packageId: 'P11', title: 'Required context and fail-closed query boundaries', dependsOn: ['M3'] }),
    migration({ id: 'M5', order: 5, packageId: 'P12', title: 'Document issuer authority foundation', dependsOn: ['M4'] }),
    migration({ id: 'M6', order: 6, packageId: 'P20', title: 'Consignment and allocation hierarchy', dependsOn: ['M5'] }),
    migration({ id: 'M7', order: 7, packageId: 'P21', title: 'Global active-vehicle reservation integrity', dependsOn: ['M6'] }),
    migration({ id: 'M8', order: 8, packageId: 'P40', title: 'Inter-context financial separation', dependsOn: ['M7'] })
  ])
});
