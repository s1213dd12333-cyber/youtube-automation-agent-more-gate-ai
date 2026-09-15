'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'cross-video-continuity-gate-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.9.6 runtime is not materialized: utils/cross-video-continuity-gate-v11.js');

const {
  CROSS_VIDEO_CONTINUITY_VERSION,
  CrossVideoContinuityGateV11,
  scoreCrossVideoContinuity,
  canonicalAssetFor,
  semanticDecision,
  temporaryAllowance,
  weightedScore
} = require(runtimePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const signature = overrides => ({
  aspect: 16 / 9,
  rgbMean: [120, 110, 100],
  luminance: 112,
  grid: Array(48).fill(115),
  dhash: '10101010'.repeat(8),
  edgeDensity: 24,
  fingerprint: 'sig-base',
  ...(overrides || {})
});

check('version is 11.9.6', () => assert.strictEqual(CROSS_VIDEO_CONTINUITY_VERSION, '11.9.6'));
check('weighted score clamps values', () => assert.strictEqual(weightedScore({ a: 2, b: -1 }, { a: 1, b: 1 }), 0.5));
check('neutral state requires appearance', () => assert.strictEqual(temporaryAllowance({ status: 'neutral' }).appearanceRequired, true));
check('active temporary state relaxes appearance', () => assert.strictEqual(temporaryAllowance({ status: 'active' }).appearanceRequired, false));
check('temporary props relax structure only slightly', () => assert.strictEqual(temporaryAllowance({ status: 'active', temporaryProps: ['moving_boxes'] }).structureRelaxation, 0.04));

check('identical signatures pass neutral gate', () => {
  const result = scoreCrossVideoContinuity(signature(), signature(), { status: 'neutral' });
  assert.strictEqual(result.accepted, true);
  assert(result.structuralScore > 0.99);
  assert(result.appearanceScore > 0.99);
});
check('night palette/luminance drift can pass with active temporary state', () => {
  const dark = signature({ rgbMean: [35, 35, 45], luminance: 36, fingerprint: 'dark' });
  const result = scoreCrossVideoContinuity(signature(), dark, { status: 'active', timeOfDay: 'night', lightingStates: ['lights_off'] });
  assert.strictEqual(result.appearanceRequired, false);
  assert.strictEqual(result.accepted, true);
});
check('same appearance drift fails when state is neutral', () => {
  const dark = signature({ rgbMean: [0, 0, 0], luminance: 0, fingerprint: 'dark' });
  const result = scoreCrossVideoContinuity(signature(), dark, { status: 'neutral' }, { appearanceThreshold: 0.7 });
  assert.strictEqual(result.accepted, false);
  assert(result.reasons.includes('CROSS_VIDEO_APPEARANCE_DRIFT'));
});
check('structural drift fails even with temporary state active', () => {
  const drift = signature({ aspect: 0.5, grid: Array(48).fill(250), dhash: '0'.repeat(64), edgeDensity: 2, fingerprint: 'drift' });
  const result = scoreCrossVideoContinuity(signature(), drift, { status: 'active', weather: 'rain' });
  assert.strictEqual(result.accepted, false);
  assert(result.reasons.includes('CROSS_VIDEO_STRUCTURE_DRIFT'));
});

const locationAsset = { id: 'asset_location', locationId: 'loc', zoneId: null, scope: 'location', assetRole: 'location_master', canonical: true, status: 'ready', assetPath: '/loc.png' };
const zoneAsset = { id: 'asset_zone', locationId: 'loc', zoneId: 'zone_living', scope: 'zone', assetRole: 'zone_reference', canonical: true, status: 'ready', assetPath: '/zone.png' };
check('zone scene selects zone_reference', () => assert.strictEqual(canonicalAssetFor([locationAsset, zoneAsset], 'zone_living').asset.id, 'asset_zone'));
check('zone scene does not silently fall back to whole-location master', () => assert.strictEqual(canonicalAssetFor([locationAsset], 'zone_living').asset, null));
check('zone fallback can be explicitly enabled', () => assert.strictEqual(canonicalAssetFor([locationAsset], 'zone_living', { allowLocationFallbackForZone: true }).asset.id, 'asset_location'));
check('whole location selects location master', () => assert.strictEqual(canonicalAssetFor([locationAsset, zoneAsset], null).asset.id, 'asset_location'));
check('explicit semantic mismatch always rejects', () => assert.strictEqual(semanticDecision({ environmentMatches: false }, false).accepted, false));
check('semantic missing is allowed when optional', () => assert.strictEqual(semanticDecision(null, false).accepted, true));
check('semantic missing rejects in strict mode', () => assert.strictEqual(semanticDecision(null, true).accepted, false));
check('verified semantic passes strict mode', () => assert.strictEqual(semanticDecision({ semanticPropPresenceVerified: true }, true).accepted, true));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const keyframeSource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-keyframe-pipeline-v11.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns cross_video_continuity_checks', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS cross_video_continuity_checks')));
check('cross-video checks reference reusable locations', () => assert(dbSource.includes('FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE SET NULL')));
check('cross-video checks reference reusable zones', () => assert(dbSource.includes('FOREIGN KEY (zone_id) REFERENCES reusable_location_zones(id) ON DELETE SET NULL')));
check('cross-video checks reference canonical assets', () => assert(dbSource.includes('FOREIGN KEY (canonical_asset_id) REFERENCES reusable_location_assets(id) ON DELETE SET NULL')));
check('database persists cross-video check', () => assert(dbSource.includes('async saveCrossVideoContinuityCheck(input = {})')));
check('database loads latest cross-video check', () => assert(dbSource.includes('async getLatestCrossVideoContinuityCheck(productionId, keyframeId)')));
check('production bundle exposes crossVideoContinuityChecks', () => assert(dbSource.includes('const crossVideoContinuityChecks = await this.listCrossVideoContinuityChecks(productionId);') && dbSource.includes('crossVideoContinuityChecks,')));
check('scene pipeline imports cross-video gate', () => assert(pipelineSource.includes("const { CrossVideoContinuityGateV11 } = require('./cross-video-continuity-gate-v11');")));
check('scene pipeline constructs cross-video gate', () => assert(pipelineSource.includes('this.crossVideoContinuityGate = options.crossVideoContinuityGate || new CrossVideoContinuityGateV11')));
check('keyframe pipeline receives cross-video gate', () => assert(pipelineSource.includes('crossVideoContinuityGate: this.crossVideoContinuityGate')));
check('keyframe runtime invokes cross-video gate', () => assert(keyframeSource.includes('this.crossVideoContinuityGate.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 })')));
check('cross-video gate executes before ready status', () => assert(keyframeSource.indexOf('this.crossVideoContinuityGate.evaluate(') < keyframeSource.indexOf("status: 'ready'")));
check('failed cross-video keyframe has dedicated status', () => assert(keyframeSource.includes("status: 'cross_video_continuity_failed'")));
check('failed cross-video keyframe throws blocking error', () => assert(keyframeSource.includes("crossVideoError.code = 'CROSS_VIDEO_CONTINUITY_FAILED'")));
check('dashboard renders Phase 11.9.6 panel', () => assert(dashboardSource.includes('CROSS-VIDEO CONTINUITY GATE V11.9.6')));
check('cross-video gate enabled by default', () => assert(envSource.includes('CROSS_VIDEO_CONTINUITY_ENABLED=true')));
check('canonical asset required by default', () => assert(envSource.includes('CROSS_VIDEO_CONTINUITY_REQUIRE_CANONICAL_ASSET=true')));
check('zone fallback disabled by default', () => assert(envSource.includes('CROSS_VIDEO_CONTINUITY_ALLOW_LOCATION_FALLBACK_FOR_ZONE=false')));
check('structural threshold is configured', () => assert(envSource.includes('CROSS_VIDEO_CONTINUITY_STRUCTURAL_MIN_SCORE=0.44')));
check('appearance threshold is configured', () => assert(envSource.includes('CROSS_VIDEO_CONTINUITY_APPEARANCE_MIN_SCORE=0.35')));
check('semantic strict override exists', () => assert(envSource.includes('CROSS_VIDEO_CONTINUITY_REQUIRE_SEMANTIC=false')));
check('package exposes cross-video verifier', () => assert.strictEqual(pkg.scripts['test:cross-video-continuity'], 'node ../bootstrap/verify-phase11-cross-video-continuity.js'));
check('runtime inherits global semantic fail-closed mode', () => assert(fs.readFileSync(runtimePath, 'utf8').includes('localSemantic || globalSemantic')));
check('runtime requires zone reference for zoned scenes', () => assert(fs.readFileSync(runtimePath, 'utf8').includes("mode: 'zone_reference_missing'")));
check('runtime recognizes reusedAcrossVideos', () => assert(fs.readFileSync(runtimePath, 'utf8').includes('context.location.createdFromProductionId !== productionId')));

