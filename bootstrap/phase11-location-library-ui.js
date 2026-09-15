'use strict';

const fs = require('fs');
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

// Close the Phase 11.9 roadmap with its deterministic cross-video E2E gate.
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

// Phase 11.10.1 begins persistent story-world object continuity after the location system is proven healthy.
for (const rel of [
  'phase11-persistent-world-objects.js',
  'verify-phase11-persistent-world-objects.js',
  'templates/persistent-world-object-registry-v11.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
}
for (const rel of [
  'templates/persistent-world-object-db-tables-v11.txt',
  'templates/persistent-world-object-db-methods-v11.txt'
]) {
  if (!fs.existsSync(path.join(__dirname, rel))) throw new Error(`Phase 11.10.1 prerequisite missing: ${rel}`);
}
require('./phase11-persistent-world-objects.js');
execFileSync(process.execPath, [path.join(__dirname, 'verify-phase11-persistent-world-objects.js')], { stdio: 'inherit' });

// Phase 11.10.2 adds conservative aliases and narrative object resolution on top of the proven registry.
for (const rel of [
  'phase11-persistent-world-object-resolver.js',
  'verify-phase11-persistent-world-object-resolver.js',
  'templates/persistent-world-object-resolver-v11.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
}
for (const rel of [
  'templates/persistent-world-object-resolver-db-tables-v11.txt',
  'templates/persistent-world-object-resolver-db-methods-v11.txt'
]) {
  if (!fs.existsSync(path.join(__dirname, rel))) throw new Error(`Phase 11.10.2 prerequisite missing: ${rel}`);
}
require('./phase11-persistent-world-object-resolver.js');
execFileSync(process.execPath, [path.join(__dirname, 'verify-phase11-persistent-world-object-resolver.js')], { stdio: 'inherit' });

// Phase 11.10.3 promotes only explicit provider-backed canonical object references and freezes their origin hash/provenance.
for (const rel of [
  'phase11-canonical-world-object-assets.js',
  'verify-phase11-canonical-world-object-assets.js',
  'templates/canonical-world-object-assets-v11.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
}
for (const rel of [
  'templates/persistent-world-object-assets-db-tables-v11.txt',
  'templates/persistent-world-object-assets-db-methods-v11.txt'
]) {
  if (!fs.existsSync(path.join(__dirname, rel))) throw new Error(`Phase 11.10.3 prerequisite missing: ${rel}`);
}
require('./phase11-canonical-world-object-assets.js');
execFileSync(process.execPath, [path.join(__dirname, 'verify-phase11-canonical-world-object-assets.js')], { stdio: 'inherit' });

// Phase 11.10.4 adds mutable scene/durable lifecycle state without rewriting canonical object identity or assets.
for (const rel of [
  'phase11-persistent-world-object-state.js',
  'verify-phase11-persistent-world-object-state.js',
  'templates/persistent-world-object-state-v11.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
}
for (const rel of [
  'templates/persistent-world-object-state-db-tables-v11.txt',
  'templates/persistent-world-object-state-db-methods-v11.txt'
]) {
  if (!fs.existsSync(path.join(__dirname, rel))) throw new Error(`Phase 11.10.4 prerequisite missing: ${rel}`);
}
require('./phase11-persistent-world-object-state.js');
execFileSync(process.execPath, [path.join(__dirname, 'verify-phase11-persistent-world-object-state.js')], { stdio: 'inherit' });

// Phase 11.10.5 binds already-resolved persistent objects explicitly to scene/shot presence semantics before shot persistence.
for (const rel of [
  'phase11-persistent-world-object-binding.js',
  'verify-phase11-persistent-world-object-binding.js',
  'templates/persistent-world-object-binding-v11.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
}
for (const rel of [
  'templates/persistent-world-object-binding-db-tables-v11.txt',
  'templates/persistent-world-object-binding-db-methods-v11.txt'
]) {
  if (!fs.existsSync(path.join(__dirname, rel))) throw new Error(`Phase 11.10.5 prerequisite missing: ${rel}`);
}
require('./phase11-persistent-world-object-binding.js');
execFileSync(process.execPath, [path.join(__dirname, 'verify-phase11-persistent-world-object-binding.js')], { stdio: 'inherit' });

// Phase 11.10.6 gates only resolved visible/occluded reused objects against their immutable canonical references.
for (const rel of [
  'phase11-cross-video-object-continuity.js',
  'verify-phase11-cross-video-object-continuity.js',
  'templates/cross-video-object-continuity-gate-v11.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
}
for (const rel of [
  'templates/cross-video-object-continuity-db-tables-v11.txt',
  'templates/cross-video-object-continuity-db-methods-v11.txt'
]) {
  if (!fs.existsSync(path.join(__dirname, rel))) throw new Error(`Phase 11.10.6 prerequisite missing: ${rel}`);
}
require('./phase11-cross-video-object-continuity.js');
execFileSync(process.execPath, [path.join(__dirname, 'verify-phase11-cross-video-object-continuity.js')], { stdio: 'inherit' });

// Phase 11.10.7 exposes the persistent object library and audited, fail-closed operator corrections.
for (const rel of [
  'phase11-persistent-world-object-library-ui.js',
  'verify-phase11-persistent-world-object-library-ui.js',
  'templates/persistent-world-object-library-manager-v11.js',
  'templates/persistent-world-object-library-dashboard-v11.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(__dirname, rel)], { stdio: 'inherit' });
}
for (const rel of [
  'templates/persistent-world-object-operator-db-tables-v11.txt',
  'templates/persistent-world-object-operator-db-methods-v11.txt',
  'templates/persistent-world-object-library-dashboard-v11.css'
]) {
  if (!fs.existsSync(path.join(__dirname, rel))) throw new Error(`Phase 11.10.7 prerequisite missing: ${rel}`);
}
require('./phase11-persistent-world-object-library-ui.js');
execFileSync(process.execPath, [path.join(__dirname, 'verify-phase11-persistent-world-object-library-ui.js')], { stdio: 'inherit' });
