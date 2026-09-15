'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
require('./fix-phase11-prop-lock-attributes.js');
const { PropLockV11, canonicalName } = require(path.join(upstream, 'utils', 'prop-lock-v11.js'));

const environmentBible = {
  version: '11.7.1',
  productionId: 'prod_prop_lock_fixture',
  fingerprint: 'env-bible-fixture-fingerprint',
  environments: [
    {
      environmentId: 'env_house_fixture',
      name: 'Wooden Family House',
      category: 'house',
      architecturalStyle: 'cozy rustic family home',
      materials: ['natural wood', 'soft fabric', 'matte metal accents'],
      signatureElements: ['sofa', 'coffee table', 'bookshelf', 'window', 'rug'],
      sourceEvidence: [{
        source: 'explicit_instruction',
        text: 'Environment: a furnished wooden house with a beige sofa, rustic wooden coffee table, bookshelf, large window and light rug.'
      }],
      masterFramePath: null
    },
    {
      environmentId: 'env_garden_fixture',
      name: 'Colorful Garden',
      category: 'garden',
      architecturalStyle: 'friendly storybook garden',
      materials: ['grass', 'soil', 'wood', 'stone'],
      signatureElements: ['garden path', 'flower bed', 'open sky'],
      sourceEvidence: [{ source: 'production_text', text: 'The characters walk along the garden path.' }],
      masterFramePath: null
    }
  ]
};

const production = { id: 'prod_prop_lock_fixture' };
const service = new PropLockV11({ enabled: true, maxPerEnvironment: 24 });
const plan = service.buildProductionLocks(production, environmentBible);
const again = service.buildProductionLocks(production, environmentBible);
const sofa = plan.locks.find(lock => lock.environmentId === 'env_house_fixture' && lock.name === 'sofa');
const table = plan.locks.find(lock => lock.environmentId === 'env_house_fixture' && lock.name === 'coffee table');
const bookshelf = plan.locks.find(lock => lock.environmentId === 'env_house_fixture' && lock.name === 'bookshelf');
const windowLock = plan.locks.find(lock => lock.environmentId === 'env_house_fixture' && lock.name === 'window');
const gardenPath = plan.locks.find(lock => lock.environmentId === 'env_garden_fixture' && lock.name === 'garden path');
const flowerBed = plan.locks.find(lock => lock.environmentId === 'env_garden_fixture' && lock.name === 'flower bed');

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

const checks = [
  () => assert(plan),
  () => assert.strictEqual(plan.version, '11.7.2'),
  () => assert.strictEqual(plan.productionId, production.id),
  () => assert.strictEqual(plan.environmentBibleFingerprint, environmentBible.fingerprint),
  () => assert.strictEqual(plan.summary.environmentCount, 2),
  () => assert.strictEqual(plan.summary.lockCount, plan.locks.length),
  () => assert(plan.summary.requiredCount >= 5),
  () => assert(plan.summary.inferredCount >= 2),
  () => assert.strictEqual(plan.summary.placementAnchoredCount, 0),
  () => assert(/^[a-f0-9]{64}$/.test(plan.fingerprint)),
  () => assert.strictEqual(plan.fingerprint, again.fingerprint),
  () => assert.deepStrictEqual(plan.locks.map(lock => lock.id), again.locks.map(lock => lock.id)),
  () => assert.strictEqual(canonicalName('couch'), 'sofa'),
  () => assert.strictEqual(canonicalName('mesa de centro'), 'coffee table'),
  () => assert(sofa && sofa.required === true),
  () => assert.strictEqual(sofa.continuityPriority, 'critical'),
  () => assert.strictEqual(sofa.lockedAttributes.color, 'beige'),
  () => assert.strictEqual(sofa.lockedAttributes.colorSource, 'explicit_instruction'),
  () => assert.strictEqual(table.lockedAttributes.color, null),
  () => assert.strictEqual(table.lockedAttributes.material, 'natural wood'),
  () => assert.strictEqual(table.lockedAttributes.materialSource, 'explicit_instruction'),
  () => assert(sofa.forbiddenChanges.some(value => value.includes('different object'))),
  () => assert.strictEqual(sofa.placementStatus, 'unanchored_until_master_frame'),
  () => assert.strictEqual(table.required, true),
  () => assert.strictEqual(bookshelf.type, 'furniture'),
  () => assert.strictEqual(windowLock.type, 'architectural_fixture'),
  () => assert.strictEqual(windowLock.required, true),
  () => assert.strictEqual(gardenPath.required, true),
  () => assert.strictEqual(gardenPath.continuityPriority, 'high'),
  () => assert.strictEqual(flowerBed.required, false),
  () => assert.strictEqual(flowerBed.sourceType, 'inferred_default'),
  () => assert(plan.promptContext.includes('PROP LOCK SERVICE V11.7.2')),
  () => assert(plan.promptContext.includes('env_house_fixture')),
  () => assert(plan.promptContext.includes('PROP LOCK: sofa')),
  () => assert.strictEqual(service.forEnvironment(plan, 'env_house_fixture').length, 5),
  () => assert(service.promptForEnvironment(plan, 'env_house_fixture').includes('REQUIRED: yes')),
  () => assert.strictEqual(new PropLockV11({ enabled: false }).buildProductionLocks(production, environmentBible), null),
  () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS prop_locks')),
  () => assert(dbSource.includes('plan_fingerprint TEXT NOT NULL')),
  () => assert(dbSource.includes('async replaceProductionPropLocks(')),
  () => assert(dbSource.includes('async listPropLocks(')),
  () => assert(dbSource.includes('async getPropLock(')),
  () => assert(dbSource.includes('const propLocks = await this.listPropLocks(productionId);')),
  () => assert(dbSource.includes('propLocks,')),
  () => assert(pipelineSource.includes("const { PropLockV11 } = require('./prop-lock-v11');")),
  () => assert(pipelineSource.includes('this.propLock = options.propLock || new PropLockV11')),
  () => assert(pipelineSource.includes('this.propLock.buildProductionLocks(production, environmentBible)')),
  () => assert(pipelineSource.includes('replaceProductionPropLocks(production.id, propLockPlan)')),
  () => assert(pipelineSource.includes('Prop Lock v11.7.2 ready for')),
  () => assert(dashboardSource.includes('PROP LOCK V11.7.2')),
  () => assert(dashboardSource.includes('renderPropLocks(item)')),
  () => assert(dashboardSource.includes('${renderPropLocks(item)}')),
  () => assert.strictEqual(pkg.scripts['test:prop-lock'], 'node ../bootstrap/verify-phase11-prop-lock.js'),
  () => assert(envSource.includes('PROP_LOCK_ENABLED=true')),
  () => assert(envSource.includes('PROP_LOCK_MAX_PER_ENVIRONMENT=24')),
  () => assert(plan.locks.every(lock => lock.planFingerprint === plan.fingerprint)),
  () => assert(plan.locks.every(lock => /^[a-f0-9]{64}$/.test(lock.fingerprint))),
  () => assert(plan.locks.every(lock => lock.status === 'locked_identity')),
  () => assert(plan.locks.every(lock => Array.isArray(lock.allowedChanges) && lock.allowedChanges.length >= 2)),
  () => assert(plan.locks.every(lock => Array.isArray(lock.forbiddenChanges) && lock.forbiddenChanges.length >= 2))
];

for (const check of checks) check();
console.log(`Phase 11.7.2 Prop Lock OK: ${checks.length} regression checks passed.`);
