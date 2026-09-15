'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'cross-video-continuity-gate-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.9.6 runtime is not materialized');
const {
  CROSS_VIDEO_CONTINUITY_VERSION,
  CrossVideoContinuityGateV11,
  scoreCrossVideoContinuity,
  canonicalAssetFor,
  semanticDecision,
  temporaryAllowance
} = require(runtimePath);

let count = 0;
const check = (name, fn) => { fn(); count += 1; };
const sig = overrides => ({
  aspect: 16 / 9, rgbMean: [120, 110, 100], luminance: 112,
  grid: Array(48).fill(115), dhash: '10101010'.repeat(8), edgeDensity: 24,
  fingerprint: 'base', ...(overrides || {})
});

check('version', () => assert.strictEqual(CROSS_VIDEO_CONTINUITY_VERSION, '11.9.6'));
check('neutral appearance required', () => assert.strictEqual(temporaryAllowance({ status: 'neutral' }).appearanceRequired, true));
check('active appearance relaxed', () => assert.strictEqual(temporaryAllowance({ status: 'active' }).appearanceRequired, false));
check('temporary clutter relaxes structure slightly', () => assert.strictEqual(temporaryAllowance({ status: 'active', temporaryProps: ['moving_boxes'] }).structureRelaxation, 0.04));
check('identical visual passes', () => assert.strictEqual(scoreCrossVideoContinuity(sig(), sig(), { status: 'neutral' }).accepted, true));
check('night appearance passes when temporary', () => assert.strictEqual(scoreCrossVideoContinuity(sig(), sig({ rgbMean: [20,20,30], luminance: 22 }), { status: 'active', timeOfDay: 'night' }).accepted, true));
check('night appearance can fail when neutral', () => assert.strictEqual(scoreCrossVideoContinuity(sig(), sig({ rgbMean: [0,0,0], luminance: 0 }), { status: 'neutral' }, { appearanceThreshold: 0.7 }).accepted, false));
check('structure drift always fails', () => assert.strictEqual(scoreCrossVideoContinuity(sig(), sig({ aspect: .5, grid: Array(48).fill(250), dhash: '0'.repeat(64), edgeDensity: 1 }), { status: 'active' }).accepted, false));

const locationAsset = { id: 'la', scope: 'location', assetRole: 'location_master', canonical: true, status: 'ready', assetPath: '/loc' };
const zoneAsset = { id: 'za', zoneId: 'zone', scope: 'zone', assetRole: 'zone_reference', canonical: true, status: 'ready', assetPath: '/zone' };
check('zone reference preferred', () => assert.strictEqual(canonicalAssetFor([locationAsset, zoneAsset], 'zone').asset.id, 'za'));
check('zone does not silently fall back', () => assert.strictEqual(canonicalAssetFor([locationAsset], 'zone').asset, null));
check('explicit fallback works', () => assert.strictEqual(canonicalAssetFor([locationAsset], 'zone', { allowLocationFallbackForZone: true }).asset.id, 'la'));
check('whole location uses master', () => assert.strictEqual(canonicalAssetFor([locationAsset], null).asset.id, 'la'));
check('semantic mismatch rejects', () => assert.strictEqual(semanticDecision({ environmentMatches: false }, false).accepted, false));
check('semantic optional missing passes', () => assert.strictEqual(semanticDecision(null, false).accepted, true));
check('semantic required missing rejects', () => assert.strictEqual(semanticDecision(null, true).accepted, false));
check('semantic verified passes', () => assert.strictEqual(semanticDecision({ semanticPropPresenceVerified: true }, true).accepted, true));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const keyframeSource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-keyframe-pipeline-v11.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['db table', dbSource, 'CREATE TABLE IF NOT EXISTS cross_video_continuity_checks'],
  ['db save', dbSource, 'async saveCrossVideoContinuityCheck(input = {})'],
  ['db latest', dbSource, 'async getLatestCrossVideoContinuityCheck(productionId, keyframeId)'],
  ['bundle exposure', dbSource, 'crossVideoContinuityChecks,'],
  ['pipeline import', pipelineSource, "CrossVideoContinuityGateV11 } = require('./cross-video-continuity-gate-v11')"],
  ['pipeline construction', pipelineSource, 'this.crossVideoContinuityGate = options.crossVideoContinuityGate || new CrossVideoContinuityGateV11'],
  ['pipeline injection', pipelineSource, 'crossVideoContinuityGate: this.crossVideoContinuityGate'],
  ['keyframe evaluate', keyframeSource, 'this.crossVideoContinuityGate.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 })'],
  ['failed keyframe status', keyframeSource, "status: 'cross_video_continuity_failed'"],
  ['blocking error code', keyframeSource, "crossVideoError.code = 'CROSS_VIDEO_CONTINUITY_FAILED'"],
  ['dashboard panel', dashboardSource, 'CROSS-VIDEO CONTINUITY GATE V11.9.6'],
  ['env enabled', envSource, 'CROSS_VIDEO_CONTINUITY_ENABLED=true'],
  ['env require asset', envSource, 'CROSS_VIDEO_CONTINUITY_REQUIRE_CANONICAL_ASSET=true'],
  ['env no zone fallback', envSource, 'CROSS_VIDEO_CONTINUITY_ALLOW_LOCATION_FALLBACK_FOR_ZONE=false'],
  ['env structure threshold', envSource, 'CROSS_VIDEO_CONTINUITY_STRUCTURAL_MIN_SCORE=0.44'],
  ['env appearance threshold', envSource, 'CROSS_VIDEO_CONTINUITY_APPEARANCE_MIN_SCORE=0.35'],
  ['env semantic option', envSource, 'CROSS_VIDEO_CONTINUITY_REQUIRE_SEMANTIC=false']
]) check(name, () => assert(source.includes(token)));
check('package script', () => assert.strictEqual(pkg.scripts['test:cross-video-continuity'], 'node ../bootstrap/verify-phase11-cross-video-continuity.js'));

