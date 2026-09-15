'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const servicePath = path.join(upstream, 'utils', 'visual-router-v8.js');
if (!fs.existsSync(servicePath)) throw new Error('Phase 8 service is not materialized: utils/visual-router-v8.js');

const {
  VISUAL_ROUTER_VERSION,
  classifyLicense,
  safeRemoteUrl,
  preferredSources,
  institutionalHints,
  buildQuery,
  candidateScore,
  VisualAssetRouterV8
} = require(servicePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('visual router contract is version 8', () => {
  assert.strictEqual(VISUAL_ROUTER_VERSION, 8);
});

check('public-domain metadata is auto-use eligible', () => {
  const rights = classifyLicense({ source: 'wikimedia', license: 'Public domain' });
  assert.strictEqual(rights.status, 'confirmed');
  assert.strictEqual(rights.autoUseEligible, true);
  assert.strictEqual(rights.requiresAttribution, false);
});

check('CC BY metadata is auto-use eligible and requires attribution', () => {
  const rights = classifyLicense({ source: 'wikimedia', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' });
  assert.strictEqual(rights.autoUseEligible, true);
  assert.strictEqual(rights.requiresAttribution, true);
});

check('CC BY-SA is not silently treated as unrestricted', () => {
  const rights = classifyLicense({ source: 'wikimedia', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' });
  assert.strictEqual(rights.status, 'review_required');
  assert.strictEqual(rights.autoUseEligible, false);
});

check('NASA provenance alone remains review-required', () => {
  const rights = classifyLicense({ source: 'nasa', license: 'NASA media usage policy' });
  assert.strictEqual(rights.status, 'review_required');
  assert.strictEqual(rights.autoUseEligible, false);
});

check('remote download host allowlist blocks arbitrary hosts', () => {
  assert.strictEqual(safeRemoteUrl('wikimedia', 'https://upload.wikimedia.org/example.png'), true);
  assert.strictEqual(safeRemoteUrl('wikimedia', 'https://evil.example/example.png'), false);
  assert.strictEqual(safeRemoteUrl('nasa', 'https://images-assets.nasa.gov/image/test.jpg'), true);
});

check('archival scenes prefer archival sources before generation', () => {
  assert.deepStrictEqual(preferredSources({ visualType: 'archival_timeline' }).slice(0, 3), ['loc', 'internet_archive', 'wikimedia']);
});

check('space scenes prefer NASA and Wikimedia', () => {
  const order = preferredSources({ visualType: 'technical_diagram', sceneText: 'GPS satellite orbit around Earth' });
  assert.strictEqual(order[0], 'nasa');
  assert.strictEqual(order[1], 'wikimedia');
});

check('verified institutional publishers become search hints but not rights evidence', () => {
  const brief = { evidenceHints: [{ publisher: 'NIST', title: 'Atomic clock comparison' }, { publisher: 'Example Journal' }] };
  assert.deepStrictEqual(institutionalHints(brief), ['NIST']);
  assert(buildQuery({ ...brief, subject: 'atomic clock experiment', details: ['different elevations'] }).includes('NIST'));
});

check('candidate score rewards lexical relevance and rights-safe media', () => {
  const brief = { visualType: 'experiment_diagram', subject: 'atomic clock experiment', sceneLabel: 'Atomic clocks', details: ['different elevations'] };
  const strong = candidateScore({ source: 'wikimedia', title: 'Atomic clock experiment at different elevations', description: '', creator: '', rights: { autoUseEligible: true }, width: 1600, height: 900 }, brief);
  const weak = candidateScore({ source: 'wikimedia', title: 'Abstract blue background', description: '', creator: '', rights: { autoUseEligible: false }, width: 400, height: 300 }, brief);
  assert(strong > weak);
  assert(strong >= 0.34);
});

check('Wikimedia source asset is selected, cached, and persisted with rights metadata', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-v8-'));
  const saved = [];
  const fakeDb = { async saveVisualAssetRecord(record) { saved.push(record); return record; } };
  const fakeHttp = {
    async get(url) {
      if (url.includes('commons.wikimedia.org')) {
        return { data: { query: { pages: {
          10: {
            pageid: 10,
            title: 'File:Atomic clock laboratory.png',
            fullurl: 'https://commons.wikimedia.org/wiki/File:Atomic_clock_laboratory.png',
            imageinfo: [{
              url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Atomic_clock_laboratory.png',
              thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Atomic_clock_laboratory.png/1600px-Atomic_clock_laboratory.png',
              width: 2000, height: 1200, thumbwidth: 1600, thumbheight: 960, mime: 'image/png',
              extmetadata: {
                ImageDescription: { value: 'Precision atomic clock laboratory experiment at different elevations' },
                Artist: { value: 'Example Photographer' },
                Credit: { value: 'Example Institute' },
                LicenseShortName: { value: 'CC BY 4.0' },
                LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
                UsageTerms: { value: 'Creative Commons Attribution 4.0' }
              }
            }]
          }
        } } } };
      }
      throw new Error(`Unexpected HTTP request: ${url}`);
    }
  };
  const router = new VisualAssetRouterV8(fakeDb, {
    http: fakeHttp, dataRoot: temp, logger: { info() {}, warn() {}, error() {} }, minScore: 0.2
  });
  router.downloadAndNormalize = async (_candidate, outputPath) => {
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, Buffer.from('source-image'));
    return outputPath;
  };
  const result = await router.resolve({
    productionId: 'prod_v8',
    scene: { id: 'scene_v8', position: 0, label: 'Atomic clocks', scriptText: 'Atomic clock experiment at different elevations.' },
    brief: { subject: 'atomic clock laboratory experiment', sceneLabel: 'Atomic clocks', sceneText: 'Precision atomic clocks at different elevations.', visualType: 'experiment_diagram', details: ['atomic clock', 'laboratory', 'different elevations'], evidenceHints: [{ publisher: 'NIST', title: 'Atomic clock comparison' }] }
  });
  assert.strictEqual(result.status, 'selected');
  assert.strictEqual(result.provider, 'source:wikimedia');
  assert.strictEqual(result.rightsConfirmed, true);
  assert.strictEqual(result.record.license, 'CC BY 4.0');
  assert.strictEqual(result.record.requiresAttribution, true);
  assert.strictEqual(saved.length, 1);
  assert(fs.existsSync(result.path));
  await fsp.rm(temp, { recursive: true, force: true });
});

check('ambiguous rights are excluded by default even when source relevance is high', async () => {
  const router = new VisualAssetRouterV8(null, { enabled: true, allowReviewRequired: false, logger: { info() {}, warn() {}, error() {} } });
  router.searchSource = async source => source === 'nasa' ? [{
    source: 'nasa', id: 'NASA-1', title: 'GPS satellite orbit timing', description: 'GPS satellite orbit around Earth', creator: 'NASA',
    license: 'NASA media usage policy', licenseUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
    sourcePageUrl: 'https://images.nasa.gov/details/NASA-1', mediaUrl: 'https://images-assets.nasa.gov/image/NASA-1/NASA-1~orig.jpg', width: 1600, height: 900
  }] : [];
  const result = await router.resolve({
    productionId: 'prod_nasa', scene: { id: 'scene_nasa', label: 'GPS satellite', position: 0 },
    brief: { subject: 'GPS satellite orbit timing', sceneText: 'GPS satellite orbit around Earth', visualType: 'technical_diagram', details: ['GPS satellite', 'Earth orbit'] }
  });
  assert.strictEqual(result.status, 'no_eligible_match');
  assert.strictEqual(result.path, null);
});

check('database persists a dedicated visual source and rights audit trail', () => {
  const source = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
  assert(source.includes('CREATE TABLE IF NOT EXISTS visual_asset_records'));
  assert(source.includes('async saveVisualAssetRecord(record = {})'));
  assert(source.includes('async listVisualAssetRecords(productionId)'));
  assert(source.includes('sourceAsset: latestByScene.get(scene.id) || null'));
});

check('scene pipeline runs the real-source router before generated image fallback for non-cartoon briefs', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
  const route = source.indexOf('await this.visualRouter.resolve({ productionId, scene');
  const generated = source.indexOf('await this.videoGenerator.generateVisualAssets(', route);
  assert(route >= 0 && generated > route);
  assert(source.includes("assetOrigin: routed?.path ? 'licensed-source' : 'generated'"));
  assert(source.includes('visualRouterVersion: 8'));
  if (source.includes("visualBrief?.visualType === 'kids_cartoon_2d'")) {
    assert(source.includes("? null\n          : await this.visualRouter.resolve({ productionId, scene"));
  }
});

check('scene repair uses source-first routing except the explicit original-cartoon mode', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'scene-repair-service.js'), 'utf8');
  assert(source.includes("const { VisualAssetRouterV8 } = require('./visual-router-v8');"));
  const legacy = source.includes('const routed = await this.visualRouter.resolve({ productionId, scene, brief: visualBrief });');
  const cartoonAware = source.includes("visualBrief?.visualType === 'kids_cartoon_2d'") &&
    source.includes(': await this.visualRouter.resolve({ productionId, scene, brief: visualBrief });');
  assert(legacy || cartoonAware);
  assert(source.includes("assetOrigin: 'licensed-source'"));
});

