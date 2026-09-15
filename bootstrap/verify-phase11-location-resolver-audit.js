'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'reusable-location-library-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.9.4 audit verifier requires materialized reusable-location-library-v11.js');

const source = fs.readFileSync(runtimePath, 'utf8');
assert(source.includes("status: 'registered_new'"));
assert(source.includes("matchMode: 'resolver_unresolved_register_new'"));
assert(source.includes("reason: 'no_safe_reusable_location_match_registered_new'"));

const { ReusableLocationLibraryV11 } = require(runtimePath);
const audits = [];
const locations = [];
const usages = [];

const db = {
  async getReusableLocationByFingerprint() { return null; },
  async saveReusableLocation(input) { const saved = { ...input }; locations.push(saved); return saved; },
  async saveReusableLocationUsage(input) { const saved = { id: 'usage_1', ...input }; usages.push(saved); return saved; },
  async saveReusableLocationResolution(input) { const saved = { id: 'resolution_final', ...input }; audits.push(saved); return saved; }
};

const resolver = {
  async resolveEnvironment({ environment }) {
    return {
      version: '11.9.4', active: true, status: 'unresolved', location: null, matchMode: null, confidence: 0,
      candidates: [], reason: 'no_safe_location_match', referenceText: environment.name,
      referenceKey: 'parker::dwelling', requestedType: 'dwelling'
    };
  },
  async ensureLocationAliases() { return []; }
};

const manager = {
  async autoSelectEnvironment() {
    return { version: '11.9.7', status: 'unresolved', location: null, matchMode: null, reason: 'top_candidate_below_threshold' };
  }
};

(async () => {
  const service = new ReusableLocationLibraryV11(db, {
    enabled: true,
    namespace: 'series_alpha',
    locationResolver: resolver,
    locationLibraryManager: manager
  });
  const environment = {
    environmentId: 'env_parker',
    name: 'Parker House',
    category: 'house',
    construction: 'brick',
    architecturalStyle: 'suburban',
    materials: ['brick', 'wood'],
    palette: ['cream', 'brown'],
    layout: 'living room left, kitchen rear',
    signatureElements: ['front porch']
  };
  const result = await service.registerEnvironment({ id: 'video_new' }, environment, [], []);
  assert(result.location);
  assert.strictEqual(result.reused, false);
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].status, 'registered_new');
  assert.strictEqual(audits[0].locationId, result.location.id);
  assert.strictEqual(audits[0].matchMode, 'resolver_unresolved_register_new');
  assert.strictEqual(audits[0].confidence, 1);
  assert.deepStrictEqual(audits[0].candidateLocationIds, []);
  assert.strictEqual(audits[0].environmentId, 'env_parker');
  assert.strictEqual(audits[0].productionId, 'video_new');
  assert.strictEqual(usages.length, 1);
  console.log('Phase 11.9.4 resolver audit hardening OK: 12 regression checks passed.');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
