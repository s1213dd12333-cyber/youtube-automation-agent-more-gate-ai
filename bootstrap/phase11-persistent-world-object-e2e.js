'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const packagePath = path.join(upstream, 'package.json');

for (const rel of [
  'bootstrap/e2e/object-system-memory-db.js',
  'bootstrap/e2e/object-system-fixtures.js',
  'bootstrap/verify-phase11-persistent-world-object-e2e.js'
]) {
  if (!fs.existsSync(path.join(root, rel))) throw new Error(`Phase 11.10.8 prerequisite missing: ${rel}`);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.scripts = pkg.scripts || {};
pkg.scripts['test:persistent-world-object:e2e'] = 'node ../bootstrap/verify-phase11-persistent-world-object-e2e.js';
pkg.scripts['test:persistent-world-object:full'] = [
  'npm run test:persistent-world-objects',
  'npm run test:persistent-world-object-resolver',
  'npm run test:canonical-world-object-assets',
  'npm run test:persistent-world-object-state',
  'npm run test:persistent-world-object-binding',
  'npm run test:cross-video-object-continuity',
  'npm run test:persistent-world-object-library-ui',
  'npm run test:persistent-world-object:e2e'
].join(' && ');
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

console.log('FASE 11.10.8 ativa: gate E2E deterministico multi-video para Persistent World Objects, cobrindo 11.10.1–11.10.7 antes do fechamento da Fase 11.10.');
