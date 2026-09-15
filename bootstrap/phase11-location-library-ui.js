'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

// Keep the validated Phase 11.9.7 materializer intact, then close the roadmap with the 11.9.8 E2E gate.
require('./phase11-location-library-ui-v1197.js');

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
