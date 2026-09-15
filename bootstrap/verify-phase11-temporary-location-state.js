'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'temporary-location-state-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.9.5 runtime is not materialized: utils/temporary-location-state-v11.js');

const {
  TEMPORARY_LOCATION_STATE_VERSION,
  TemporaryLocationStateLayerV11,
  extractTemporaryState,
  statePromptFragment,
  normalizedLocationBindings,
  locationForEnvironment,
  zoneForScene,
  mappingForScene
} = require(runtimePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('version is 11.9.5', () => assert.strictEqual(TEMPORARY_LOCATION_STATE_VERSION, '11.9.5'));
check('night is detected', () => assert.strictEqual(extractTemporaryState({ scriptText: 'At night the family returns home.' }).state.timeOfDay, 'night'));
check('Portuguese night is detected', () => assert.strictEqual(extractTemporaryState({ scriptText: 'A noite a familia volta para casa.' }).state.timeOfDay, 'night'));
check('rain is detected', () => assert.strictEqual(extractTemporaryState({ scriptText: 'Rain falls outside.' }).state.weather, 'rain'));
check('storm subsumes rain', () => assert.strictEqual(extractTemporaryState({ scriptText: 'A storm with rain hits the house.' }).state.weather, 'storm'));
check('lights off are detected', () => assert(extractTemporaryState({ scriptText: 'The lights are off.' }).state.lightingStates.includes('lights_off')));
check('TV glow can coexist with lights off', () => {
  const state = extractTemporaryState({ scriptText: 'The lights are off, with only the TV glow.' }).state;
  assert(state.lightingStates.includes('lights_off') && state.lightingStates.includes('tv_glow'));
});
check('Christmas tree is temporary prop', () => assert(extractTemporaryState({ scriptText: 'A Christmas tree stands in the room.' }).state.temporaryProps.includes('christmas_tree')));
check('moving boxes are temporary prop', () => assert(extractTemporaryState({ scriptText: 'Moving boxes are stacked by the wall.' }).state.temporaryProps.includes('moving_boxes')));
check('open door is temporary change', () => assert(extractTemporaryState({ scriptText: 'The front door is open.' }).state.temporaryChanges.includes('door_open')));
check('mess is temporary change', () => assert(extractTemporaryState({ scriptText: 'The room is messy.' }).state.temporaryChanges.includes('messy')));
check('explicit metadata wins time of day', () => assert.strictEqual(extractTemporaryState({ scriptText: 'At night.', temporaryState: { timeOfDay: 'dawn' } }).state.timeOfDay, 'dawn'));
check('explicit temporary props are preserved', () => assert(extractTemporaryState({ temporaryState: { temporaryProps: ['flower vase'] } }).state.temporaryProps.includes('flower vase')));
check('time contradiction is omitted', () => {
  const result = extractTemporaryState({ scriptText: 'The scene transitions from morning to night.' });
  assert.strictEqual(result.state.timeOfDay, null);
  assert(result.conflicts.some(item => item.startsWith('time_of_day_ambiguous:')));
});
check('lights on/off conflict is omitted', () => {
  const result = extractTemporaryState({ scriptText: 'The lights are on and the lights are off.' });
  assert(!result.state.lightingStates.includes('lights_on') && !result.state.lightingStates.includes('lights_off'));
  assert(result.conflicts.includes('lighting_conflict:lights_on|lights_off'));
});
check('door open/closed conflict is omitted', () => {
  const result = extractTemporaryState({ scriptText: 'The door is open and the door is closed.' });
  assert(!result.state.temporaryChanges.includes('door_open') && !result.state.temporaryChanges.includes('door_closed'));
});
check('neutral scene stays neutral', () => assert.strictEqual(extractTemporaryState({ scriptText: 'Tom walks across the familiar living room.' }).active, false));

const sampleLayer = {
  id: 'state_a', locationId: 'location_house', zoneId: 'zone_living_room', status: 'active', timeOfDay: 'night', weather: 'rain',
  lightingStates: ['lights_off', 'tv_glow'], temporaryProps: ['christmas_tree'], temporaryChanges: ['door_open'], conflicts: []
};
check('prompt identifies overlay scope', () => assert(statePromptFragment(sampleLayer).includes('LOCATION ID: location_house')));
check('prompt identifies zone scope', () => assert(statePromptFragment(sampleLayer).includes('ZONE ID: zone_living_room')));
check('prompt forbids canonical mutation', () => assert(statePromptFragment(sampleLayer).includes('must never redefine the canonical location identity')));
check('prompt forbids promotion to Prop Locks', () => assert(statePromptFragment(sampleLayer).includes('do not promote temporary props')));
check('prompt forbids automatic carry to next scene', () => assert(statePromptFragment(sampleLayer).includes('do not carry temporary state into another scene')));

const locations = [{ id: 'location_house', usage: { environmentId: 'env_house' } }];
const zones = [{ id: 'zone_living', locationId: 'location_house', usage: { id: 'zu1', sceneId: 'scene_1', environmentId: 'env_house' } }];
const mappings = [{ id: 'map1', sceneId: 'scene_1', environmentId: 'env_house', status: 'mapped' }];
check('location binding normalization keeps flat location', () => assert.strictEqual(normalizedLocationBindings(locations)[0].location.id, 'location_house'));
check('location is found by environment', () => assert.strictEqual(locationForEnvironment(locations, 'env_house').location.id, 'location_house'));
check('zone is found by scene', () => assert.strictEqual(zoneForScene(zones, 'scene_1').id, 'zone_living'));
check('mapping is found by scene', () => assert.strictEqual(mappingForScene(mappings, 'scene_1').environmentId, 'env_house'));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const promptSource = fs.readFileSync(path.join(upstream, 'utils', 'environment-prompt-enricher-v11.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns reusable_location_state_layers', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS reusable_location_state_layers')));
check('state is unique per production scene', () => assert(dbSource.includes('UNIQUE(production_id, scene_id)')));
check('state layer references reusable location', () => assert(dbSource.includes('FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE CASCADE')));
check('state layer may reference reusable zone', () => assert(dbSource.includes('FOREIGN KEY (zone_id) REFERENCES reusable_location_zones(id) ON DELETE SET NULL')));
check('database persists state layer', () => assert(dbSource.includes('async saveReusableLocationStateLayer(input = {})')));
check('database retrieves scene state layer', () => assert(dbSource.includes('async getReusableLocationStateLayer(productionId, sceneId)')));
check('bundle exposes temporary states', () => assert(dbSource.includes('const reusableLocationStates = await this.listProductionReusableLocationStates(productionId);') && dbSource.includes('reusableLocationStates,')));
check('pipeline imports temporary state runtime', () => assert(pipelineSource.includes("const { TemporaryLocationStateLayerV11 } = require('./temporary-location-state-v11');")));
check('pipeline constructs temporary state service', () => assert(pipelineSource.includes('this.temporaryLocationStates = options.temporaryLocationStates || new TemporaryLocationStateLayerV11')));
check('pipeline builds state before shot planning', () => assert(pipelineSource.indexOf('ensureProductionStates(production, scenes') < pipelineSource.indexOf('this.shotPlanner.planProduction(production, scenes, cartoonBible)')));
check('environment prompt receives state plan', () => assert(pipelineSource.includes('promptMasters, temporaryLocationStatePlan)')));
check('prompt enricher imports state fragment', () => assert(promptSource.includes("const { statePromptFragment } = require('./temporary-location-state-v11');")));
check('prompt enricher maps states by scene', () => assert(promptSource.includes('const temporaryStateByScene = new Map')));
check('temporary state changes shot fingerprint', () => assert(promptSource.includes('temporaryStateFingerprint: temporaryState.stateFingerprint')));
check('dashboard renders temporary state panel', () => assert(dashboardSource.includes('TEMPORARY STATE LAYERS V11.9.5')));
check('temporary states enabled by default', () => assert(envSource.includes('REUSABLE_LOCATION_TEMPORARY_STATES_ENABLED=true')));
check('package exposes temporary state verifier', () => assert.strictEqual(pkg.scripts['test:temporary-location-state'], 'node ../bootstrap/verify-phase11-temporary-location-state.js'));

async function runtimeChecks() {
  const rows = new Map();
  const fakeDb = {
    async saveReusableLocationStateLayer(input) {
      const key = `${input.productionId}:${input.sceneId}`;
      const saved = { ...(rows.get(key) || {}), ...input, createdAt: rows.get(key)?.createdAt || '2026-01-01T00:00:00Z', updatedAt: new Date().toISOString() };
      rows.set(key, saved);
      return { ...saved };
    }
  };
  const service = new TemporaryLocationStateLayerV11(fakeDb, { enabled: true });
  const production = { id: 'prod_a' };
  const scenes = [
    { id: 'scene_1', scriptText: 'At night rain falls outside. The lights are off and the door is open.' },
    { id: 'scene_2', scriptText: 'The familiar living room is unchanged.' }
  ];
  const sceneMappings = [
    { id: 'map1', sceneId: 'scene_1', environmentId: 'env_house', status: 'mapped' },
    { id: 'map2', sceneId: 'scene_2', environmentId: 'env_house', status: 'mapped' }
  ];
  const locationBindings = [{ id: 'location_house', usage: { environmentId: 'env_house' } }];
  const zoneBindings = [
    { id: 'zone_living', locationId: 'location_house', usage: { id: 'zu1', sceneId: 'scene_1', environmentId: 'env_house' } },
    { id: 'zone_living', locationId: 'location_house', usage: { id: 'zu2', sceneId: 'scene_2', environmentId: 'env_house' } }
  ];
  const plan = await service.ensureProductionStates(production, scenes, sceneMappings, locationBindings, zoneBindings);
  check('runtime persists both mapped scenes', () => assert.strictEqual(plan.summary.persisted, 2));
  check('runtime separates active and neutral state', () => {
    assert.strictEqual(plan.summary.activeStates, 1);
    assert.strictEqual(plan.summary.neutralStates, 1);
  });
  check('same canonical location is reused across different state layers', () => assert(plan.states.every(state => state.locationId === 'location_house')));
  check('same canonical zone is reused across different state layers', () => assert(plan.states.every(state => state.zoneId === 'zone_living')));
  check('active and neutral scenes have different state fingerprints', () => assert.notStrictEqual(plan.states[0].stateFingerprint, plan.states[1].stateFingerprint));
  check('active layer owns prompt fragment', () => assert(plan.states[0].promptFragment.includes('TEMPORARY LOCATION STATE V11.9.5')));
  check('neutral layer does not inherit previous rain', () => assert.strictEqual(plan.states[1].weather, null));
  check('neutral layer does not inherit previous open door', () => assert.deepStrictEqual(plan.states[1].temporaryChanges, []));

  const unresolvedPlan = await service.ensureProductionStates({ id: 'prod_b' }, [{ id: 'scene_x', scriptText: 'At night.' }], [{ id: 'mx', sceneId: 'scene_x', environmentId: 'env_missing', status: 'mapped' }], [], []);
  check('missing reusable location is not fabricated', () => assert.strictEqual(unresolvedPlan.summary.persisted, 0));
  check('missing reusable location is audited unresolved', () => assert.strictEqual(unresolvedPlan.unresolved[0].reason, 'reusable_location_unresolved'));

  const disabled = await new TemporaryLocationStateLayerV11(fakeDb, { enabled: false }).ensureProductionStates(production, scenes, sceneMappings, locationBindings, zoneBindings);
  check('disabled layer persists nothing', () => assert.strictEqual(disabled.summary.persisted, 0));
  check('disabled layer reports inactive', () => assert.strictEqual(disabled.active, false));
}

(async () => {
  await runtimeChecks();
  for (const item of checks) await item.fn();
  console.log(`Phase 11.9.5 Temporary Location State OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
