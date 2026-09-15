'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');

// Repair older materialized 11.7.1 runtimes before loading the module.
require('./fix-phase11-environment-bible-signatures.js');

const runtimePath = path.join(upstream, 'utils', 'environment-bible-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.7.1 runtime is not materialized: utils/environment-bible-v11.js');

const {
  ENVIRONMENT_BIBLE_VERSION,
  EnvironmentBibleV11,
  collectCandidates,
  environmentPrompt,
  extractExplicitEnvironmentLines
} = require(runtimePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const houseProduction = {
  id: 'prod_house',
  strategy: {
    topic: 'Uma casa mobiliada feita em madeira',
    videoInstructions: [
      'Create an original 2D children cartoon.',
      'Environment: uma casa mobiliada feita em madeira, aconchegante, com sofa bege, mesa rustica, estante, tapete e janelas grandes.',
      'Keep the same house identity in every shot.'
    ].join('\n')
  },
  script: { title: 'A Casa de Madeira', mainContent: { sections: [] } }
};
const cartoonBible = { mode: 'kids_cartoon_2d' };
const service = new EnvironmentBibleV11({ enabled: true });
const bibleA = service.buildProductionBible(houseProduction, cartoonBible);
const bibleB = service.buildProductionBible(houseProduction, cartoonBible);

check('Environment Bible contract is version 11.7.1', () => assert.strictEqual(ENVIRONMENT_BIBLE_VERSION, '11.7.1'));
check('wooden furnished house creates an Environment Bible', () => assert(bibleA && bibleA.environments.length >= 1));
check('house category is recognized', () => assert.strictEqual(bibleA.environments[0].category, 'house'));
check('environment id is stable and category-addressable', () => assert(/^env_house_[a-f0-9]{10}$/.test(bibleA.environments[0].environmentId)));
check('wood material is explicit in the environment identity', () => assert(bibleA.environments[0].materials.includes('natural wood')));
check('wooden house construction is preserved', () => assert.strictEqual(bibleA.environments[0].construction, 'natural wood construction'));
check('furnished house captures sofa as signature element', () => assert(bibleA.environments[0].signatureElements.includes('sofa')));
check('furnished house captures table as signature element', () => assert(bibleA.environments[0].signatureElements.includes('table')));
check('furnished house captures bookshelf as signature element', () => assert(bibleA.environments[0].signatureElements.includes('bookshelf')));
check('furnished house captures rug as signature element', () => assert(bibleA.environments[0].signatureElements.includes('rug')));
check('furnished house captures windows as canonical window signature element', () => assert(bibleA.environments[0].signatureElements.includes('window')));
check('environment includes forbidden redesign rules', () => assert(bibleA.environments[0].forbiddenChanges.length >= 3));
check('environment records source evidence', () => assert.strictEqual(bibleA.environments[0].sourceEvidence[0].source, 'explicit_instruction'));
check('master frame is intentionally not generated in 11.7.1', () => assert.strictEqual(bibleA.environments[0].masterFramePath, null));
check('environment state is defined rather than falsely ready', () => assert.strictEqual(bibleA.environments[0].status, 'defined'));
check('same production input produces same Environment Bible fingerprint', () => assert.strictEqual(bibleA.fingerprint, bibleB.fingerprint));
check('same production input produces same environment id', () => assert.strictEqual(bibleA.environments[0].environmentId, bibleB.environments[0].environmentId));
check('prompt context carries persistent environment id', () => assert(bibleA.promptContext.includes(bibleA.environments[0].environmentId)));
check('prompt context requires continuity of materials and layout', () => assert(bibleA.promptContext.includes('preserve construction, material identity, palette, layout, and signature elements')));
check('prompt context truthfully says master frame is not generated yet', () => assert(bibleA.promptContext.includes('Phase 11.7.3')));
check('disabled Environment Bible returns null', () => assert.strictEqual(new EnvironmentBibleV11({ enabled: false }).buildProductionBible(houseProduction, cartoonBible), null));
check('non-cartoon explicit bible mode is not activated through cartoon integration', () => assert.strictEqual(service.buildProductionBible(houseProduction, { mode: 'documentary' }), null));
check('explicit environment line extraction is deterministic', () => assert.deepStrictEqual(extractExplicitEnvironmentLines(houseProduction), extractExplicitEnvironmentLines(houseProduction)));
check('candidate collection de-duplicates the same location category', () => {
  const candidates = collectCandidates(houseProduction);
  assert.strictEqual(candidates.filter(item => item.profile.category === 'house').length, 1);
});
check('garden is independently recognized as a reusable location', () => {
  const production = { strategy: { topic: 'Benny explores a colorful garden', videoInstructions: 'Environment: a colorful garden with flower beds and a garden path.' }, script: { mainContent: { sections: [] } } };
  const bible = service.buildProductionBible(production, cartoonBible);
  assert(bible.environments.some(item => item.category === 'garden'));
});
check('unrelated text does not invent a generic environment', () => {
  const production = { strategy: { topic: 'Benny learns kindness', videoInstructions: 'Main character: Benny, a friendly bunny.' }, script: { mainContent: { sections: [] } } };
  assert.strictEqual(service.buildProductionBible(production, cartoonBible), null);
});
check('environment prompt names signature elements', () => assert(environmentPrompt(bibleA.environments[0]).includes('SIGNATURE ELEMENTS:')));
check('specificity is bounded to a percentage scale', () => assert(bibleA.environments[0].specificity >= 0 && bibleA.environments[0].specificity <= 100));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns Environment Bible records', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS environment_bibles')));
check('database persists Environment Bible records', () => assert(dbSource.includes('async saveEnvironmentBible(bible = {})')));
check('database can load latest Environment Bible', () => assert(dbSource.includes('async getLatestEnvironmentBible(productionId)')));
check('production bundle exposes Environment Bible', () => assert(dbSource.includes('const environmentBible = await this.getLatestEnvironmentBible(productionId);') && dbSource.includes('      environmentBible,')));
check('scene pipeline imports Environment Bible runtime', () => assert(pipelineSource.includes("const { EnvironmentBibleV11 } = require('./environment-bible-v11');")));
check('scene pipeline constructs Environment Bible service', () => assert(pipelineSource.includes('this.environmentBible = options.environmentBible || new EnvironmentBibleV11')));
check('scene pipeline persists changed environment fingerprints', () => assert(pipelineSource.includes('existingEnvironmentBible.fingerprint !== plannedEnvironmentBible.fingerprint')));
check('Review Studio renders Environment Bible', () => assert(dashboardSource.includes('function renderEnvironmentBible(bible)')));
check('Review Studio does not claim a master frame exists', () => assert(dashboardSource.includes('master frame: pending 11.7.3')));
check('environment feature is enabled explicitly in env example', () => assert(envSource.includes('ENVIRONMENT_BIBLE_ENABLED=true')));
check('environment count cap is documented in env example', () => assert(envSource.includes('ENVIRONMENT_BIBLE_MAX_ENVIRONMENTS=12')));
check('package exposes Environment Bible regression command', () => assert.strictEqual(pkg.scripts['test:environment-bible'], 'node ../bootstrap/verify-phase11-environment-bible.js'));

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 11.7.1 Environment Bible OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