async function runtimeChecks() {
  const rows = [];
  const location = { id: 'loc_miller', createdFromProductionId: 'prod_origin', reusedAcrossVideos: true };
  const zone = { id: 'zone_living', locationId: location.id, usage: { sceneId: 'scene_1' } };
  const stateNeutral = { id: 'state_1', sceneId: 'scene_1', locationId: location.id, zoneId: zone.id, status: 'neutral', stateFingerprint: 'state-neutral' };
  const stateNight = { ...stateNeutral, status: 'active', stateFingerprint: 'state-night', timeOfDay: 'night', lightingStates: ['lights_off'] };
  const asset = { ...zoneAsset, locationId: location.id, assetPath: '/canonical-zone.png', assetSha256: 'sha-zone', sourceProductionId: 'prod_origin' };
  let currentState = stateNeutral;
  let currentAssets = [asset, { ...locationAsset, locationId: location.id, assetPath: '/canonical-location.png' }];
  let semantic = { status: 'verified', semanticPropPresenceVerified: true, environmentMatches: true, layoutConsistent: true };
  const signatureMap = new Map([
    ['/canonical-zone.png', signature({ fingerprint: 'ref-zone' })],
    ['/candidate-same.png', signature({ fingerprint: 'candidate-same' })],
    ['/candidate-night.png', signature({ rgbMean: [25, 25, 35], luminance: 28, fingerprint: 'candidate-night' })],
    ['/candidate-drift.png', signature({ aspect: 0.5, grid: Array(48).fill(250), dhash: '0'.repeat(64), edgeDensity: 1, fingerprint: 'candidate-drift' })]
  ]);
  const fakeDb = {
    async listProductionReusableLocations() { return [location]; },
    async listProductionReusableLocationZones() { return [zone]; },
    async getReusableLocationStateLayer() { return currentState; },
    async listReusableLocationAssets() { return currentAssets; },
    async getLatestSemanticPropCheck() { return semantic; },
    async saveCrossVideoContinuityCheck(input) { rows.push({ ...input }); return { ...input }; }
  };
  const gate = new CrossVideoContinuityGateV11(fakeDb, {
    enabled: true,
    requireCanonicalAsset: true,
    signatureLoader: async filePath => signatureMap.get(filePath),
    pathExists: async filePath => signatureMap.has(filePath)
  });
  const keyframe = { id: 'kf_1', shotId: 'shot_1' };

  let result = await gate.evaluate({ productionId: 'prod_new', sceneId: 'scene_1', keyframe, assetPath: '/candidate-same.png' });
  check('reused zone with same structure is accepted', () => assert.strictEqual(result.accepted, true));
  check('reused zone uses zone_reference anchor', () => assert.strictEqual(result.anchorMode, 'zone_reference'));
  check('accepted cross-video decision is persisted', () => assert.strictEqual(rows.at(-1).accepted, true));
  check('canonical source production is persisted', () => assert.strictEqual(rows.at(-1).canonicalSourceProductionId, 'prod_origin'));

  currentState = stateNight;
  result = await gate.evaluate({ productionId: 'prod_new', sceneId: 'scene_1', keyframe, assetPath: '/candidate-night.png' });
  check('night appearance change is accepted when structure persists', () => assert.strictEqual(result.accepted, true));
  check('night state disables appearance requirement', () => assert.strictEqual(result.appearanceRequired, false));
  check('night state fingerprint is audited', () => assert.strictEqual(rows.at(-1).stateFingerprint, 'state-night'));

  result = await gate.evaluate({ productionId: 'prod_new', sceneId: 'scene_1', keyframe, assetPath: '/candidate-drift.png' });
  check('structural drift blocks reused zone', () => assert.strictEqual(result.accepted, false));
  check('structural drift emits reason', () => assert(result.reasons.includes('CROSS_VIDEO_STRUCTURE_DRIFT')));

  currentAssets = [{ ...locationAsset, locationId: location.id, assetPath: '/canonical-location.png' }];
  result = await gate.evaluate({ productionId: 'prod_new', sceneId: 'scene_1', keyframe, assetPath: '/candidate-same.png' });
  check('missing zone_reference blocks by default', () => assert.strictEqual(result.status, 'canonical_asset_missing'));
  check('missing zone_reference is fail closed', () => assert.strictEqual(result.accepted, false));
  check('missing zone reference reason is explicit', () => assert(result.reasons.includes('CROSS_VIDEO_ZONE_REFERENCE_MISSING'));

  currentAssets = [asset];
  semantic = { status: 'rejected', semanticPropPresenceVerified: false, environmentMatches: false, layoutConsistent: false };
  result = await gate.evaluate({ productionId: 'prod_new', sceneId: 'scene_1', keyframe, assetPath: '/candidate-same.png' });
  check('explicit semantic drift blocks even when semantic is optional', () => assert.strictEqual(result.accepted, false));
  check('semantic drift reason is explicit', () => assert(result.reasons.includes('CROSS_VIDEO_SEMANTIC_DRIFT'));

  const originLocation = { ...location, createdFromProductionId: 'prod_origin', reusedAcrossVideos: false };
  fakeDb.listProductionReusableLocations = async () => [originLocation];
  semantic = null;
  result = await gate.evaluate({ productionId: 'prod_origin', sceneId: 'scene_1', keyframe, assetPath: '/candidate-drift.png' });
  check('origin production is not treated as cross-video reuse', () => assert.strictEqual(result.status, 'origin_production'));
  check('origin production skip is accepted', () => assert.strictEqual(result.accepted, true));

  fakeDb.listProductionReusableLocations = async () => [];
  result = await gate.evaluate({ productionId: 'prod_missing', sceneId: 'scene_1', keyframe, assetPath: '/candidate-same.png' });
  check('unresolved location fails closed', () => assert.strictEqual(result.accepted, false));
  check('unresolved location reason is explicit', () => assert(result.reasons.includes('CROSS_VIDEO_LOCATION_UNRESOLVED'));

  const disabled = new CrossVideoContinuityGateV11(fakeDb, { enabled: false });
  result = await disabled.evaluate({ productionId: 'prod_missing', sceneId: 'scene_1', keyframe, assetPath: '/candidate-same.png' });
  check('disabled gate reports inactive', () => assert.strictEqual(result.active, false));
  check('disabled gate does not block', () => assert.strictEqual(result.accepted, true));
}

(async () => {
  await runtimeChecks();
  for (const item of checks) await item.fn();
  console.log(`Phase 11.9.6 Cross-Video Continuity Gate OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
