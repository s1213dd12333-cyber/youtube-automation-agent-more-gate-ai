'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Phase 11.9.5 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.9.5 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'temporary-location-state-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/temporary-location-state-v11.js');
  write('utils/temporary-location-state-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.9.5 production-local temporary state overlays on reusable locations/zones",
    "      `CREATE TABLE IF NOT EXISTS reusable_location_state_layers (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        location_id TEXT NOT NULL,",
    "        zone_id TEXT,",
    "        environment_id TEXT,",
    "        scene_environment_id TEXT,",
    "        zone_usage_id TEXT,",
    "        version TEXT NOT NULL DEFAULT '11.9.5',",
    "        status TEXT NOT NULL DEFAULT 'neutral',",
    "        state_fingerprint TEXT NOT NULL,",
    "        time_of_day TEXT,",
    "        weather TEXT,",
    "        lighting_states TEXT NOT NULL DEFAULT '[]',",
    "        temporary_props TEXT NOT NULL DEFAULT '[]',",
    "        temporary_changes TEXT NOT NULL DEFAULT '[]',",
    "        conflicts TEXT NOT NULL DEFAULT '[]',",
    "        source_kind TEXT NOT NULL DEFAULT 'none',",
    "        confidence REAL NOT NULL DEFAULT 0,",
    "        prompt_fragment TEXT NOT NULL DEFAULT '',",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        UNIQUE(production_id, scene_id),",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (zone_id) REFERENCES reusable_location_zones(id) ON DELETE SET NULL",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_state_layers_prod ON reusable_location_state_layers(production_id, scene_id, status)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_state_layers_location ON reusable_location_state_layers(location_id, zone_id, production_id)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'temporary location state table');

  const methods = [
    "  async saveReusableLocationStateLayer(input = {}) {",
    "    if (!input.productionId || !input.sceneId || !input.locationId || !input.stateFingerprint) return null;",
    "    const existing = await this.getRow('SELECT id, created_at FROM reusable_location_state_layers WHERE production_id = ? AND scene_id = ? LIMIT 1', [input.productionId, input.sceneId]);",
    "    const id = existing?.id || input.id || this.generateId('reusable_location_state');",
    "    const now = new Date().toISOString();",
    "    const createdAt = existing?.created_at || input.createdAt || now;",
    "    await this.executeQuery(",
    "      `INSERT INTO reusable_location_state_layers (",
    "        id, production_id, scene_id, location_id, zone_id, environment_id, scene_environment_id, zone_usage_id, version, status, state_fingerprint,",
    "        time_of_day, weather, lighting_states, temporary_props, temporary_changes, conflicts, source_kind, confidence, prompt_fragment, created_at, updated_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(production_id, scene_id) DO UPDATE SET",
    "        location_id = excluded.location_id, zone_id = excluded.zone_id, environment_id = excluded.environment_id,",
    "        scene_environment_id = excluded.scene_environment_id, zone_usage_id = excluded.zone_usage_id, version = excluded.version, status = excluded.status,",
    "        state_fingerprint = excluded.state_fingerprint, time_of_day = excluded.time_of_day, weather = excluded.weather,",
    "        lighting_states = excluded.lighting_states, temporary_props = excluded.temporary_props, temporary_changes = excluded.temporary_changes,",
    "        conflicts = excluded.conflicts, source_kind = excluded.source_kind, confidence = excluded.confidence, prompt_fragment = excluded.prompt_fragment, updated_at = excluded.updated_at`,",
    "      [id, input.productionId, input.sceneId, input.locationId, input.zoneId || null, input.environmentId || null, input.sceneEnvironmentId || null,",
    "       input.zoneUsageId || null, String(input.version || '11.9.5'), input.status || 'neutral', input.stateFingerprint, input.timeOfDay || null, input.weather || null,",
    "       JSON.stringify(input.lightingStates || []), JSON.stringify(input.temporaryProps || []), JSON.stringify(input.temporaryChanges || []),",
    "       JSON.stringify(input.conflicts || []), input.sourceKind || 'none', Number(input.confidence || 0), input.promptFragment || '', createdAt, now]",
    "    );",
    "    return this.getReusableLocationStateLayer(input.productionId, input.sceneId);",
    "  }",
    "",
    "  async getReusableLocationStateLayer(productionId, sceneId) {",
    "    return this.parseReusableLocationStateLayer(await this.getRow(",
    "      'SELECT * FROM reusable_location_state_layers WHERE production_id = ? AND scene_id = ? LIMIT 1',",
    "      [productionId, sceneId]",
    "    ));",
    "  }",
    "",
    "  async listProductionReusableLocationStates(productionId) {",
    "    const rows = await this.getAllRows('SELECT * FROM reusable_location_state_layers WHERE production_id = ? ORDER BY scene_id, created_at', [productionId]);",
    "    return rows.map(row => this.parseReusableLocationStateLayer(row));",
    "  }",
    "",
    "  parseReusableLocationStateLayer(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, sceneId: row.scene_id, locationId: row.location_id, zoneId: row.zone_id, environmentId: row.environment_id,",
    "      sceneEnvironmentId: row.scene_environment_id, zoneUsageId: row.zone_usage_id, version: row.version || '11.9.5', status: row.status || 'neutral',",
    "      stateFingerprint: row.state_fingerprint, timeOfDay: row.time_of_day, weather: row.weather, lightingStates: JSON.parse(row.lighting_states || '[]'),",
    "      temporaryProps: JSON.parse(row.temporary_props || '[]'), temporaryChanges: JSON.parse(row.temporary_changes || '[]'), conflicts: JSON.parse(row.conflicts || '[]'),",
    "      sourceKind: row.source_kind || 'none', confidence: Number(row.confidence || 0), promptFragment: row.prompt_fragment || '', createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'temporary location state DB methods');

  const loadAnchor = "    const reusableLocationResolutions = await this.listProductionReusableLocationResolutions(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const reusableLocationStates = await this.listProductionReusableLocationStates(productionId);\n", 'load temporary location states in production bundle');
  s = replaceOnce(s, "      reusableLocationResolutions,\n", "      reusableLocationResolutions,\n      reusableLocationStates,\n", 'expose temporary location states in production bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { CanonicalLocationAssetRegistryV11 } = require('./canonical-location-assets-v11');\n",
    "const { CanonicalLocationAssetRegistryV11 } = require('./canonical-location-assets-v11');\nconst { TemporaryLocationStateLayerV11 } = require('./temporary-location-state-v11');\n",
    'Temporary Location State import'
  );
  s = replaceOnce(
    s,
    "    this.canonicalLocationAssets = options.canonicalLocationAssets || new CanonicalLocationAssetRegistryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    "    this.canonicalLocationAssets = options.canonicalLocationAssets || new CanonicalLocationAssetRegistryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n    this.temporaryLocationStates = options.temporaryLocationStates || new TemporaryLocationStateLayerV11(db, { logger: this.logger });\n",
    'Temporary Location State construction'
  );

  const block = [
    "    let temporaryLocationStatePlan = null;",
    "    if (sceneEnvironmentPlan) {",
    "      const stateLocationBindings = reusableLocationPlan?.locations?.map(item => item?.location && item?.usage ? { ...item.location, usage: item.usage } : item).filter(item => item?.id && item?.usage)",
    "        || await this.db.listProductionReusableLocations(production.id);",
    "      const stateZoneBindings = reusableLocationZonePlan?.zones?.map(item => item?.zone && item?.usage ? { ...item.zone, usage: item.usage } : item).filter(item => item?.id && item?.usage)",
    "        || await this.db.listProductionReusableLocationZones(production.id);",
    "      const stateMappings = sceneEnvironmentPlan.mappings || await this.db.listSceneEnvironments(production.id);",
    "      temporaryLocationStatePlan = await this.temporaryLocationStates.ensureProductionStates(production, scenes, stateMappings, stateLocationBindings, stateZoneBindings);",
    "      if (temporaryLocationStatePlan?.active) {",
    "        this.logger.info(`Temporary Location State v11.9.5: active=${temporaryLocationStatePlan.summary.activeStates}, neutral=${temporaryLocationStatePlan.summary.neutralStates}, unresolved=${temporaryLocationStatePlan.unresolved.length}, conflicts=${temporaryLocationStatePlan.summary.conflicts}.`);",
    "      }",
    "    }",
    ""
  ].join('\n');
  s = insertBefore(
    s,
    "    if (cartoonBible) {\n      shotPlan = this.shotPlanner.planProduction(production, scenes, cartoonBible);\n",
    block,
    'build temporary location states after zones and before shot planning'
  );

  s = replaceOnce(
    s,
    "      environmentPromptPlan = this.environmentPromptEnricher.enrichProduction(production, shotPlan, sceneEnvironmentPlan, environmentBible, promptLocks, promptMasters);\n",
    "      environmentPromptPlan = this.environmentPromptEnricher.enrichProduction(production, shotPlan, sceneEnvironmentPlan, environmentBible, promptLocks, promptMasters, temporaryLocationStatePlan);\n",
    'inject temporary state plan into environment prompt enrichment'
  );
  write(rel, s);
}

