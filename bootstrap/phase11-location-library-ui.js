'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

// Keep the validated Phase 11.9.7 materializer intact.
require('./phase11-location-library-ui-v1197.js');

// Phase 11.9.4 audit hardening: a reference that safely becomes a brand-new reusable location
// must finish as registered_new instead of leaving the provisional unresolved resolver row behind.
for (const rel of [
  'fix-phase11-location-resolver-audit.js',
  'verify-phase11-location-resolver-audit.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
}
require('./fix-phase11-location-resolver-audit.js');
execFileSync(process.execPath, [path.join(__dirname, 'verify-phase11-location-resolver-audit.js')], { stdio: 'inherit' });

// Close the roadmap with the Phase 11.9.8 E2E gate.
for (const rel of [
  'phase11-reusable-location-e2e.js',
  'verify-phase11-reusable-location-e2e.js',
  'e2e/location-system-memory-db.js',
  'e2e/location-system-fixtures.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
}

require('./phase11-reusable-location-e2e.js');
execFileSync(process.execPath, [path.join(__dirname, 'verify-phase11-reusable-location-e2e.js')], { stdio: 'inherit' });
