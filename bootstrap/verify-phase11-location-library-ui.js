'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'location-library-manager-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.9.7 runtime is not materialized');
const {
  LOCATION_LIBRARY_MANAGER_VERSION,
  LocationLibraryManagerV11,
  scoreCandidate,
  rankLocations,
  jaccard,
  canonicalReady
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

const millerIdentity = { category: 'house', name: 'Miller House', construction: 'timber frame', architecturalStyle: 'craftsman', materials: ['wood', 'brick'], palette: ['cream', 'forest green'], layout: 'living room connected to hall with central staircase', signatureElements: ['brick fireplace', 'central staircase'], requiredProps: [{ name: 'green sofa' }, { name: 'oak coffee table' }] };
const miller = { id: 'loc_miller', namespace: 'default', displayName: 'Miller House', locationKey: 'miller_house', locationType: 'house', status: 'canonical_ready', canonicalMasterFramePath: '/canonical/miller.png', canonicalIdentity: millerIdentity, createdFromProductionId: 'prod_origin' };
const parker = { id: 'loc_parker', namespace: 'default', displayName: 'Parker House', locationKey: 'parker_house', locationType: 'house', status: 'canonical_ready', canonicalIdentity: { category: 'house', name: 'Parker House', construction: 'concrete', architecturalStyle: 'modernist', materials: ['concrete', 'glass'], palette: ['white', 'gray'], layout: 'open plan single level', signatureElements: ['glass wall', 'floating stairs'], requiredProps: [{ name: 'black sectional' }] }, createdFromProductionId: 'prod_other' };

check('version is 11.9.7', () => assert.strictEqual(LOCATION_LIBRARY_MANAGER_VERSION, '11.9.7'));
check('jaccard exact is one', () => assert.strictEqual(jaccard(['a', 'b'], ['a', 'b']), 1));
check('jaccard partial is bounded', () => assert(jaccard(['a', 'b'], ['b', 'c']) > 0 && jaccard(['a', 'b'], ['b', 'c']) < 1));
check('canonical ready recognizes status', () => assert.strictEqual(canonicalReady(miller), true));
check('matching candidate scores high', () => assert(scoreCandidate(millerIdentity, miller, 'dwelling').score > 0.99));
check('wrong house scores low', () => assert(scoreCandidate(millerIdentity, parker, 'dwelling').score < 0.3));
check('ranking puts Miller first', () => assert.strictEqual(rankLocations(millerIdentity, [parker, miller], 'dwelling')[0].location.id, 'loc_miller'));
check('type mismatch is ineligible', () => assert.strictEqual(scoreCandidate(millerIdentity, { ...miller, locationType: 'school' }, 'dwelling').eligible, false));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const reusableSource = fs.readFileSync(path.join(upstream, 'utils', 'reusable-location-library-v11.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(upstream, 'dashboard', 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const browserSource = fs.readFileSync(path.join(upstream, 'dashboard', 'location-library-v11.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(upstream, 'dashboard', 'location-library-v11.css'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('DB owns auto selection table', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS reusable_location_auto_selections')));
check('DB makes selection unique per production environment', () => assert(dbSource.includes('UNIQUE(production_id, environment_id)')));
check('DB persists auto selection', () => assert(dbSource.includes('async saveReusableLocationAutoSelection(input = {})')));
check('DB lists auto selections', () => assert(dbSource.includes("async listReusableLocationAutoSelections(namespace = 'default', limit = 100)")));
check('DB exposes asset lookup by id', () => assert(dbSource.includes('async getReusableLocationAsset(id)')));
check('Reusable Library imports manager', () => assert(reusableSource.includes("const { LocationLibraryManagerV11 } = require('./location-library-manager-v11');")));
check('Reusable Library constructs manager', () => assert(reusableSource.includes('this.locationLibraryManager = options.locationLibraryManager || new LocationLibraryManagerV11')));
check('Auto selection executes only after resolver', () => assert(reusableSource.indexOf('this.locationResolver.resolveEnvironment') < reusableSource.indexOf('this.locationLibraryManager.autoSelectEnvironment')));
check('Auto selection ambiguity fails closed', () => assert(reusableSource.includes("matchMode: 'library_auto_select_ambiguous'")));
check('Auto selection reuse mode is persisted', () => assert(reusableSource.includes("? 'library_auto_select' : 'identity_fingerprint_exact_register'")));
check('Library summary reports autoSelected', () => assert(reusableSource.includes('autoSelected: locations.filter')));

check('Index imports location library manager', () => assert(indexSource.includes("const { LocationLibraryManagerV11 } = require('./utils/location-library-manager-v11');")));
check('Index initializes location library manager after DB', () => assert(indexSource.includes('this.locationLibrary = new LocationLibraryManagerV11(this.db')));
check('Index exposes location library API', () => assert(indexSource.includes("this.app.get('/api/location-library'")));
check('Index exposes auto select preview API', () => assert(indexSource.includes("this.app.post('/api/location-library/auto-select/preview', protect")));
check('Index exposes canonical asset API', () => assert(indexSource.includes("this.app.get('/api/location-library/assets/:assetId'")));
check('Asset API restricts files to location-library root', () => assert(indexSource.includes("path.resolve(__dirname, 'data', 'assets', 'location-library')") && indexSource.includes('path.relative(libraryRoot, resolved)')));
check('Asset API serves only canonical ready assets', () => assert(indexSource.includes("asset.status !== 'ready' || asset.canonical !== true")));
check('Index exposes location detail API', () => assert(indexSource.includes("this.app.get('/api/location-library/:locationId'")));
check('Asset route is declared before generic location route', () => assert(indexSource.indexOf('/api/location-library/assets/:assetId') < indexSource.indexOf('/api/location-library/:locationId')));

check('Dashboard has Location library navigation', () => assert(htmlSource.includes('data-view="locations"') && htmlSource.includes('Location library')));
check('Dashboard has locations view', () => assert(htmlSource.includes('id="locations-view"')));
check('Dashboard has search control', () => assert(htmlSource.includes('id="location-library-search"')));
check('Dashboard has status filter', () => assert(htmlSource.includes('id="location-library-status"')));
check('Dashboard has type filter', () => assert(htmlSource.includes('id="location-library-type"')));
check('Dashboard has recent auto selection panel', () => assert(htmlSource.includes('AUTO SELECTION V11.9.7')));
check('Dashboard loads Location Library browser runtime', () => assert(htmlSource.includes('/location-library-v11.js')));
check('Dashboard loads Location Library stylesheet', () => assert(htmlSource.includes('/location-library-v11.css')));
check('Dashboard browser runtime has loader', () => assert(browserSource.includes('async function loadLibrary(silent = false)')));
check('Dashboard browser runtime has renderer', () => assert(browserSource.includes('function render()')));
check('Dashboard browser runtime has detail loader', () => assert(browserSource.includes('async function openDetail(locationId')));
check('Dashboard browser runtime lazy-loads locations nav', () => assert(browserSource.includes('[data-view="locations"]')));
check('Dashboard title map includes Location Library', () => assert(appSource.includes("locations: ['LOCATION LIBRARY'")));
check('Dashboard CSS has location library layout', () => assert(cssSource.includes('.location-library-layout')));
check('Dashboard CSS has responsive rule', () => assert(cssSource.includes('@media(max-width:900px)')));

check('Auto selection enabled by default', () => assert(envSource.includes('REUSABLE_LOCATION_AUTO_SELECTION_ENABLED=true')));
check('Auto selection minimum score configured', () => assert(envSource.includes('REUSABLE_LOCATION_AUTO_SELECTION_MIN_SCORE=0.78')));
check('Auto selection minimum margin configured', () => assert(envSource.includes('REUSABLE_LOCATION_AUTO_SELECTION_MIN_MARGIN=0.12')));
check('Auto selection evidence dimension minimum configured', () => assert(envSource.includes('REUSABLE_LOCATION_AUTO_SELECTION_MIN_EVIDENCE_DIMENSIONS=3')));
check('Package exposes 11.9.7 verifier', () => assert.strictEqual(pkg.scripts['test:location-library-ui'], 'node ../bootstrap/verify-phase11-location-library-ui.js'));

async function runtimeChecks() {
  const selections = [], resolutions = [];
  const zones = [{ id: 'zone_living', locationId: miller.id, zoneKey: 'living_room', displayName: 'Living Room' }];
  const assets = [{ id: 'asset_master', locationId: miller.id, zoneId: null, scope: 'location', assetRole: 'location_master', canonical: true, status: 'ready', assetPath: '/data/assets/location-library/default/loc_miller/master.png' }];
  const aliases = [{ locationId: miller.id, aliasText: 'Miller home', aliasKey: 'miller home' }];
  const usages = [{ locationId: miller.id, productionId: 'prod_origin', environmentId: 'env_1', matchMode: 'identity_fingerprint_exact_register' }, { locationId: miller.id, productionId: 'prod_second', environmentId: 'env_2', matchMode: 'alias_exact' }];
  let locations = [miller, parker];
  const fakeDb = {
    async listReusableLocations() { return locations; },
    async saveReusableLocationAutoSelection(input) { selections.push({ ...input }); return { ...input }; },
    async saveReusableLocationResolution(input) { resolutions.push({ ...input }); return { ...input }; },
    async getReusableLocation(id) { return locations.find(item => item.id === id) || null; },
    async listReusableLocationZones(id) { return id === miller.id ? zones : []; },
    async listReusableLocationAssets(id) { return id === miller.id ? assets : []; },
    async listReusableLocationAliases(id) { return id === miller.id ? aliases : []; },
    async listReusableLocationUsages(id) { return id === miller.id ? usages : []; },
    async listReusableLocationAutoSelections() { return selections; }
  };
  const manager = new LocationLibraryManagerV11(fakeDb, { enabled: true, minScore: 0.75, minMargin: 0.10, minEvidenceDimensions: 3 });
  const genericEnvironment = { environmentId: 'env_new', name: 'their house', category: 'house' };
  const approximateIdentity = { ...millerIdentity, name: 'their house', palette: ['cream', 'forest green', 'warm wood'] };
  let result = await manager.autoSelectEnvironment({ namespace: 'default', production: { id: 'prod_new' }, environment: genericEnvironment, identity: approximateIdentity, identityFingerprint: 'incoming_fp' });
  check('generic high confidence environment resolves', () => assert.strictEqual(result.status, 'resolved'));
  check('generic high confidence selects Miller', () => assert.strictEqual(result.location.id, miller.id));
  check('generic high confidence uses library_auto_select', () => assert.strictEqual(result.matchMode, 'library_auto_select'));
  check('resolved decision is audited', () => assert.strictEqual(selections.at(-1).selectedLocationId, miller.id));
  check('resolved decision updates resolver audit', () => assert.strictEqual(resolutions.at(-1).matchMode, 'library_auto_select'));

  result = await manager.autoSelectEnvironment({ namespace: 'default', production: { id: 'prod_explicit' }, environment: { environmentId: 'env_explicit', name: 'Jones House', category: 'house' }, identity: approximateIdentity });
  check('explicit named reference is not auto-selected', () => assert.strictEqual(result.status, 'unresolved'));
  check('explicit named reference has safety reason', () => assert.strictEqual(result.reason, 'explicit_reference_requires_exact_resolver_match'));

  const twin = { ...miller, id: 'loc_twin', displayName: 'Another family home' }; locations = [miller, twin];
  result = await manager.autoSelectEnvironment({ namespace: 'default', production: { id: 'prod_amb' }, environment: { environmentId: 'env_amb', name: 'their house', category: 'house' }, identity: approximateIdentity });
  check('tied candidates are ambiguous', () => assert.strictEqual(result.status, 'ambiguous'));
  check('ambiguous selection does not pick a location', () => assert.strictEqual(result.location, null));
  check('ambiguous decision records runner up', () => assert(result.runnerUpScore >= manager.minScore));

  locations = [miller, parker];
  result = await manager.autoSelectEnvironment({ namespace: 'default', production: { id: 'prod_low' }, environment: { environmentId: 'env_low', name: 'their house', category: 'house' }, identity: { category: 'house', construction: 'timber frame' } });
  check('low evidence remains unresolved', () => assert.strictEqual(result.status, 'unresolved'));
  check('low evidence reason is explicit', () => assert.strictEqual(result.reason, 'insufficient_stable_evidence'));

  const detail = await manager.detail(miller.id);
  check('detail exposes aliases', () => assert.strictEqual(detail.aliases.length, 1));
  check('detail exposes zones', () => assert.strictEqual(detail.zones.length, 1));
  check('detail exposes canonical asset URL', () => assert.strictEqual(detail.assets[0].assetUrl, '/api/location-library/assets/asset_master'));
  check('detail counts cross-video productions', () => assert.strictEqual(detail.crossVideoUsageCount, 2));
  const snapshot = await manager.getSnapshot('default');
  check('snapshot contains enriched locations', () => assert(snapshot.locations.some(item => item.id === miller.id)));
  check('snapshot counts cross-video locations', () => assert.strictEqual(snapshot.summary.crossVideoLocations, 1));
  check('snapshot exposes auto-selection history', () => assert(snapshot.selections.length >= 3));
  result = await new LocationLibraryManagerV11(fakeDb, { enabled: false }).autoSelectEnvironment({ namespace: 'default', environment: genericEnvironment, identity: approximateIdentity });
  check('disabled selector reports inactive', () => assert.strictEqual(result.active, false));
  check('disabled selector does not select', () => assert.strictEqual(result.location, null));
}

runtimeChecks().then(() => console.log(`Phase 11.9.7 Location Library UI + Auto Selection OK: ${count} regression checks passed.`)).catch(error => { console.error(error.stack || error.message || error); process.exit(1); });