async function runtimeChecks() {
  const location = { id: 'loc', createdFromProductionId: 'origin', reusedAcrossVideos: true };
  const zone = { id: 'zone', locationId: 'loc', usage: { sceneId: 'scene' } };
  let state = { id: 'state', locationId: 'loc', zoneId: 'zone', status: 'active', stateFingerprint: 'night', timeOfDay: 'night' };
  let assets = [{ ...zoneAsset, locationId: 'loc', sourceProductionId: 'origin' }];
  let semantic = { status: 'verified', semanticPropPresenceVerified: true, environmentMatches: true, layoutConsistent: true };
  const saved = [];
  const signatures = new Map([
    ['/zone', sig({ fingerprint: 'ref' })],
    ['/night', sig({ rgbMean: [20,20,30], luminance: 22, fingerprint: 'night' })],
    ['/drift', sig({ aspect: .5, grid: Array(48).fill(250), dhash: '0'.repeat(64), edgeDensity: 1, fingerprint: 'drift' })]
  ]);
  const db = {
    async listProductionReusableLocations() { return [location]; },
    async listProductionReusableLocationZones() { return [zone]; },
    async getReusableLocationStateLayer() { return state; },
    async listReusableLocationAssets() { return assets; },
    async getLatestSemanticPropCheck() { return semantic; },
    async saveCrossVideoContinuityCheck(input) { saved.push(input); return input; }
  };
  const gate = new CrossVideoContinuityGateV11(db, { signatureLoader: async p => signatures.get(p), pathExists: async p => signatures.has(p) });
  const keyframe = { id: 'kf', shotId: 'shot' };
  let result = await gate.evaluate({ productionId: 'new', sceneId: 'scene', keyframe, assetPath: '/night' });
  check('runtime night accepted', () => assert.strictEqual(result.accepted, true));
  check('runtime uses zone anchor', () => assert.strictEqual(result.anchorMode, 'zone_reference'));
  check('runtime state audited', () => assert.strictEqual(saved.at(-1).stateFingerprint, 'night'));
  result = await gate.evaluate({ productionId: 'new', sceneId: 'scene', keyframe, assetPath: '/drift' });
  check('runtime drift blocked', () => assert.strictEqual(result.accepted, false));
  check('runtime drift reason', () => assert(result.reasons.includes('CROSS_VIDEO_STRUCTURE_DRIFT')));
  assets = [];
  result = await gate.evaluate({ productionId: 'new', sceneId: 'scene', keyframe, assetPath: '/night' });
  check('runtime missing anchor blocked', () => assert.strictEqual(result.status, 'canonical_asset_missing'));
  semantic = { status: 'rejected', environmentMatches: false, layoutConsistent: false };
  assets = [{ ...zoneAsset, locationId: 'loc', sourceProductionId: 'origin' }];
  result = await gate.evaluate({ productionId: 'new', sceneId: 'scene', keyframe, assetPath: '/night' });
  check('runtime semantic drift blocked', () => assert.strictEqual(result.accepted, false));
  db.listProductionReusableLocations = async () => [{ ...location, createdFromProductionId: 'origin', reusedAcrossVideos: false }];
  result = await gate.evaluate({ productionId: 'origin', sceneId: 'scene', keyframe, assetPath: '/drift' });
  check('origin production accepted', () => assert.strictEqual(result.status, 'origin_production'));
  db.listProductionReusableLocations = async () => [];
  result = await gate.evaluate({ productionId: 'missing', sceneId: 'scene', keyframe, assetPath: '/night' });
  check('unresolved location blocked', () => assert.strictEqual(result.status, 'location_unresolved'));
  result = await new CrossVideoContinuityGateV11(db, { enabled: false }).evaluate({ productionId: 'missing', sceneId: 'scene', keyframe, assetPath: '/night' });
  check('disabled gate does not block', () => assert.strictEqual(result.accepted, true));
}

runtimeChecks().then(() => console.log(`Phase 11.9.6 Cross-Video Continuity Gate OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
