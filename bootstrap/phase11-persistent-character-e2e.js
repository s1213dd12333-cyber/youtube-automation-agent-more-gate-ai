'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const packagePath = path.join(upstream, 'package.json');

for (const rel of [
  'bootstrap/e2e/character-system-memory-db.js',
  'bootstrap/e2e/character-system-fixtures.js',
  'bootstrap/verify-phase11-persistent-character-e2e.js'
]) {
  if (!fs.existsSync(path.join(root, rel))) throw new Error(`Phase 11.11.8 prerequisite missing: ${rel}`);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.scripts = pkg.scripts || {};
pkg.scripts['test:persistent-character:e2e'] = 'node ../bootstrap/verify-phase11-persistent-character-e2e.js';
pkg.scripts['test:persistent-character:full'] = [
  'npm run test:persistent-characters',
  'npm run test:persistent-character-resolver',
  'npm run test:canonical-character-assets',
  'npm run test:persistent-character-appearance-state',
  'npm run test:persistent-character-binding',
  'node ../bootstrap/verify-phase11-persistent-character-binding-hardening.js',
  'npm run test:cross-video-character-continuity',
  'npm run test:persistent-character-library-ui',
  'npm run test:persistent-character:e2e'
].join(' && ');
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

console.log('FASE 11.11.8 ativa: gate E2E deterministico multi-episodio para Persistent Characters, cobrindo 11.11.1–11.11.7 antes do fechamento da Fase 11.11.');
