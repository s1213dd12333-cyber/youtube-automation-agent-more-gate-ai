'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);

const requiredRuntime = [
  'utils/reusable-location-library-v11.js',
  'utils/location-resolver-v11.js',
  'utils/location-zone-registry-v11.js',
  'utils/canonical-location-assets-v11.js',
  'utils/temporary-location-state-v11.js',
  'utils/cross-video-continuity-gate-v11.js',
  'utils/location-library-manager-v11.js'
];
for (const rel of requiredRuntime) {
  if (!fs.existsSync(file(rel))) throw new Error(`Phase 11.9.8 prerequisite missing: ${rel}`);
}

// Backward-compatible public version alias for the integrated 11.9 E2E contract.
// The canonical 11.9.2 export remains REUSABLE_LOCATION_ZONES_VERSION.
const zoneRuntimePath = file('utils/location-zone-registry-v11.js');
let zoneRuntime = fs.readFileSync(zoneRuntimePath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
if (!zoneRuntime.includes('LOCATION_ZONE_REGISTRY_VERSION: VERSION')) {
  const anchor = 'module.exports = {\n  REUSABLE_LOCATION_ZONES_VERSION: VERSION,\n';
  if (!zoneRuntime.includes(anchor)) throw new Error('Phase 11.9.8 compatibility anchor missing: location-zone version export');
  zoneRuntime = zoneRuntime.replace(anchor, 'module.exports = {\n  REUSABLE_LOCATION_ZONES_VERSION: VERSION,\n  LOCATION_ZONE_REGISTRY_VERSION: VERSION,\n');
  fs.writeFileSync(zoneRuntimePath, zoneRuntime, 'utf8');
}

const pkgPath = file('package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.scripts = pkg.scripts || {};
pkg.scripts['test:location-system:e2e'] = 'node ../bootstrap/verify-phase11-reusable-location-e2e.js';
pkg.scripts['test:location-system:full'] = [
  'npm run test:reusable-locations',
  'npm run test:location-zones',
  'npm run test:canonical-location-assets',
  'npm run test:location-resolver',
  'npm run test:temporary-location-state',
  'npm run test:cross-video-continuity',
  'npm run test:location-library-ui',
  'npm run test:location-system:e2e'
].join(' && ');
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

console.log('FASE 11.9.8 ativa: suite E2E deterministica valida 5 producoes cross-video, aliases, auto-selection, zones, canonical assets, temporary state e drift fail-closed.');