check('rights gates cover uploaded and routed real-source assets', () => {
  const operator = fs.readFileSync(path.join(upstream, 'utils', 'operator-service.js'), 'utf8');
  const repair = fs.readFileSync(path.join(upstream, 'utils', 'scene-repair-service.js'), 'utf8');
  const shorts = fs.readFileSync(path.join(upstream, 'utils', 'shorts-repurposing-service.js'), 'utf8');
  for (const source of [operator, repair, shorts]) assert(source.includes("['uploaded', 'licensed-source', 'source'].includes(scene.assetOrigin)"));
});

check('publishing appends source asset credits to the YouTube description', () => {
  const source = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(source.includes('appendMediaCredits(description, scenes = [])'));
  assert(source.includes('Media credits / source assets:'));
  assert(source.includes('description: this.appendMediaCredits(editorData.description || bundle.seo.description, bundle.scenes || [])'));
});

check('Scene Repair Studio exposes source, license, rights status, and original source link', () => {
  const source = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
  assert(source.includes('Real source ·'));
  assert(source.includes('scene.sourceAsset.license'));
  assert(source.includes('scene.sourceAsset.rightsStatus'));
  assert(source.includes('Open original source'));
});

check('router is fail-closed by default in environment documentation', () => {
  const env = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
  assert(env.includes('VISUAL_ROUTER_ENABLED=true'));
  assert(env.includes('VISUAL_ROUTER_ALLOW_REVIEW_REQUIRED=false'));
});

check('package exposes the Phase 8 regression command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['test:visual-router'], 'node ../bootstrap/verify-phase8-visual-router.js');
});

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 8 Visual Router OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