function patchEnvironmentPromptEnricher() {
  const rel = 'utils/environment-prompt-enricher-v11.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { lockPrompt } = require('./prop-lock-v11');\n",
    "const { lockPrompt } = require('./prop-lock-v11');\nconst { statePromptFragment } = require('./temporary-location-state-v11');\n",
    'temporary state prompt import'
  );
  s = replaceOnce(
    s,
    "  enrichProduction(production = {}, shotPlan = null, sceneEnvironmentPlan = null, environmentBible = null, propLocks = [], masterFrames = []) {\n",
    "  enrichProduction(production = {}, shotPlan = null, sceneEnvironmentPlan = null, environmentBible = null, propLocks = [], masterFrames = [], temporaryStatePlan = null) {\n",
    'temporary state plan parameter'
  );
  s = replaceOnce(
    s,
    "    const mappingByScene = new Map((sceneEnvironmentPlan.mappings || []).map(item => [item.sceneId, item]));\n    const shots = shotPlan.shots.map(shot => {\n",
    "    const mappingByScene = new Map((sceneEnvironmentPlan.mappings || []).map(item => [item.sceneId, item]));\n    const temporaryStateByScene = new Map((temporaryStatePlan?.states || []).map(item => [item.sceneId, item]));\n    const shots = shotPlan.shots.map(shot => {\n",
    'map temporary states by scene'
  );
  s = replaceOnce(
    s,
    "      const masterFrame = masterFor(masterFrames, mapping?.environmentId || null);\n      return enrichShot(shot, mapping, environment, locks, masterFrame);\n",
    "      const masterFrame = masterFor(masterFrames, mapping?.environmentId || null);\n      const enriched = enrichShot(shot, mapping, environment, locks, masterFrame);\n      const temporaryState = temporaryStateByScene.get(shot.sceneId) || null;\n      const temporaryFragment = statePromptFragment(temporaryState);\n      if (!temporaryFragment) return enriched;\n      const prompt = `${enriched.prompt}\\n\\n${temporaryFragment}`.slice(0, 32000);\n      const continuityNotes = [\n        ...(Array.isArray(enriched.continuityNotes) ? enriched.continuityNotes : []),\n        temporaryState.status === 'active' ? `apply Temporary Location State ${temporaryState.id} without changing canonical location identity` : 'temporary location state neutral: do not invent transient changes'\n      ];\n      const fingerprint = hash(JSON.stringify({ baseFingerprint: enriched.fingerprint || null, prompt, continuityNotes, temporaryStateFingerprint: temporaryState.stateFingerprint }));\n      return {\n        ...enriched, prompt, continuityNotes, fingerprint,\n        temporaryLocationStateId: temporaryState.id,\n        temporaryLocationStateFingerprint: temporaryState.stateFingerprint,\n        temporaryLocationStateStatus: temporaryState.status,\n        temporaryLocationStateVersion: temporaryState.version || '11.9.5'\n      };\n",
    'overlay temporary state onto enriched shots'
  );
  s = replaceOnce(
    s,
    "      environments: shots.map(shot => ({ id: shot.id, fingerprint: shot.environmentPromptFingerprint }))\n",
    "      environments: shots.map(shot => ({ id: shot.id, fingerprint: shot.environmentPromptFingerprint })),\n      temporaryStates: shots.map(shot => ({ id: shot.id, fingerprint: shot.temporaryLocationStateFingerprint || null }))\n",
    'temporary state participation in enrichment fingerprint'
  );
  s = replaceOnce(
    s,
    "        requiredPropReferences: shots.reduce((sum, shot) => sum + (shot.requiredPropLockIds || []).length, 0)\n",
    "        requiredPropReferences: shots.reduce((sum, shot) => sum + (shot.requiredPropLockIds || []).length, 0),\n        temporaryStateShotCount: shots.filter(shot => Boolean(shot.temporaryLocationStateId)).length,\n        activeTemporaryStateShotCount: shots.filter(shot => shot.temporaryLocationStateStatus === 'active').length\n",
    'temporary state enrichment summary'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderTemporaryLocationStates(item) {",
    "  if (!Array.isArray(item?.reusableLocationStates) || !item.reusableLocationStates.length) return '';",
    "  const active = item.reusableLocationStates.filter(state => state.status === 'active').length;",
    "  const conflicts = item.reusableLocationStates.reduce((sum, state) => sum + (state.conflicts || []).length, 0);",
    "  const cards = item.reusableLocationStates.map(state => {",
    "    const temporary = [state.timeOfDay, state.weather, ...(state.lightingStates || []), ...(state.temporaryProps || []), ...(state.temporaryChanges || [])].filter(Boolean);",
    "    const scope = `${state.locationId}${state.zoneId ? ` / ${state.zoneId}` : ''}`;",
    "    return `<div class=\"quality-check ${state.status === 'active' ? 'pass' : ''}\"><strong>${escapeHTML(state.sceneId)} · ${escapeHTML(state.status || 'neutral')}</strong><br><small>${escapeHTML(scope)}<br>${escapeHTML(temporary.join(' · ') || 'no temporary state specified')}<br>${(state.conflicts || []).length ? `conflicts omitted: ${escapeHTML((state.conflicts || []).join(' | '))}` : `state: ${escapeHTML((state.stateFingerprint || '').slice(0, 16))}`}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel temporary-location-state-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">TEMPORARY STATE LAYERS V11.9.5</p><h3>Scene-only location overlays</h3></div></div><p>${active}/${item.reusableLocationStates.length} scene(s) have explicit temporary state · ${conflicts} conflicting cue(s) omitted. These overlays never alter canonical location, zone, Prop Lock, or asset identity.</p><div class=\"quality-grid\">${cards}</div></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Temporary Location State dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderCanonicalLocationAssets(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderCanonicalLocationAssets(item)}\n        ${renderTemporaryLocationStates(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show temporary states after canonical assets'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:temporary-location-state'] = 'node ../bootstrap/verify-phase11-temporary-location-state.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('REUSABLE_LOCATION_TEMPORARY_STATES_ENABLED=')) {
    env += `\n# Phase 11.9.5 — scene-only overlays such as time, weather, lighting, decorations and open/closed state.\nREUSABLE_LOCATION_TEMPORARY_STATES_ENABLED=true\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchEnvironmentPromptEnricher();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.9.5 ativa: Temporary State Layers por cena sobre locationId + zoneId, sem contaminar identidade/asset canonico e com conflitos fail-closed.');
